import type { VercelRequest, VercelResponse } from '@vercel/node'
import { checkStrictRateLimit } from './_lib.js'
import { partition, set } from './_store.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).end()
  if (!(await checkStrictRateLimit(req, res, 'presence'))) return
  try {
    const id = req.method === 'POST' ? req.body?.id : req.query.id
    if (id !== undefined && (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)))
      return res.status(400).json({ error: 'Invalid presence ID' })
    if (id) await set('presence', Date.now(), { sk: id, ttl: 90 })
    return res.json({ count: (await partition<number>('presence')).length })
  } catch (error) {
    console.error('Presence unavailable', error instanceof Error ? error.name : 'UnknownError')
    return res.status(503).json({ error: 'Online count temporarily unavailable' })
  }
}
