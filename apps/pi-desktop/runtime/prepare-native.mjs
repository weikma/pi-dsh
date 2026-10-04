/** Prepare or validate the complete runtime for a source checkout's native target. */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareRuntime, smokeRuntime } from './prepare-runtime.mjs'
import { smokeAuxiliary } from './prepare-auxiliary.mjs'

const target = (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform) + '-' + process.arch
const root = join(dirname(dirname(fileURLToPath(import.meta.url))), '.desktop-build', 'runtime', target)
const manifest = await prepareRuntime({ target, output: root })
console.log('Prepared independent runtime: ' + root)
if (process.argv.includes('--smoke')) {
  console.log(JSON.stringify({ runtime: await smokeRuntime(root, manifest), auxiliary: await smokeAuxiliary(root, manifest.auxiliary) }, null, 2))
}
