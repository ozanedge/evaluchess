type LogLevel = 'info' | 'warn' | 'error'

export function clientLog(
  _level: LogLevel,
  _message: string,
  _attrs: Record<string, string | number | boolean> = {}
): void {
  void _level
  void _message
  void _attrs
  // Intentionally local-only. Server request logs cover operational failures.
}
