/** Component regressions use the production source aliases and real CSS primitives. */
import { defineConfig, mergeConfig } from 'vitest/config'
import client from './vite.config.ts'

export default mergeConfig(client, defineConfig({ test: { environment: 'jsdom', include: ['../tests/*.client.spec.tsx', '../../../packages/client/ui-primitives/tests/tooltip*.client.spec.*', '../../../packages/client/ui-primitives/tests/markdown*.client.spec.*', '../../../packages/client/ui-primitives/tests/{code-block,streaming-code-block,read-block,diff-block,icons}.client.spec.tsx'], clearMocks: true, restoreMocks: true } }))
