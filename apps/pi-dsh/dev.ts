/** Run the shared local GUI with optional native Electron presentation. */
import { createServer as createViteServer, loadEnv } from 'vite'
import { spawn } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { buildElectron } from './build.ts'
import { startHost } from './server.ts'

const root = dirname(fileURLToPath(import.meta.url))
const environment = loadEnv('development', resolve(root, '../..'), '')
for (const [key, value] of Object.entries(environment)) if (process.env[key] === undefined) process.env[key] = value
const port = Number(process.env.PI_DSH_PORT ?? 19388)
const host = await startHost({ port, allowedOrigins: ['http://127.0.0.1:5174'] })
const vite = await createViteServer({ configFile: join(root, 'vite.config.ts') })
await vite.listen()
console.log('Pi DSH Web: http://127.0.0.1:5174')
let stopping: Promise<void> | undefined
const stop = (): Promise<void> => stopping ??= (async () => { await vite.close(); await host.close() })()
process.once('SIGINT', () => { void stop() }); process.once('SIGTERM', () => { void stop() })
if (process.argv[2] === 'desktop') {
  await buildElectron()
  const child = spawn(String(electron), [root], { env: { ...process.env, PI_DSH_UI_URL: 'http://127.0.0.1:5174', PI_DSH_HOST_URL: host.url }, stdio: 'inherit' })
  child.once('error', error => { console.error(error); void stop() })
  child.once('exit', code => { process.exitCode = code ?? 1; void stop() })
  process.once('SIGINT', () => { child.kill() }); process.once('SIGTERM', () => { child.kill() })
}
