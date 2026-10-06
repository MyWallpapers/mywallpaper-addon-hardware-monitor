import { spawnSync } from 'node:child_process'
for (const script of ['node_modules/typescript/bin/tsc', 'node_modules/vite/bin/vite.js']) {
  const result = spawnSync(process.execPath, [script, ...(script.endsWith('tsc') ? ['--noEmit'] : ['build', '--configLoader', 'native'])], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
