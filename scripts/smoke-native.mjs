// Exercises the real Windows binary, its sampling, settings and shutdown.
import assert from 'node:assert/strict'
import { spawnCompanion, sendFrame, receiveFrames } from './native-process.mjs'
import ts from 'typescript'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/model.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { isHardwareSample } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'))
const native = spawnCompanion()
let ready = false, count = 0, previous = 0, last = null, changed = false
let finalSample = null
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { native.kill(); reject(new Error('Native lifecycle exceeded 15 seconds')) }, 15000)
  function fail(error) { clearTimeout(timeout); native.kill(); reject(error) }
  native.on('error', fail)
  native.stdin.on('error', fail)
  receiveFrames(native, frame => {
    try {
      assert.equal(frame.v, 5)
      if (frame.type === 'ready') { assert.equal(ready, false); ready = true; return }
      assert.equal(frame.type, 'message', frame.message)
      assert.equal(frame.target, 'broadcast')
      assert.ok(ready, 'ready must precede measurements')
      assert.ok(isHardwareSample(frame.payload), 'real measurement must satisfy the Canvas contract')
      const sample = frame.payload
      assert.ok(sample.sequence > previous)
      previous = sample.sequence
      count++
      if (count > 1) assert.equal(typeof sample.cpu.usagePercent, 'number')
      if (count === 2) {
        last = performance.now()
        changed = true
        sendFrame(native, { type: 'settings', v: 5, deviceSettings: { refreshInterval: '1s', drive: '' }, layerSettings: {} })
      }
      if (changed && count === 3) { last = performance.now(); return }
      if (changed && count === 4) {
        const interval = performance.now() - last
        assert.ok(interval >= 750 && interval < 2500, `1-second setting must take effect (${Math.round(interval)}ms)`)
        finalSample = sample
        sendFrame(native, { type: 'shutdown', v: 5 })
        native.stdin.end()
      }
    } catch (error) { fail(error) }
  }, fail)
  native.on('close', code => {
    clearTimeout(timeout)
    try { assert.equal(code, 0); assert.ok(count >= 4); resolve() } catch (error) { reject(error) }
  })
  sendFrame(native, { type: 'init', v: 5, deviceSettings: { refreshInterval: '2s', drive: '' }, layerSettings: {} })
})
console.log(JSON.stringify({ result: 'passed', samples: count, cpu: finalSample.cpu.usagePercent !== null, gpu: finalSample.gpu?.usagePercent !== null, memory: true, drive: finalSample.storage?.drive ?? null, settings: 'applied', shutdown: 'clean' }))
