import { icon } from './icons'
import { metricIds, HISTORY_LENGTH, formatCapacity, percentage, pushHistory, type HardwareSample, type MetricId } from './model'
import type { Settings } from './settings'
const labels = { cpu: 'CPU', gpu: 'GPU', memory: 'RAM', storage: 'DISK' }
interface MetricView {
  element: HTMLElement
  value: HTMLElement
  detail: HTMLElement
  fill: HTMLElement
  circle: SVGElement
  historyBars: HTMLElement[]
  history: (number | null)[]
}
export function createView(root: HTMLElement) {
  root.classList.add('hm-root')
  root.innerHTML = `<section class="hm-panel" aria-label="Hardware Monitor">
    <div class="hm-metrics">${metricIds.map(id => `<article class="hm-metric" data-metric="${id}" aria-label="${labels[id]}">
      <div class="hm-gauge">
        <svg class="hm-ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="hm-ring-track" cx="60" cy="60" r="53" pathLength="100"/><circle class="hm-ring-progress" cx="60" cy="60" r="53" pathLength="100" stroke-dasharray="0 100"/></svg>
        <div class="hm-reading">${icon(id)}<span class="hm-label">${labels[id]}</span><strong class="hm-value"><span>—</span><small hidden>%</small></strong></div>
      </div>
      <div class="hm-track" aria-hidden="true"><i></i></div>
      <div class="hm-history" aria-hidden="true">${Array.from({length:HISTORY_LENGTH},()=>'<i class="is-missing"><b></b></i>').join('')}</div>
      <span class="hm-detail">Awaiting data</span>
    </article>`).join('')}</div>
    <p class="hm-empty" hidden>No metrics selected</p>
    <p class="hm-status" role="status">Connecting to local hardware…</p>
    <span class="hm-demo" hidden>Illustrative preview</span>
  </section>`
  const required = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector)
    if (!element) throw new Error(`Missing Hardware Monitor element: ${selector}`)
    return element
  }
  const panel = required<HTMLElement>('.hm-panel')
  const status = required<HTMLElement>('.hm-status')
  const views = {} as Record<MetricId, MetricView>
  for (const id of metricIds) views[id] = {
    element: required<HTMLElement>(`[data-metric="${id}"]`),
    value: required<HTMLElement>(`[data-metric="${id}"] .hm-value`),
    detail: required<HTMLElement>(`[data-metric="${id}"] .hm-detail`),
    fill: required<HTMLElement>(`[data-metric="${id}"] .hm-track i`),
    circle: required<SVGElement>(`[data-metric="${id}"] .hm-ring-progress`),
    historyBars: Array.from(root.querySelectorAll<HTMLElement>(`[data-metric="${id}"] .hm-history i`)),
    history: [],
  }
  let visible = 4
  function configure(settings: Settings) {
    panel.dataset.layout = settings.layout
    const vars: Record<string,string> = {
      '--hm-bg': settings.backgroundColor, '--hm-text': settings.textColor,
      '--hm-alpha': String(settings.opacity), '--hm-radius': `${settings.cornerRadius}px`, '--hm-blur': `${settings.blurAmount}px`,
    }
    for (const [name, value] of Object.entries(vars)) panel.style.setProperty(name, value)
    const shown = {cpu:settings.showCpu, gpu:settings.showGpu, memory:settings.showMemory, storage:settings.showStorage}
    visible = 0
    for (const id of metricIds) {
      views[id].element.hidden = !shown[id]
      views[id].element.style.setProperty('--hm-color', settings[`${id}Color`])
      if (shown[id]) visible++
    }
    panel.style.setProperty('--hm-count', String(Math.max(1, visible)))
    panel.style.setProperty('--hm-other-count', String(Math.max(1, visible - (settings.showCpu ? 1 : 0))))
    panel.dataset.cpuVisible = String(settings.showCpu)
    panel.dataset.visible = String(visible)
    required<HTMLElement>('.hm-empty').hidden = visible !== 0
  }
  function render(sample: HardwareSample, appendHistory = true) {
    const readings: Record<MetricId, {percent:number|null;detail:string;title?:string}> = {
      cpu: {percent:sample.cpu.usagePercent, detail:sample.cpu.frequencyMHz === null ? `${sample.cpu.logicalProcessors} logical CPUs` : `${(sample.cpu.frequencyMHz / 1000).toFixed(2)} GHz`, title:'Windows-reported clock frequency'},
      gpu: {percent:sample.gpu?.usagePercent ?? null, detail:sample.gpu ? `${(sample.gpu.dedicatedTotalBytes / 1024 ** 3).toFixed(1)} GiB VRAM` : 'Unavailable', title:sample.gpu?.name ?? 'No supported hardware GPU'},
      memory: {percent:percentage(sample.memory.usedBytes,sample.memory.totalBytes),detail:formatCapacity(sample.memory.usedBytes,sample.memory.totalBytes)},
      storage: {percent:sample.storage ? percentage(sample.storage.usedBytes,sample.storage.totalBytes) : null,detail:sample.storage ? formatCapacity(sample.storage.usedBytes,sample.storage.totalBytes) : 'Unavailable',title:sample.storage ? `${sample.storage.drive} · used storage` : 'Drive unavailable'},
    }
    for (const id of metricIds) {
      const view = views[id], reading = readings[id]
      view.value.children[0].textContent = reading.percent === null ? '—' : reading.percent.toFixed(0)
      ;(view.value.children[1] as HTMLElement).hidden = reading.percent === null
      view.detail.textContent = reading.detail
      view.detail.title = reading.title ?? reading.detail
      view.element.dataset.available = String(reading.percent !== null)
      view.element.setAttribute('aria-label', `${labels[id]}: ${reading.percent === null ? 'unavailable' : `${Math.round(reading.percent)} percent`}. ${reading.detail}`)
      view.fill.style.transform = `scaleX(${(reading.percent ?? 0) / 100})`
      view.circle.setAttribute('stroke-dasharray', `${reading.percent ?? 0} 100`)
      if (appendHistory) pushHistory(view.history,reading.percent)
      const offset = HISTORY_LENGTH - view.history.length
      view.historyBars.forEach((bar,index)=>{
        const value = index < offset ? null : view.history[index-offset]
        bar.classList.toggle('is-missing',value == null)
        const height = value == null ? 0 : Math.max(.04,value/100)
        ;(bar.firstElementChild as HTMLElement).style.transform = `scaleY(${height})`
      })
    }
  }
  return {
    configure, render,
    status(message: string | null, state: 'waiting' | 'stale' | 'error' = 'waiting') {
      status.hidden = message === null
      status.textContent = message
      panel.dataset.state = message === null ? 'live' : state
    },
    illustrative() { required<HTMLElement>('.hm-demo').hidden = false },
    dispose() { root.classList.remove('hm-root'); root.replaceChildren() },
  }
}
