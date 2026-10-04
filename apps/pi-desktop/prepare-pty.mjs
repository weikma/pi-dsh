/** npm's node-pty prebuild omits the helper's executable bit; fix it before execution or packaging. */
import { chmod, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const require = createRequire(import.meta.url)
const root = dirname(require.resolve('node-pty/package.json'))
for (const target of await readdir(join(root, 'prebuilds'), { withFileTypes: true })) {
  if (target.isDirectory() && /^(darwin|linux)-/.test(target.name)) await chmod(join(root, 'prebuilds', target.name, 'spawn-helper'), 0o755)
}
