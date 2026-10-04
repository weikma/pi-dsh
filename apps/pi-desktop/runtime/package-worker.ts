/** One package operation under the selected public Pi SDK; fd 3 stays separate from package-manager output. */
import { writeFileSync } from 'node:fs'
import { isJsonObject } from '../bridge/types.ts'
import { AgentConfiguration } from './agent-configuration.ts'

let source = ''
for await (const chunk of process.stdin) {
  source += String(chunk)
  if (source.length > 64 * 1024) throw new Error('Package operation input exceeds 64 KiB')
}
try {
  const input: unknown = JSON.parse(source)
  if (!isJsonObject(input) || typeof input.sdkEntry !== 'string' || typeof input.cwd !== 'string' || typeof input.agentDir !== 'string' || !isJsonObject(input.action)) throw new Error('Invalid package operation')
  const sdk: unknown = await import(input.sdkEntry)
  await new AgentConfiguration(sdk, input.cwd, input.agentDir).update(input.action)
  writeFileSync(3, JSON.stringify({ success: true }) + '\n')
} catch (error) {
  writeFileSync(3, JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Pi package operation failed' }) + '\n')
  process.exitCode = 1
}
