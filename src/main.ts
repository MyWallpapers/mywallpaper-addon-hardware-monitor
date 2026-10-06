import './styles.css'
import type { CanvasAddonMountContext, NativeConnection } from '../generated/mywallpaper-runtime'
import { createView } from './view'
import { isHardwareSample, type HardwareSample } from './model'
import { readSettings, refreshMs } from './settings'

// Synthetic values are confined to the host's non-executing thumbnail mode.
const thumbnailSample: HardwareSample = {
  kind:'hardware.sample', schemaVersion:1, sequence:0, capturedAtUnixMs:0,
  cpu:{usagePercent:18,frequencyMHz:4200,logicalProcessors:16},
  gpu:{name:'Illustrative GPU',usagePercent:37,dedicatedTotalBytes:8*1024**3},
  memory:{usedBytes:17.3*1024**3,totalBytes:32*1024**3},
  storage:{drive:'C:',usedBytes:320*1024**3,totalBytes:930*1024**3},
}
export function mount({layer,runtime}: CanvasAddonMountContext): () => void {
  const view = createView(layer.root)
  let disposed = false, connection: NativeConnection | null = null
  let sample: HardwareSample | null = null, lastReceived = 0, interval = refreshMs(layer.deviceSettings.get())
  const stops: (()=>void)[] = []
  view.configure(readSettings(layer.settings.get()))
  stops.push(layer.settings.subscribe(values=>{
    if (disposed) return
    view.configure(readSettings(values))
    if (sample) view.render(sample,false)
  }))
  if (runtime.mode === 'thumbnail') {
    view.render(thumbnailSample)
    view.status(null)
    view.illustrative()
    return dispose
  }
  stops.push(layer.deviceSettings.subscribe(values=>{ interval = refreshMs(values) }))
  const freshnessTimer = setInterval(()=>{
    if (sample && lastReceived && performance.now()-lastReceived > interval*3+1000) {
      view.status('Data paused · check the add-on diagnostics','stale')
    }
  },1000)
  stops.push(()=>clearInterval(freshnessTimer))
  void connect()
  async function connect() {
    try {
      const attached = await layer.native.companion.connect()
      if (disposed) { attached.close(); return }
      connection = attached
      stops.push(attached.onMessage(payload=>{
        if (disposed) return
        if (payload !== null && typeof payload === 'object' && !Array.isArray(payload) && payload.kind === 'hardware.error') {
          view.status('Hardware sampling failed · check the add-on diagnostics','error')
          return
        }
        if (!isHardwareSample(payload)) return
        if (sample && payload.sequence <= sample.sequence) return
        sample=payload
        lastReceived=performance.now()
        view.render(payload)
        view.status(null)
      }))
      stops.push(attached.onStateChange(state=>{
        if (disposed) return
        if (state === 'reconnecting') {
          sample=null // A restarted sampler begins its own sequence.
          view.status('Reconnecting to local hardware…','stale')
        } else if (state === 'failed' || state === 'closed') {
          view.status('Monitoring unavailable · check the add-on diagnostics','error')
        } else if (!sample) view.status('Waiting for the first hardware sample…')
      }))
    } catch {
      if (!disposed) view.status('Native monitoring requires MyWallpaper Desktop','error')
    }
  }
  function dispose() {
    if (disposed) return
    disposed=true
    for (const stop of stops) stop()
    connection?.close()
    view.dispose()
  }
  return dispose
}
