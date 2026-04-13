interface MetricPoint {
  name: string
  value: number
  attrs?: Record<string, string | number | boolean>
}

export function clientMetric(metrics: MetricPoint[]): void {
  fetch('/api/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metrics }),
  }).catch(() => { /* fire and forget */ })
}
