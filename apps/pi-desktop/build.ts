/** Build the shared GUI and Electron/Host entries independently of the distribution payload. */
import { build as bundle } from 'esbuild'
import { build as buildClient } from 'vite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
/** Compile the isolated Electron entry and sandboxed preload. */
export async function buildElectron(): Promise<void> {
  await bundle({ entryPoints: [join(root, 'runtime', 'package-worker.ts')], outfile: join(root, 'dist', 'package-worker.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' })
  await bundle({ entryPoints: [join(root, 'runtime', 'pi-session-controls.ts')], outfile: join(root, 'dist', 'pi-session-controls.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' })
  await bundle({ entryPoints: [join(root, 'runtime', 'provider-worker.ts')], outfile: join(root, 'dist', 'provider-worker.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22' })
  await bundle({ entryPoints: [join(root, 'main.ts'), join(root, 'server.ts')], outdir: join(root, 'dist'), outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', sourcemap: true })
  await bundle({ entryPoints: [join(root, 'preload.ts')], outfile: join(root, 'dist', 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node22' })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildElectron()
  await buildClient({ configFile: join(root, 'vite.config.ts') })
}
import './prepare-pty.mjs'
