import './build.mjs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'
import { tableDefinition } from '../infra/table.mjs'

export async function scratchServer() {
  const directory = mkdtempSync(join(tmpdir(), 'evaluchess-dynamo-test-'))
  const jar = process.env.DYNAMODB_LOCAL_JAR
  if (!jar || !existsSync(jar))
    throw new Error('Set DYNAMODB_LOCAL_JAR to DynamoDBLocal.jar and JAVA to a Java 17+ executable')
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const child = spawn(
    process.env.JAVA || 'java',
    [
      '-Djava.library.path=' + join(jar, '..', 'DynamoDBLocal_lib'),
      '-jar',
      jar,
      '-inMemory',
      '-sharedDb',
      '-disableTelemetry',
      '-port',
      String(port),
    ],
    { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let startupError
  child.on('error', (error) => {
    startupError = error
  })
  let logs = ''
  child.stderr.on('data', (data) => {
    logs += data
  })
  process.env.DYNAMODB_ENDPOINT = `http://127.0.0.1:${port}`
  process.env.DYNAMODB_REGION = 'us-west-2'
  process.env.DYNAMODB_TABLE = 'evaluchess-test'
  const db = new DynamoDBClient({
    region: 'us-west-2',
    endpoint: process.env.DYNAMODB_ENDPOINT,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    maxAttempts: 1,
  })
  let ready = false
  for (let i = 0; i < 100 && !startupError; i++) {
    try {
      await db.send(new CreateTableCommand(tableDefinition(process.env.DYNAMODB_TABLE)))
      ready = true
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  if (!ready) {
    child.kill('SIGTERM')
    throw startupError || new Error('DynamoDB Local did not start: ' + logs)
  }
  for (let i = 0; i < 50; i++) {
    const result = await db.send(
      new DescribeTableCommand({ TableName: process.env.DYNAMODB_TABLE })
    )
    if (result.Table.TableStatus === 'ACTIVE') break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  db.destroy()
  const routes = {}
  for (const name of ['auth', 'join', 'move', 'status', 'leaderboard', 'rating', 'online', 'library'])
    routes['/api/' + name] = (await import(`../.test-build/api/${name}.js`)).default
  const app = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const handler = routes[url.pathname]
    if (!handler) {
      res.statusCode = 404
      res.end()
      return
    }
    let body = ''
    for await (const part of req) body += part
    req.body = body ? JSON.parse(body) : {}
    req.query = Object.fromEntries(url.searchParams)
    res.status = (code) => {
      res.statusCode = code
      return res
    }
    res.json = (value) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(value))
      return res
    }
    try {
      await handler(req, res)
    } catch (error) {
      res.status(500).json({ error: error.stack })
    }
  })
  await new Promise((r) => app.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${app.address().port}`,
    stopStorage: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise((resolve) => child.once('exit', resolve))
      }
    },
    close: async () => {
      await new Promise((resolve) => app.close(resolve))
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise((resolve) => child.once('exit', resolve))
      }
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
