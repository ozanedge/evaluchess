import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkRateLimit } from './_lib.js'
import { metric, flushMetrics } from './_otel.js'

interface MetricPoint {
  name: string
  value: number
  attrs?: Record<string, string | number | boolean>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!await checkRateLimit(req, res)) return

  const { metrics } = req.body as { metrics?: MetricPoint[] }
  if (!Array.isArray(metrics) || metrics.length === 0)
    return res.status(400).json({ error: 'missing metrics' })

  for (const { name, value, attrs } of metrics) {
    if (typeof name === 'string' && typeof value === 'number')
      metric(name, value, attrs ?? {})
  }

  await flushMetrics()
  return res.status(204).end()
}
