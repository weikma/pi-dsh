/** Runtime artifacts use private caches and target metadata, never host global installs. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as tar from 'tar';
import { downloadVerified, extractSafe } from '../runtime/bundle-layout.mjs';
import { canReusePreparedPayload, packageMatchesTarget, prepareRuntime, pruneOptionalDependencies, smokeRuntime, validateBundleLock } from '../runtime/prepare-runtime.mjs';
import type { BundleManifest } from '../runtime/prepare-runtime.mjs';

test('downloads reject wrong bytes, recheck cached bytes, and isolate concurrent writers', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-runtime-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('official pinned artifact fixture\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end(bytes); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/artifact.tar.gz`;
  const cache = join(root, 'cache');
  const [first, second] = await Promise.all([
    downloadVerified({ url, sha256, cache }), downloadVerified({ url, sha256, cache }),
  ]);
  assert.equal(first, second);
  assert.deepEqual(await readFile(first), bytes);
  const fetched = requests;
  await downloadVerified({ url, sha256, cache });
  assert.equal(requests, fetched);
  await writeFile(first, 'corrupted cache');
  await downloadVerified({ url, sha256, cache });
  assert.deepEqual(await readFile(first), bytes);
  await assert.rejects(downloadVerified({ url, sha256: '0'.repeat(64), cache }), /integrity mismatch/u);
  assert.equal((await readdir(cache)).some(name => name.startsWith('.download-')), false);
  await assert.rejects(downloadVerified({ url, sha256, cache, filename: '../outside' }), /single path component/u);
});

test('tar extraction preserves contained links and rejects escaping paths and links', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-runtime-tar-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  await mkdir(join(source, 'package/bin'), { recursive: true });
  await mkdir(join(source, 'package/lib'));
  await writeFile(join(source, 'package/lib/cli.js'), 'console.log(7)\n');
  if (process.platform !== 'win32') await symlink('../lib/cli.js', join(source, 'package/bin/pi'));
  const archive = join(root, 'node.tgz');
  await tar.c({ gzip: true, file: archive, cwd: source }, ['package']);
  const output = join(root, 'output');
  await extractSafe({ archive, destination: output, strip: 1 });
  assert.equal(await readFile(join(output, 'lib/cli.js'), 'utf8'), 'console.log(7)\n');
  if (process.platform !== 'win32') {
    assert.equal(await readFile(join(output, 'bin/pi'), 'utf8'), 'console.log(7)\n');
    await symlink('../../../escape', join(source, 'package/bin/unsafe'));
    const unsafe = join(root, 'unsafe.tgz');
    await tar.c({ gzip: true, file: unsafe, cwd: source }, ['package']);
    await assert.rejects(extractSafe({ archive: unsafe, destination: join(root, 'rejected'), strip: 1 }), /link escapes/u);
    assert.deepEqual(await readdir(join(root, 'rejected')), []);
  }
  const traversal = join(root, 'traversal.tgz');
  await tar.c({ gzip: true, file: traversal, cwd: source, prefix: '../outside' }, ['package/lib/cli.js']);
  await assert.rejects(extractSafe({ archive: traversal, destination: join(root, 'rejected-path') }), /path escapes/u);
});

test('wheel archives are detected by ZIP bytes and retain package files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-runtime-wheel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = join(root, 'example-1.0-py3-none-any.whl');
  await writeFile(archive, Buffer.from('UEsDBBQAAAAAAOSqPl3iAzxFCgAAAAoAAAATAAAAZXhhbXBsZS9fX2luaXRfXy5weVZBTFVFID0gNwpQSwECFAMUAAAAAADkqj5d4gM8RQoAAAAKAAAAEwAAAAAAAAAAAAAAgAEAAAAAZXhhbXBsZS9fX2luaXRfXy5weVBLBQYAAAAAAQABAEEAAAA7AAAAAAA=', 'base64'));
  await extractSafe({ archive, destination: join(root, 'site-packages') });
  assert.equal(await readFile(join(root, 'site-packages/example/__init__.py'), 'utf8'), 'VALUE = 7\n');
});

test('each target keeps its native optional package and rejects missing required packages', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-runtime-platform-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = validateBundleLock(JSON.parse(await readFile(new URL('../runtime/bundle-lock.json', import.meta.url), 'utf8')));
  for (const [name, target] of Object.entries(lock.targets)) {
    const output = join(root, name);
    const packages: Record<string, { version: string; optional?: boolean; os?: string[]; cpu?: string[] }> = { '': { version: '1' } };
    packages['node_modules/required'] = { version: '1' };
    for (const [other, metadata] of Object.entries(lock.targets)) packages[`node_modules/native-${other}`] = { version: '1', optional: true, os: [metadata.os], cpu: [metadata.cpu] };
    for (const [path, metadata] of Object.entries(packages)) {
      if (!path) continue;
      await mkdir(join(output, path), { recursive: true });
      await writeFile(join(output, path, 'package.json'), JSON.stringify(metadata));
    }
    const removed = await pruneOptionalDependencies(output, { packages }, target);
    assert.equal(removed.length, 4);
    assert.ok((await stat(join(output, `node_modules/native-${name}/package.json`))).isFile());
    await rm(join(output, 'node_modules/required/package.json'));
    await assert.rejects(pruneOptionalDependencies(output, { packages }, target), /ENOENT/u);
  }
  assert.equal(packageMatchesTarget({ os: ['!win32'] }, { os: 'win32', cpu: 'x64' }), false);
  assert.equal(packageMatchesTarget({ os: ['!win32'] }, { os: 'darwin', cpu: 'arm64' }), true);
  await assert.rejects(pruneOptionalDependencies(root, { packages: { 'node_modules/required': { version: '1', os: ['aix'] } } }, { os: 'darwin', cpu: 'arm64' }), /Required package does not support/u);
});

test('unsupported targets and unowned output directories fail before downloads', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-runtime-owned-output-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(prepareRuntime({ target: 'unsupported', output: root }), /Unsupported bundled runtime target/u);
  await writeFile(join(root, 'operator-file'), 'keep me');
  await assert.rejects(prepareRuntime({ target: 'mac-arm64', output: root }), /must be empty/u);
  assert.equal(await readFile(join(root, 'operator-file'), 'utf8'), 'keep me');
  const lock = JSON.parse(await readFile(new URL('../runtime/bundle-lock.json', import.meta.url), 'utf8'));
  lock.pi.url = 'https://another-registry.example/pi.tgz';
  assert.throws(() => validateBundleLock(lock), /Unrecognized pi package source/u);
  assert.equal(dirname(root), tmpdir());
});

test('a cached descriptor without release license fields is rebuilt before file validation', () => {
  const previous = {
    format: 'pi-dsh-runtime-v1', mainDigest: 'same-lock-digest',
    node: { executable: 'node/bin/node' }, pi: { cli: 'pi/cli.js', lockfile: 'pi/package-lock.json' },
    pnpm: { cli: 'pnpm/bin/pnpm.mjs', packageRoot: 'pnpm' },
    tools: { ripgrep: { executable: 'bin/rg' }, fd: { executable: 'bin/fd' } },
  };
  assert.equal(canReusePreparedPayload(previous, 'same-lock-digest'), false);
  assert.equal(canReusePreparedPayload({ ...previous, payloadRevision: 2 }, 'same-lock-digest'), false);
  assert.equal(canReusePreparedPayload({ ...previous, payloadRevision: 2, pi: { ...previous.pi, licenseFile: 'licenses/pi/LICENSE' } }, 'same-lock-digest'), false);
  const current = { ...previous, payloadRevision: 3, pi: { ...previous.pi, licenseFile: 'licenses/pi/LICENSE' } };
  assert.equal(canReusePreparedPayload(current, 'same-lock-digest'), true);
  assert.equal(canReusePreparedPayload(current, 'changed-lock-digest'), false);
});

test('prepared native payload runs official binaries and relocated POSIX wrappers', async (t) => {
  const explicit = process.env.PI_DSH_TEST_RUNTIME;
  const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform;
  const payload = explicit ?? fileURLToPath(new URL(`../.pi-dsh-build/runtime/${platform}-${process.arch}`, import.meta.url));
  let source: string;
  try { source = await readFile(join(payload, 'manifest.json'), 'utf8'); }
  catch (error) {
    if (!explicit && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      t.skip('Prepare the native runtime, or set PI_DSH_TEST_RUNTIME to its directory');
      return;
    }
    throw error;
  }
  const manifest: BundleManifest = JSON.parse(source);
  assert.deepEqual(manifest.pi.defaultArgs, [], 'The bundled selection must preserve native tool settings and extension tools');
  assert.deepEqual(await smokeRuntime(payload, manifest), {
    node: '24.21.0', pi: '0.99.1', pnpm: '11.7.0', ripgrep: '15.2.0', fd: '10.3.0',
  });
  if (process.platform === 'win32') return;
  const root = await mkdtemp(join(tmpdir(), 'pi runtime relocated-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'bin'));
  for (const directory of ['node', 'pi', 'pnpm']) await symlink(join(payload, directory), join(root, directory));
  for (const name of ['pi', 'pnpm'] as const) {
    await cp(join(payload, 'bin', name), join(root, 'bin', name));
    const { stdout } = await promisify(execFile)(join(root, 'bin', name), ['--version'], { timeout: 60_000 });
    assert.equal(stdout.trim(), manifest[name].version);
  }
});
