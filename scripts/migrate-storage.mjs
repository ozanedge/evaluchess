// One-time operator tool. No Redis client or migration code ships in the API.
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'

const USER = 'evaluchess:user:v1:'
const NAME = 'evaluchess:username:v1:'
const RATING = 'evaluchess:rating:v3:'
const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9._\-+~!]{1,22}[a-zA-Z0-9]$/
export function validateSnapshot(snapshot) {
  if (snapshot?.format !== 'evaluchess-accounts-v1' || !Array.isArray(snapshot.accounts))
    throw new Error('Unsupported account export format')
  const ids = new Set(),
    names = new Set()
  for (const row of snapshot.accounts) {
    const a = row?.account,
      r = row?.rating
    if (
      !a ||
      typeof a.uid !== 'string' ||
      !a.uid ||
      a.uid.length > 128 ||
      typeof a.username !== 'string' ||
      !namePattern.test(a.username) ||
      a.usernameLower !== a.username.toLowerCase() ||
      !Number.isFinite(a.createdAt) ||
      !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(a.password)
    )
      throw new Error('Invalid account record; import stopped')
    if (ids.has(a.uid) || names.has(a.usernameLower))
      throw new Error('Duplicate identity in export')
    ids.add(a.uid)
    names.add(a.usernameLower)
    if (
      !r ||
      !Number.isSafeInteger(r.elo) ||
      !['wins', 'losses', 'draws', 'gamesPlayed'].every(
        (k) => Number.isSafeInteger(r[k]) && r[k] >= 0
      ) ||
      r.gamesPlayed !== r.wins + r.losses + r.draws
    )
      throw new Error(
        'Missing or invalid rating; never substitute a starting rating during migration'
      )
  }
  return snapshot
}

export async function exportAccounts(command) {
  const keys = new Set()
  let cursor = '0'
  do {
    const page = await command(['SCAN', cursor, 'MATCH', USER + '*', 'COUNT', 100])
    if (!Array.isArray(page) || !Array.isArray(page[1])) throw new Error('Invalid export response')
    cursor = String(page[0])
    for (const key of page[1]) keys.add(key)
  } while (cursor !== '0')
  const accounts = []
  const decode = (value) => (typeof value === 'string' ? JSON.parse(value) : value)
  for (const key of keys) {
    const account = decode(await command(['GET', key]))
    if (!account || key !== USER + account.uid)
      throw new Error('Account changed during export; stop writes before exporting')
    const rating = decode(await command(['GET', RATING + account.uid]))
    const mapping = await command(['GET', NAME + account.usernameLower])
    // Redis strings can be raw or JSON-encoded, depending on the old writer.
    if (mapping !== account.uid && mapping !== JSON.stringify(account.uid))
      throw new Error('Account lookup is inconsistent; export stopped')
    accounts.push({ account, rating })
  }
  return validateSnapshot({
    format: 'evaluchess-accounts-v1',
    exportedAt: new Date().toISOString(),
    accounts,
  })
}

export async function importAccounts(snapshot, db, TableName, { verifyOnly = false } = {}) {
  validateSnapshot(snapshot) // Validate the ENTIRE file before any writes.
  if (!TableName) throw new Error('DYNAMODB_TABLE is required')
  let imported = 0,
    existing = 0
  for (const { account, rating } of snapshot.accounts) {
    const expected = [
      { pk: USER + account.uid, value: account },
      { pk: NAME + account.usernameLower, value: account.uid },
      {
        pk: RATING + account.uid,
        value: rating,
        leaderboard: 'all-time',
        elo: rating.elo,
        wins: rating.wins,
        uid: account.uid,
        username: account.username,
      },
    ].map((item) => ({ ...item, sk: 'data' }))
    const read = () =>
      Promise.all(
        expected.map(
          async (item) =>
            (
              await db.send(
                new GetCommand({
                  TableName,
                  Key: { pk: item.pk, sk: item.sk },
                  ConsistentRead: true,
                })
              )
            ).Item
        )
      )
    const identical = (rows) =>
      rows.every(
        (row, i) =>
          row &&
          !row.expiresAt &&
          Object.entries(expected[i]).every(([key, value]) => isDeepStrictEqual(row[key], value))
      )
    const rows = await read()
    if (identical(rows)) {
      existing++
      continue
    }
    if (rows.some(Boolean) || verifyOnly)
      throw new Error(
        'Destination differs from export or has a partial account; refusing to overwrite'
      )
    try {
      await db.send(
        new TransactWriteCommand({
          ClientRequestToken: randomUUID(),
          TransactItems: expected.map((item) => ({
            Put: {
              TableName,
              Item: { ...item, version: randomUUID() },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          })),
        })
      )
      imported++
    } catch (error) {
      if (error.name === 'TransactionCanceledException' && identical(await read())) existing++
      else throw error
    }
  }
  return { accounts: snapshot.accounts.length, imported, existing }
}

async function main() {
  const [operation, file] = process.argv.slice(2)
  if (!file || !['export', 'import', 'verify'].includes(operation))
    throw new Error(
      'Usage: node scripts/migrate-storage.mjs export|import|verify /secure/path/accounts.json'
    )
  if (operation === 'export') {
    const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env
    if (!url || !token || new URL(url).protocol !== 'https:')
      throw new Error('Set the old Upstash HTTPS URL and token in the environment')
    const snapshot = await exportAccounts(async (command) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok)
        throw new Error(`Source export failed (HTTP ${response.status}); no file was written`)
      const result = await response.json()
      if (result.error) throw new Error('Source rejected export command; no file was written')
      return result.result
    })
    await writeFile(file, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    console.log(
      `Exported ${snapshot.accounts.length} accounts with ratings. File contains password hashes; keep it private.`
    )
    return
  }
  const endpoint = process.env.DYNAMODB_ENDPOINT
  if (endpoint && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname))
    throw new Error('Custom endpoints are only allowed for local tests')
  const raw = new DynamoDBClient({
    region: process.env.DYNAMODB_REGION || process.env.AWS_REGION,
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  })
  try {
    const db = DynamoDBDocumentClient.from(raw)
    const result = await importAccounts(
      JSON.parse(await readFile(file, 'utf8')),
      db,
      process.env.DYNAMODB_TABLE,
      { verifyOnly: operation === 'verify' }
    )
    console.log(JSON.stringify(result))
  } finally {
    raw.destroy()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // AWS errors can contain item data. Do not print raw SDK errors or stacks.
    console.error(
      error.name === 'SyntaxError'
        ? 'Invalid export JSON; migration stopped'
        : error.name === 'Error'
          ? error.message
          : `Migration failed: ${error.name}`
    )
    process.exitCode = 1
  })
}
