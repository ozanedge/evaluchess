import { randomUUID } from 'node:crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'

export interface RecordValue<T> {
  pk: string
  sk: string
  value: T
  version: string
  expiresAt?: number
}
export type Write = NonNullable<TransactWriteCommandInput['TransactItems']>[number]
let documentClient: DynamoDBDocumentClient | undefined
export function tableName() {
  const table = process.env.DYNAMODB_TABLE
  if (!table) throw new Error('DYNAMODB_TABLE is not configured')
  return table
}
export function client() {
  if (!documentClient) {
    const endpoint = process.env.DYNAMODB_ENDPOINT
    if (
      endpoint &&
      (process.env.VERCEL ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname))
    )
      throw new Error('DYNAMODB_ENDPOINT is only supported for local tests')
    documentClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: process.env.DYNAMODB_REGION || process.env.AWS_REGION || 'us-west-2',
        ...(endpoint
          ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
          : process.env.AWS_ROLE_ARN
            ? { credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN }) }
            : {}),
        maxAttempts: 3,
      }),
      { marshallOptions: { removeUndefinedValues: true } }
    )
  }
  return documentClient
}
const seconds = () => Math.floor(Date.now() / 1000)
export async function read<T>(pk: string, sk = 'data'): Promise<RecordValue<T> | null> {
  const result = await client().send(
    new GetCommand({ TableName: tableName(), Key: { pk, sk }, ConsistentRead: true })
  )
  const row = result.Item as RecordValue<T> | undefined
  return row && (row.expiresAt === undefined || row.expiresAt > seconds()) ? row : null
}
export async function get<T>(pk: string, sk = 'data'): Promise<T | null> {
  return (await read<T>(pk, sk))?.value ?? null
}
function condition(previous: RecordValue<unknown> | null) {
  return previous
    ? {
        ConditionExpression: '#version = :version',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':version': previous.version },
      }
    : {
        ConditionExpression: 'attribute_not_exists(pk) OR expiresAt <= :now',
        ExpressionAttributeValues: { ':now': seconds() },
      }
}
export function putWrite(
  pk: string,
  value: unknown,
  previous: RecordValue<unknown> | null,
  options: {
    sk?: string
    ttl?: number
    leaderboard?: { elo: number; wins: number; uid: string; username: string }
  } = {}
): Write {
  return {
    Put: {
      TableName: tableName(),
      Item: {
        pk,
        sk: options.sk || 'data',
        value,
        version: randomUUID(),
        ...(options.ttl === undefined ? {} : { expiresAt: seconds() + options.ttl }),
        ...(options.leaderboard
          ? {
              leaderboard: 'all-time',
              elo: options.leaderboard.elo,
              wins: options.leaderboard.wins,
              uid: options.leaderboard.uid,
              username: options.leaderboard.username,
            }
          : {}),
      },
      ...condition(previous),
    },
  }
}
export function deleteWrite(pk: string, previous: RecordValue<unknown> | null, sk = 'data'): Write {
  return { Delete: { TableName: tableName(), Key: { pk, sk }, ...condition(previous) } }
}
export async function transact(writes: Write[]): Promise<boolean> {
  try {
    await client().send(
      new TransactWriteCommand({ TransactItems: writes, ClientRequestToken: randomUUID() })
    )
    return true
  } catch (error) {
    const e = error as { name?: string; CancellationReasons?: { Code?: string }[] }
    if (
      e.name === 'TransactionCanceledException' &&
      e.CancellationReasons?.some(
        (r) => r.Code === 'ConditionalCheckFailed' || r.Code === 'TransactionConflict'
      ) &&
      e.CancellationReasons.every(
        (r) => !r.Code || ['None', 'ConditionalCheckFailed', 'TransactionConflict'].includes(r.Code)
      )
    )
      return false
    throw error
  }
}
export async function set(pk: string, value: unknown, options: { ttl?: number; sk?: string } = {}) {
  const item = putWrite(pk, value, null, options).Put!.Item
  await client().send(new PutCommand({ TableName: tableName(), Item: item }))
}
export async function remove(pk: string, sk = 'data') {
  await client().send(new DeleteCommand({ TableName: tableName(), Key: { pk, sk } }))
}
export async function partition<T>(pk: string): Promise<RecordValue<T>[]> {
  const rows: RecordValue<T>[] = []
  let cursor: Record<string, unknown> | undefined
  do {
    const page = await client().send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      })
    )
    rows.push(...((page.Items || []) as RecordValue<T>[]))
    cursor = page.LastEvaluatedKey
  } while (cursor)
  return rows.filter((row) => row.expiresAt === undefined || row.expiresAt > seconds())
}
export async function leaders() {
  const result = await client().send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'leaderboard-wins',
      KeyConditionExpression: 'leaderboard = :board',
      ExpressionAttributeValues: { ':board': 'all-time' },
      ScanIndexForward: false,
      Limit: 10,
    })
  )
  return result.Items || []
}
export async function backoff(attempt: number) {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.min(150, 5 * 2 ** attempt) + Math.random() * 15)
  )
}
