// Operator-only, safe to rerun while games complete. No account statistics change.
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { pathToFileURL } from 'node:url'
import * as store from '../api/_store.js'
import type { Rating } from '../api/_identity.js'

type IndexedRating = store.RecordValue<Rating> & { uid: string; username: string; wins?: number }
export async function backfillLeaderboardWins(apply = false) {
  let cursor: Record<string, unknown> | undefined
  let changed = 0,
    unchanged = 0
  do {
    const page = await store.client().send(
      new QueryCommand({
        TableName: store.tableName(),
        IndexName: 'leaderboard',
        KeyConditionExpression: 'leaderboard = :board',
        ExpressionAttributeValues: { ':board': 'all-time' },
        ProjectionExpression: 'pk, sk',
        ExclusiveStartKey: cursor,
      })
    )
    for (const key of page.Items || []) {
      for (let attempt = 0; ; attempt++) {
        if (attempt === 12) throw new Error('Rating stayed busy; rerun the backfill')
        const row = (await store.read<Rating>(key.pk, key.sk)) as IndexedRating | null
        if (!row) throw new Error('Indexed rating disappeared; rerun the backfill')
        if (
          !row.uid ||
          !row.username ||
          !Number.isSafeInteger(row.value.wins) ||
          row.value.wins < 0
        )
          throw new Error('Invalid rating; backfill stopped')
        if (row.wins === row.value.wins) {
          unchanged++
          break
        }
        if (!apply) {
          changed++
          break
        }
        if (
          await store.transact([
            store.putWrite(row.pk, row.value, row, {
              leaderboard: {
                uid: row.uid,
                username: row.username,
                elo: row.value.elo,
                wins: row.value.wins,
              },
            }),
          ])
        ) {
          changed++
          break
        }
        await store.backoff(attempt)
      }
    }
    cursor = page.LastEvaluatedKey
  } while (cursor)
  return { apply, changed, unchanged }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  backfillLeaderboardWins(process.argv.includes('--apply'))
    .then(console.log)
    .catch((error) => {
      console.error((error as Error).message)
      process.exitCode = 1
    })
