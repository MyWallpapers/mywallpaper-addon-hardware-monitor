// Development utilities; excluded from the published Canvas bundle.
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function spawnCompanion() {
  const builtExecutable = fileURLToPath(new URL('../native/out/windows-x86_64/bin/hardware-monitor.exe', import.meta.url))
  // A running Windows executable is locked. Keep the build output free for CLI rebuilds.
  const previewDirectory = fileURLToPath(new URL('../.preview/native/', import.meta.url))
  mkdirSync(previewDirectory, { recursive: true })
  const instanceDirectory = mkdtempSync(join(previewDirectory, 'session-'))
  const executable = join(instanceDirectory, 'hardware-monitor.exe')
  const cleanup = () => rmSync(instanceDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  try {
    copyFileSync(builtExecutable, executable)
    if (process.platform === 'linux') chmodSync(executable, 0o755)
  } catch (error) { cleanup(); throw error }
  const env = { ...process.env, MYWALLPAPER_PROTOCOL: 'process-v2' }
  if (process.platform === 'linux' && process.env.WSL_INTEROP) {
    env.WSLENV = [env.WSLENV, 'MYWALLPAPER_PROTOCOL/w'].filter(Boolean).join(':')
  }
  const native = spawn(executable, [], { env, stdio: ['pipe', 'pipe', 'inherit'] })
  native.once('close', cleanup)
  return native
}

export function sendFrame(native, value) {
  const bytes = Buffer.from(JSON.stringify(value))
  if (bytes.length > 1024 * 1024) throw new Error('Preview frames must fit one physical chunk')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(bytes.length)
  native.stdin.write(Buffer.concat([header, bytes]))
}

export function receiveFrames(native, onFrame, onError) {
  let buffer = Buffer.alloc(0)
  native.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    try {
      while (buffer.length >= 4) {
        const header = buffer.readUInt32LE(0)
        if (header >>> 30 !== 0 || header === 0 || header > 1024 * 1024) {
          throw new Error('Invalid native sample frame')
        }
        if (buffer.length < header + 4) return
        const record = JSON.parse(buffer.subarray(4, header + 4).toString('utf8'))
        buffer = buffer.subarray(header + 4)
        onFrame(record)
      }
    } catch (error) { onError(error) }
  })
}
