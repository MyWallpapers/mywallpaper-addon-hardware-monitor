import type { JsonValue } from '../generated/mywallpaper-runtime'
import { layouts, type Layout } from './model'
export interface Settings {
  layout: Layout
  showCpu: boolean
  showGpu: boolean
  showMemory: boolean
  showStorage: boolean
  backgroundColor: string
  textColor: string
  cpuColor: string
  gpuColor: string
  memoryColor: string
  storageColor: string
  opacity: number
  cornerRadius: number
  blurAmount: number
}
export const defaults: Settings = {
  layout: 'bars', showCpu: true, showGpu: true, showMemory: true, showStorage: true,
  backgroundColor: '#172027', textColor: '#f3f6fc', cpuColor: '#309dff',
  gpuColor: '#41d797', memoryColor: '#a45bff', storageColor: '#ffaf44',
  opacity: .75, cornerRadius: 22, blurAmount: 12,
}
export function readSettings(values: Record<string, JsonValue>): Settings {
  const next = { ...defaults }
  next.layout = layouts.includes(values.layout as Layout) ? values.layout as Layout : defaults.layout
  for (const key of ['showCpu', 'showGpu', 'showMemory', 'showStorage'] as const) {
    if (typeof values[key] === 'boolean') next[key] = values[key]
  }
  for (const key of ['backgroundColor', 'textColor', 'cpuColor', 'gpuColor', 'memoryColor', 'storageColor'] as const) {
    if (typeof values[key] === 'string' && /^#[\da-f]{6}$/i.test(values[key])) next[key] = values[key]
  }
  for (const [key, min, max] of [['opacity', 0, 1], ['cornerRadius', 0, 40], ['blurAmount', 0, 30]] as const) {
    const value = values[key]
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = Math.min(max, Math.max(min, value))
  }
  return next
}
export function refreshMs(values: Record<string, JsonValue>): number {
  return values.refreshInterval === '5s' ? 5000 : values.refreshInterval === '1s' ? 1000 : 2000
}
