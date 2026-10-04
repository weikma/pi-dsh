import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

test('a missing Desktop installation cannot silently select terminal PATH Pi', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-runtime-isolation-'))
  try {
    const module = new URL('../runtime/config.ts', import.meta.url).href
    const code = `import { loadRuntime } from ${JSON.stringify(module)}; import assert from 'node:assert/strict'; await assert.rejects(loadRuntime(process.argv[1]), /No Desktop Pi runtime is installed/); console.log('isolated');`
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code, root], {
      env: { ...process.env, PI_DSH_RUNTIME_CONFIG: undefined, PI_DSH_BUNDLED_RUNTIME: undefined, PI_EXECUTABLE: undefined }, timeout: 15_000,
    })
    assert.equal(result.stdout.trim(), 'isolated')
  } finally { await rm(root, { recursive: true, force: true }) }
})
