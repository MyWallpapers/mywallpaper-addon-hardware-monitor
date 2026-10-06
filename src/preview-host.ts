// Development-only host contexts. The release imports neither this file nor the previews.
import type { CanvasAddonMountContext, JsonValue, NativeConnection } from '../generated/mywallpaper-runtime'
import { defaults } from './settings'
import type { Layout } from './model'

export function createPreviewContext(root: HTMLElement, layout: Layout, connect: () => NativeConnection, mode: 'interactive' | 'thumbnail' = 'interactive'): CanvasAddonMountContext {
  const values = { ...defaults, layout } as unknown as Record<string, JsonValue>
  return {
    runtime: { surface: 'interface', mode, instance: { instanceId: `preview-${layout}`, displayIndex: 0, displayCount: 1, canonical: true, width: root.clientWidth, height: root.clientHeight } },
    layer: {
      root, layerId: `preview-${layout}`,
      settings: { get: () => values, set: async () => {}, subscribe: listener => { listener(values); return () => {} } },
      deviceSettings: { get: () => ({ refreshInterval: '2s', drive: '' }), set: async () => {}, subscribe: () => () => {} },
      actions: { on: () => () => {} }, lifecycle: { onDispose: () => () => {} }, resources: { resolve: async value => value.url },
      native: { companion: { available: mode !== 'thumbnail', connect: async () => connect() }, hooks: { available: false, status: () => null, onStateChange: () => () => {} } },
      bus: { on: () => () => {}, emit: () => {} },
    },
    bus: { on: () => () => {}, emit: () => {} },
    services: { connect: async () => { throw new Error('No services in preview') }, provide: () => { throw new Error('No services in preview') } },
  }
}
