import type { MetricId } from './model'
const paths: Record<MetricId, string> = {
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 2v4m3-4v4m3-4v4M9 18v4m3-4v4m3-4v4M2 9h4m-4 3h4m-4 3h4m12-6h4m-4 3h4m-4 3h4"/><rect x="9" y="9" width="6" height="6" rx=".5"/>',
  gpu: '<rect x="3" y="5" width="18" height="13" rx="1.5"/><circle cx="9" cy="11.5" r="3"/><path d="m8 9 2 5m1-3-5 1m11-3h1m-1 4h1M6 18v2m3-2v2m3-2v2m-9-10H1m2 4H1"/>',
  memory: '<rect x="2" y="5" width="20" height="13" rx="1.5"/><path d="M6 18v2m4-2v2m4-2v2m4-2v2M5 9h4v4H5zm10 0h4v4h-4zm-4 2h2"/>',
  storage: '<path d="M5 3h14l2 15v3H3v-3L5 3Z"/><path d="M3 17h18M7 7h10M7 12h.01M17 19h.01"/>',
}
export function icon(metric: MetricId): string {
  return `<svg class="hm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[metric]}</svg>`
}
