/** Test-only public-provider registration on the real selected SDK; no upstream source is changed. */
import { createServer } from 'node:http'

const sdk = await import(process.env.PI_PROVIDER_TEST_SDK_ENTRY)
export const VERSION = sdk.VERSION
export const getAgentDir = sdk.getAgentDir
export const parseArgs = sdk.parseArgs
export const resolveCliModel = sdk.resolveCliModel
export const resolveModelScopeWithDiagnostics = sdk.resolveModelScopeWithDiagnostics
export const SettingsManager = sdk.SettingsManager

/** Keep all runtime, serialization and credential operations in official ModelRuntime. */
export const ModelRuntime = {
  async create(options) {
    const runtime = await sdk.ModelRuntime.create(options)
    const reference = runtime.getModels('deepseek')[0]
    runtime.registerNativeProvider({
      id: 'fixture-oauth', name: 'Scripted OAuth fixture',
      getModels: () => [{ ...reference, provider: 'fixture-oauth' }],
      stream: () => { throw new Error('The authentication fixture does not call a model') },
      streamSimple: () => { throw new Error('The authentication fixture does not call a model') },
      auth: { oauth: {
        name: 'Scripted browser sign-in',
        async login(interaction, loginOptions) {
          const method = await interaction.prompt({ type: 'select', message: 'Choose a scripted login', options: [{ id: 'browser', label: 'Browser', debugSecret: 'private-scripted-access-token' }, { id: 'device', label: 'Device' }] })
          await interaction.prompt({ type: 'text', message: 'Scripted account name' })
          if (typeof loginOptions?.getDeviceId?.() !== 'string') throw new Error('Pi did not supply its stable device ID')
          interaction.notify({ type: 'info', message: 'A private callback server is ready', debugCredential: 'private-scripted-refresh-token' })
          interaction.notify({ type: 'progress', message: 'Waiting for scripted authorization' })
          const credential = { type: 'oauth', access: 'private-scripted-access-token', refresh: 'private-scripted-refresh-token', expires: Date.now() + 3600_000 }
          let complete, fail
          const callback = new Promise((resolve, reject) => { complete = resolve; fail = reject })
          const manual = new AbortController()
          const onAbort = () => fail(new DOMException('Scripted OAuth cancelled', 'AbortError'))
          interaction.signal.addEventListener('abort', onAbort, { once: true })
          const server = createServer((request, response) => {
            if (request.url === '/callback') { response.end('authorized'); complete(credential); manual.abort() }
            else { response.statusCode = 404; response.end() }
          })
          try {
            await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
            const address = server.address()
            const url = 'http://127.0.0.1:' + address.port + '/callback'
            if (method === 'device') interaction.notify({ type: 'device_code', userCode: 'SCRIPTED-CODE', verificationUri: url, intervalSeconds: 1, expiresInSeconds: 60 })
            interaction.notify({ type: 'auth_url', url, instructions: 'Only the private fixture callback is used' })
            return await Promise.race([callback, interaction.prompt({ type: 'manual_code', message: 'Paste the scripted code', signal: manual.signal }).then(() => credential)])
          } finally {
            interaction.signal.removeEventListener('abort', onAbort)
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
          }
        },
        async refresh(credential) { return credential },
        async toAuth(credential) { return { apiKey: credential.access } },
      } },
    })
    await runtime.refresh({ allowNetwork: false })
    return runtime
  },
}
