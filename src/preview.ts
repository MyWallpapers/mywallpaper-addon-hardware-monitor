// Development-only host. Vite builds only main.ts for the release.
import { mount } from './main'
import { layouts, isHardwareSample, type Layout } from './model'
import { createPreviewContext } from './preview-host'
import type { JsonValue, NativeConnection, NativeConnectionState } from '../generated/mywallpaper-runtime'
import './preview.css'
const titles: Record<Layout,string> = {bars:'Minimal bars',rings:'Rings',history:'Live history',overview:'CPU overview',compact:'Compact strip'}
const host=document.querySelector<HTMLElement>('#preview')!
host.innerHTML=`<header class="preview-header"><div><h1>Hardware Monitor</h1><p>Live measurements from this Windows PC</p></div><label>Layout <select>${layouts.map(layout=>`<option value="${layout}">${titles[layout]}</option>`).join('')}</select></label><label class="preview-checkbox"><input type="checkbox">All layouts</label></header><main class="preview-grid"></main><p class="preview-note" role="status">Connecting to the native sampler…</p>`
const select=host.querySelector<HTMLSelectElement>('select')!
const all=host.querySelector<HTMLInputElement>('input')!
const grid=host.querySelector<HTMLElement>('.preview-grid')!
const note=host.querySelector<HTMLElement>('.preview-note')!
let latest: JsonValue | null=null
let state:NativeConnectionState='reconnecting'
const subscribers=new Set<(payload:JsonValue)=>void>(), stateSubscribers=new Set<(state:NativeConnectionState)=>void>()
const source=new EventSource('/__hardware-preview/metrics')
source.onmessage=event=>{
 let payload:unknown
 try{payload=JSON.parse(event.data)}catch{return}
 if (!isHardwareSample(payload)) {
  note.textContent=typeof payload === 'object' && payload !== null && 'message' in payload ? String(payload.message) : 'Invalid hardware sample'
  for(const listener of subscribers) listener(payload as JsonValue)
  return
 }
 latest=payload as unknown as JsonValue
 state='open'
 note.textContent=`Windows sampler connected · ${payload.gpu?.name ?? 'GPU unavailable'} · ${payload.storage?.drive ?? 'Drive unavailable'} · refresh every 2 seconds`
 for(const listener of stateSubscribers)listener(state)
 for(const listener of subscribers)listener(latest)
}
source.onerror=()=>{state='reconnecting';note.textContent='Native sampler connection interrupted';for(const listener of stateSubscribers)listener(state)}
function connect(): NativeConnection {
 const ownMessages=new Set<(payload:JsonValue)=>void>(),ownStates=new Set<(state:NativeConnectionState)=>void>()
 return {get state(){return state},send:async()=>{throw new Error('Preview has no native commands')},
  onMessage(listener){subscribers.add(listener);ownMessages.add(listener);if(latest)queueMicrotask(()=>{if(ownMessages.has(listener)&&latest)listener(latest)});return()=>{subscribers.delete(listener);ownMessages.delete(listener)}},
  onStateChange(listener){stateSubscribers.add(listener);ownStates.add(listener);return()=>{stateSubscribers.delete(listener);ownStates.delete(listener)}},
  close(){for(const listener of ownMessages)subscribers.delete(listener);for(const listener of ownStates)stateSubscribers.delete(listener);ownMessages.clear();ownStates.clear()},
 }
}
let cleanups:(()=>void)[]=[]
function display(){
 for(const cleanup of cleanups)cleanup()
 cleanups=[]
 grid.replaceChildren()
 grid.classList.toggle('show-all',all.checked)
 for(const layout of all.checked?layouts:[select.value as Layout]){
  const section=document.createElement('section'),title=document.createElement('h2'),root=document.createElement('div')
  title.textContent=titles[layout];root.className=`preview-widget layout-${layout}`
  section.append(title,root);grid.append(section)
  const context=createPreviewContext(root,layout,connect)
  const cleanup=mount(context);cleanups.push(cleanup)
 }
}
select.addEventListener('change',display);all.addEventListener('change',display)
display()
window.addEventListener('pagehide',()=>{source.close();for(const cleanup of cleanups)cleanup()},{once:true})
