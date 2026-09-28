// Operator-only migration of retained completed games; never infer dates from lifetime totals.
import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { pathToFileURL } from 'node:url'
import * as store from '../api/_store.js'
import type { OnlineGame } from '../src/lib/gameRules.js'
import {
  gameResult,
  resultPartition,
  resultSortKey,
  resultWrite,
  LEADERBOARD_WINDOW_MS,
} from '../api/_leaderboard.js'

export async function backfillRecentResults(apply = false, now = Date.now()) {
  let cursor: Record<string, unknown> | undefined
  const counts = { apply, eligible: 0, created: 0, existing: 0 }
  do {
    const page = await store.client().send(
      new ScanCommand({
        TableName: store.tableName(),
        FilterExpression:
          'begins_with(pk, :prefix) AND attribute_exists(#value.#result.#reason) AND #value.turnAt > :cutoff AND #value.turnAt <= :now',
        ExpressionAttributeNames: { '#value': 'value', '#result': 'result', '#reason': 'reason' },
        ExpressionAttributeValues: {
          ':prefix': 'evaluchess:game:v3:',
          ':cutoff': now - LEADERBOARD_WINDOW_MS,
          ':now': now,
        },
        ProjectionExpression: 'pk, sk',
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      })
    )
    for (const key of page.Items || []) {
      for (let attempt = 0; ; attempt++) {
        if (attempt === 12) throw new Error('Game stayed busy; rerun the backfill')
        const game = await store.read<OnlineGame>(key.pk, key.sk)
        const result = game && gameResult(game.value)
        if (
          !game ||
          !result ||
          result.endedAt <= now - LEADERBOARD_WINDOW_MS ||
          result.endedAt > now
        )
          break
        if (await store.read(resultPartition(result.endedAt), resultSortKey(result))) {
          counts.eligible++
          counts.existing++
          break
        }
        if (
          !apply ||
          (await store.transact([
            resultWrite(result),
            {
              ConditionCheck: {
                TableName: store.tableName(),
                Key: { pk: game.pk, sk: game.sk },
                ConditionExpression: '#version = :version',
                ExpressionAttributeNames: { '#version': 'version' },
                ExpressionAttributeValues: { ':version': game.version },
              },
            },
          ]))
        ) {
          counts.eligible++
          counts.created++
          break
        }
        await store.backoff(attempt)
      }
    }
    cursor = page.LastEvaluatedKey
  } while (cursor)
  return counts
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  backfillRecentResults(process.argv.includes('--apply'))
    .then(console.log)
    .catch((error) => {
      console.error((error as Error).message)
      process.exitCode = 1
    })
