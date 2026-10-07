/** Ship independently executable, pinned runtimes outside Electron's ASAR. */
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { access } = require('node:fs/promises')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { Arch } = require('electron-builder')
module.exports = {
  appId: 'im.pi.dsh', productName: 'Pi DSH',
  artifactName: 'pi-dsh-${version}-${os}-${arch}.${ext}',
  extraMetadata: { name: 'pi-dsh' },
  directories: { app: 'apps/pi-dsh', output: 'release' },
  files: ['dist/**', '!dist/provider-worker.mjs', '!dist/package-worker.mjs', '!dist/pi-session-controls.mjs', 'assets/**', 'package.json'],
  asar: true,
  // Windows uses node-pty's shipped Node-API prebuilds without a Visual Studio rebuild.
  npmRebuild: process.platform !== 'win32',
  asarUnpack: ['node_modules/node-pty/**'],
  extraResources: [
    { from: 'apps/pi-dsh/.pi-dsh-build/runtime/${os}-${arch}', to: 'runtime', filter: ['**/*'] },
    { from: 'apps/pi-dsh/assets/office-preview.py', to: 'office-preview.py' },
    { from: 'apps/pi-dsh/dist/provider-worker.mjs', to: 'provider-worker.mjs' },
    { from: 'apps/pi-dsh/dist/package-worker.mjs', to: 'package-worker.mjs' },
    { from: 'apps/pi-dsh/dist/pi-session-controls.mjs', to: 'pi-session-controls.mjs' },
    { from: 'LICENSE', to: 'licenses/DeepSeekHarness-LICENSE' },
    { from: 'THIRD_PARTY_NOTICES.md', to: 'licenses/THIRD_PARTY_NOTICES.md' },
  ],
  beforePack: async context => {
    const target = context.packager.platform.buildConfigurationKey + '-' + Arch[context.arch]
    const { prepareRuntime } = await import(pathToFileURL(join(__dirname, 'runtime', 'prepare-runtime.mjs')).href)
    await prepareRuntime({ target, output: join(__dirname, '.pi-dsh-build', 'runtime', target) })
  },
  afterPack: async context => {
    const resources = context.packager.getResourcesDir(context.appOutDir)
    await access(join(resources, 'office-preview.py'))
    await access(join(resources, 'provider-worker.mjs'))
    await access(join(resources, 'package-worker.mjs'))
    await access(join(resources, 'pi-session-controls.mjs'))
    if (context.electronPlatformName !== process.platform || Arch[context.arch] !== process.arch) return
    // Native public-tool execution catches files and empty directories lost during packaging.
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--test', join(__dirname, 'tests', 'auxiliary-flow.test.ts'), join(__dirname, 'tests', 'packaged-provider.test.ts'), join(__dirname, 'tests', 'pi-flow.test.ts'), join(__dirname, 'tests', 'resource-recovery.test.ts'), join(__dirname, 'tests', 'session-title-flow.test.ts')], {
      cwd: join(__dirname, '..', '..'), env: { ...process.env, PI_DSH_TEST_RUNTIME: join(resources, 'runtime'), PI_DSH_TEST_PACKAGED_PROVIDER_WORKER: join(resources, 'provider-worker.mjs'), PI_DSH_SESSION_EXTENSION: join(resources, 'pi-session-controls.mjs') }, timeout: 120_000, maxBuffer: 1024 * 1024,
    })
    process.stdout.write(result.stdout)
  },
  mac: { icon: 'apps/pi-dsh/assets/icon-macos.png', category: 'public.app-category.developer-tools', target: [{ target: 'dmg', arch: ['arm64', 'x64'] }, { target: 'zip', arch: ['arm64', 'x64'] }], hardenedRuntime: true },
  win: { icon: 'apps/pi-dsh/assets/icon-windows.ico', target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  linux: { icon: 'apps/pi-dsh/assets/icon-windows.png', category: 'Development', target: ['AppImage', 'deb'] },
}
