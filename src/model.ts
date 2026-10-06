export const metricIds = ['cpu', 'gpu', 'memory', 'storage'] as const
export type MetricId = typeof metricIds[number]
export const layouts = ['bars', 'rings', 'history', 'overview', 'compact'] as const
export type Layout = typeof layouts[number]

export interface HardwareSample {
  kind: 'hardware.sample'
  schemaVersion: 1
  sequence: number
  capturedAtUnixMs: number
  cpu: { usagePercent: number | null; frequencyMHz: number | null; logicalProcessors: number }
  gpu: { name: string; usagePercent: number | null; dedicatedTotalBytes: number } | null
  memory: { usedBytes: number; totalBytes: number }
  storage: { drive: string; usedBytes: number; totalBytes: number } | null
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function percent(value: unknown): boolean {
  return value === null || (nonNegative(value) && value <= 100)
}
function capacity(value: unknown): boolean {
  return record(value) && nonNegative(value.usedBytes) && nonNegative(value.totalBytes)
    && value.totalBytes > 0 && value.usedBytes <= value.totalBytes
}
export function isHardwareSample(value: unknown): value is HardwareSample {
  if (!record(value) || !record(value.cpu)) return false
  return value.kind === 'hardware.sample' && value.schemaVersion === 1
    && nonNegative(value.sequence) && Number.isSafeInteger(value.sequence)
    && nonNegative(value.capturedAtUnixMs) && Number.isSafeInteger(value.capturedAtUnixMs)
    && percent(value.cpu.usagePercent)
    && (value.cpu.frequencyMHz === null || nonNegative(value.cpu.frequencyMHz))
    && nonNegative(value.cpu.logicalProcessors) && Number.isInteger(value.cpu.logicalProcessors)
    && value.cpu.logicalProcessors > 0
    && capacity(value.memory)
    && (value.gpu === null || (record(value.gpu) && typeof value.gpu.name === 'string'
      && value.gpu.name.length <= 256 && percent(value.gpu.usagePercent)
      && nonNegative(value.gpu.dedicatedTotalBytes)))
    && (value.storage === null || (capacity(value.storage) && record(value.storage)
      && typeof value.storage.drive === 'string' && /^[A-Z]:$/.test(value.storage.drive)))
}
export function percentage(used: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, used / total * 100)) : 0
}
export function formatCapacity(used: number, total: number): string {
  const divisor = total >= 1024 ** 4 ? 1024 ** 4 : 1024 ** 3
  const unit = divisor === 1024 ** 4 ? 'TiB' : 'GiB'
  const format = (bytes: number) => (bytes / divisor).toFixed(unit === 'TiB' ? 2 : total < 100 * divisor ? 1 : 0)
  return `${format(used)} / ${format(total)} ${unit}`
}
export const HISTORY_LENGTH = 16
export function pushHistory(history: (number | null)[], value: number | null): void {
  history.push(value)
  if (history.length > HISTORY_LENGTH) history.shift()
}
