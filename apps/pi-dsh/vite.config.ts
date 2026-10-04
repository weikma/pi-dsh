/** Bundle retained DSH UI libraries directly from source. */
import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const app = dirname(fileURLToPath(import.meta.url))
const repo = resolve(app, '../..')
export default defineConfig({
  root: resolve(app, 'client'),
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    '@deepseek-ai/dsh-client-ui-primitives': resolve(repo, 'packages/client/ui-primitives/src/index.ts'),
    '@deepseek-ai/dsh-client-store': resolve(repo, 'packages/client/store/src/index.ts'),
    '@deepseek-ai/dsh-client-ui-dockkit': resolve(repo, 'packages/client/ui-dockkit/src/index.ts'),
    '@deepseek-ai/dsh-brand': resolve(repo, 'packages/util/brand/src/index.ts'),
    '@deepseek-ai/dsh-util-code-language': resolve(repo, 'packages/util/code-language/src/index.ts'),
    '@deepseek-ai/dsh-util-workspace-path': resolve(repo, 'packages/util/workspace-path/src/index.ts'),
  } },
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy: { '^/api/': { target: 'http://127.0.0.1:' + (process.env.PI_DSH_PORT ?? 19388), changeOrigin: true } } },
  build: { outDir: resolve(app, 'dist/client'), emptyOutDir: true },
})
