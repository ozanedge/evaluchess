interface MetricPoint {
  name: string
  value: number
  attrs?: Record<string, string | number | boolean>
}

export function clientMetric(_metrics: MetricPoint[]): void {
  void _metrics
  // Intentionally local-only. Avoid a separate telemetry service dependency.
}
