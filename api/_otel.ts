import { SpanStatusCode } from '@opentelemetry/api'
import type { Span } from '@opentelemetry/api'

const ED_TRACES_URL = 'https://in.staging.edgedelta.com/traces'
const ED_LOGS_URL = 'https://in.staging.edgedelta.com/logs'
const ED_METRICS_URL = 'https://in.staging.edgedelta.com/metrics'
const ED_TOKEN = process.env.EDGE_DELTA_TOKEN ?? ''

interface PendingSpan {
  name: string
  traceId: string
  spanId: string
  startNs: bigint
  endNs?: bigint
  attributes: Record<string, string | number | boolean>
  status: { code: number }
  events: Array<{ name: string; attributes: Record<string, string> }>
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function nsNow(): bigint {
  return BigInt(Math.floor(performance.now() * 1_000_000) + Date.now() * 1_000_000)
}

class SimpleSpan implements Span {
  spanContext() { return { traceId: this._data.traceId, spanId: this._data.spanId, traceFlags: 1 } }
  private _data: PendingSpan

  constructor(name: string) {
    this._data = {
      name,
      traceId: randomHex(16),
      spanId: randomHex(8),
      startNs: nsNow(),
      attributes: {},
      status: { code: SpanStatusCode.OK },
      events: [],
    }
    pendingSpans.push(this._data)
  }

  setAttribute(key: string, value: string | number | boolean) { this._data.attributes[key] = value; return this }
  setAttributes(attrs: Record<string, string | number | boolean>) { Object.assign(this._data.attributes, attrs); return this }
  setStatus(s: { code: number }) { this._data.status = s; return this }
  recordException(err: Error) {
    this._data.events.push({ name: 'exception', attributes: { 'exception.message': err.message, 'exception.type': err.name } })
    return this
  }
  end() { this._data.endNs = nsNow() }
  isRecording() { return true }
  updateName(name: string) { this._data.name = name; return this }
  addEvent(name: string) { this._data.events.push({ name, attributes: {} }); return this }
  addLink() { return this }
  addLinks() { return this }
}

const pendingSpans: PendingSpan[] = []

export const tracer = {
  startSpan: (name: string) => new SimpleSpan(name),
}

export async function flush(): Promise<void> {
  await flushLogs()
  await flushMetrics()
  // traces below
  const toExport = pendingSpans.filter(s => s.endNs !== undefined)
  if (toExport.length === 0) return
  toExport.forEach(s => pendingSpans.splice(pendingSpans.indexOf(s), 1))

  const body = {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'evaluchess' } }] },
      scopeSpans: [{
        scope: { name: 'evaluchess-api', version: '1.0.0' },
        spans: toExport.map(s => ({
          traceId: s.traceId,
          spanId: s.spanId,
          name: s.name,
          kind: 2,
          startTimeUnixNano: String(s.startNs),
          endTimeUnixNano: String(s.endNs!),
          status: { code: s.status.code === SpanStatusCode.ERROR ? 2 : 1 },
          attributes: Object.entries(s.attributes).map(([key, value]) => ({
            key,
            value: typeof value === 'boolean' ? { boolValue: value }
              : typeof value === 'number' ? { intValue: value }
              : { stringValue: String(value) },
          })),
          events: s.events.map(e => ({
            name: e.name,
            attributes: Object.entries(e.attributes).map(([k, v]) => ({ key: k, value: { stringValue: v } })),
          })),
        })),
      }],
    }],
  }

  try {
    const res = await fetch(ED_TRACES_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ED_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) console.error(`[otel] trace export failed: ${res.status} ${await res.text()}`)
  } catch (err) {
    console.error('[otel] trace export error:', err)
  }
}

type LogLevel = 'info' | 'warn' | 'error'

interface PendingLog {
  timestamp: string
  level: LogLevel
  message: string
  service: string
  attributes: Record<string, string | number | boolean>
}

const pendingLogs: PendingLog[] = []

export function log(level: LogLevel, message: string, attrs: Record<string, string | number | boolean> = {}): void {
  pendingLogs.push({ timestamp: new Date().toISOString(), level, message, service: 'evaluchess', attributes: attrs })
}

export async function flushLogs(): Promise<void> {
  if (pendingLogs.length === 0) return
  const toLogs = pendingLogs.splice(0, pendingLogs.length)
  const body = toLogs.map(l => JSON.stringify({ ...l, ...l.attributes })).join('\n')
  try {
    const res = await fetch(ED_LOGS_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ED_TOKEN}`, 'Content-Type': 'application/x-ndjson' },
      body,
    })
    if (!res.ok) console.error(`[otel] log export failed: ${res.status} ${await res.text()}`)
  } catch (err) {
    console.error('[otel] log export error:', err)
  }
}

interface PendingMetric {
  name: string
  value: number
  timeNs: string
  attributes: Record<string, string | number | boolean>
}

const pendingMetrics: PendingMetric[] = []

export function metric(name: string, value: number, attrs: Record<string, string | number | boolean> = {}): void {
  pendingMetrics.push({ name, value, timeNs: String(BigInt(Date.now()) * 1_000_000n), attributes: attrs })
}

export async function flushMetrics(): Promise<void> {
  if (pendingMetrics.length === 0) return
  const toExport = pendingMetrics.splice(0, pendingMetrics.length)

  const toOtelAttr = (attrs: Record<string, string | number | boolean>) =>
    Object.entries(attrs).map(([key, value]) => ({
      key,
      value: typeof value === 'boolean' ? { boolValue: value }
        : typeof value === 'number' ? { intValue: value }
        : { stringValue: String(value) },
    }))

  const body = {
    resourceMetrics: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'evaluchess' } }] },
      scopeMetrics: [{
        scope: { name: 'evaluchess-api', version: '1.0.0' },
        metrics: toExport.map(m => ({
          name: m.name,
          gauge: {
            dataPoints: [{
              attributes: toOtelAttr(m.attributes),
              timeUnixNano: m.timeNs,
              asInt: Math.round(m.value),
            }],
          },
        })),
      }],
    }],
  }

  try {
    const res = await fetch(ED_METRICS_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ED_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) console.error(`[otel] metrics export failed: ${res.status} ${await res.text()}`)
  } catch (err) {
    console.error('[otel] metrics export error:', err)
  }
}

export function recordError(span: Span, err: unknown): void {
  span.recordException(err instanceof Error ? err : new Error(String(err)))
  span.setStatus({ code: SpanStatusCode.ERROR })
}
