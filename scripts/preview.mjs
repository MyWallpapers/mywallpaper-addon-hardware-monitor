import { createServer } from 'vite'
import { spawnCompanion, sendFrame, receiveFrames } from './native-process.mjs'

const native = spawnCompanion()
const clients = new Set()
let latest = null
let stopping = false
function broadcast(value) {
  latest = value
  for (const response of clients) response.write(`data: ${JSON.stringify(value)}\n\n`)
}
function fail(error) { broadcast({ kind: 'hardware.error', message: error.message }) }
receiveFrames(native, message => {
  if (message.type === 'message') broadcast(message.payload)
  if (message.type === 'error') fail(new Error(message.message))
}, error => { fail(error); native.kill() })
native.on('error', fail)
native.stdin.on('error', error => { if (!stopping) fail(error) })
native.on('exit', code => { if (!stopping) fail(new Error(`Native sampler stopped (${code})`)) })
sendFrame(native, { type: 'init', v: 5, deviceSettings: { refreshInterval: '2s', drive: '' }, layerSettings: {} })
const server = await createServer({
  configLoader: 'native',
  server: { host: '127.0.0.1', port: 5196, strictPort: true },
  plugins: [{
    name: 'local-hardware-preview',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/__hardware-preview/metrics') return next()
        if (request.method !== 'GET') { response.statusCode = 405; response.end(); return }
        response.writeHead(200, {
          'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
          'Connection': 'keep-alive', 'X-Content-Type-Options': 'nosniff',
        })
        clients.add(response)
        response.write(': Local Hardware Monitor\n\n')
        if (latest) response.write(`data: ${JSON.stringify(latest)}\n\n`)
        request.on('close', () => clients.delete(response))
      })
    },
  }],
})
async function stop() {
  if (stopping) return
  stopping = true
  if (!native.stdin.destroyed) { sendFrame(native, { type: 'shutdown', v: 5 }); native.stdin.end() }
  for (const response of clients) response.end()
  await server.close()
}
try { await server.listen() } catch (error) { await stop(); throw error }
console.log('Hardware Monitor · live Windows preview: http://localhost:5196/preview.html')
process.on('SIGINT', () => { void stop().then(() => process.exit()) })
process.on('SIGTERM', () => { void stop().then(() => process.exit()) })
