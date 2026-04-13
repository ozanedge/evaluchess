import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkRateLimit } from './_lib.js'
import { log, flushLogs } from './_otel.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!await checkRateLimit(req, res)) return

  const { level, message, attrs } = req.body as {
    level?: string
    message?: string
    attrs?: Record<string, string | number | boolean>
  }
  if (!message) return res.status(400).json({ error: 'missing message' })

  const safeLevel = level === 'warn' || level === 'error' ? level : 'info'
  log(safeLevel, message, { source: 'client', ...(attrs ?? {}) })
  await flushLogs()
  return res.status(204).end()
}
