type LogLevel = 'info' | 'warn' | 'error'

export function clientLog(
  level: LogLevel,
  message: string,
  attrs: Record<string, string | number | boolean> = {}
): void {
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message, attrs }),
  }).catch(() => { /* fire and forget */ })
}
