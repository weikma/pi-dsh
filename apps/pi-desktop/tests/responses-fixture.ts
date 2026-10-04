/** A private Responses provider for the selected official Pi; no external model access. */
import { createServer, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isJsonObject, type JsonObject, type PiRuntime } from '../bridge/types.ts'
import { loadRuntime } from '../runtime/config.ts'
import { bundledPi, readBundledRuntime } from '../runtime/bundled.ts'

export const FINAL_THINKING = 'Check the project report, then read it back before answering.'

/** Barriers hold selected provider requests after thinking_end, before tool or message completion. */
export async function createResponsesFixture(holdSummary = false, heldRounds: readonly number[] = [], holdTitle = false) {
  const selected = process.env.PI_DESKTOP_TEST_RUNTIME ? bundledPi(await readBundledRuntime(process.env.PI_DESKTOP_TEST_RUNTIME)) : await loadRuntime()
  const root = await mkdtemp(join(tmpdir(), 'pi-responses-'))
  const agentDir = join(root, 'agent'), cwd = join(root, 'workspace')
  const requests: JsonObject[] = []
  const titleRequests: JsonObject[] = []
  let releaseTitle!: () => void
  const titleBarrier = new Promise<void>(resolve => { releaseTitle = resolve })
  if (!holdTitle) releaseTitle()
  const barriers = new Map<number, { wait: Promise<void>; release: () => void }>()
  for (const round of new Set([...(holdSummary ? [1] : []), ...heldRounds])) {
    let complete!: () => void
    const wait = new Promise<void>(resolve => { complete = resolve })
    barriers.set(round, { wait, release: complete })
  }
  const release = (round = 1) => { barriers.get(round)?.release() }
  let active: ServerResponse | undefined
  let bound = false
  const server = createServer((request, response) => {
    void (async () => {
      let source = ''
      for await (const chunk of request) source += String(chunk)
      const body: unknown = JSON.parse(source)
      if (!isJsonObject(body)) throw new Error('Responses fixture requires a JSON object')
      if (Array.isArray(body.input) && body.input.some(item => isJsonObject(item) && item.role === 'developer' && typeof item.content === 'string' && item.content.startsWith('Create a concise title for an AI coding-assistant session'))) {
        titleRequests.push(body)
        await titleBarrier
        if (response.destroyed) return
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        const emitTitle = (event: JsonObject) => response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
        const item = { id: 'title-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '项目报告生成与核验', annotations: [] }] }
        emitTitle({ type: 'response.created', response: { id: 'title-response', status: 'in_progress', output: [] } })
        emitTitle({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })
        emitTitle({ type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: '项目报告生成与核验' })
        emitTitle({ type: 'response.output_item.done', output_index: 0, item })
        emitTitle({ type: 'response.completed', response: { id: 'title-response', status: 'completed', output: [item], usage: { input_tokens: 80, output_tokens: 12, total_tokens: 92 } } })
        response.end()
        return
      }
      requests.push(body)
      const round = requests.length
      let sequence = 0
      const emit = (event: JsonObject) => response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify({ ...event, sequence_number: sequence++ })}\n\n`)
      const responseId = `resp_${round}`
      const empty = round > 3
      const summary = empty ? '' : round === 1 ? FINAL_THINKING : round === 2 ? 'The report was written. Read it back to confirm the contents.' : 'The report matches the requested result.'
      const reasoning = { id: `rs_${round}`, type: 'reasoning', summary: summary ? [{ type: 'summary_text', text: summary }] : [] }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      active = response
      emit({ type: 'response.created', response: { id: responseId, status: 'in_progress', output: [] } })
      emit({ type: 'response.output_item.added', output_index: 0, item: { ...reasoning, summary: [] } })
      if (round === 2 || round === 3) {
        emit({ type: 'response.reasoning_summary_part.added', output_index: 0, item_id: reasoning.id, summary_index: 0, part: { type: 'summary_text', text: '' } })
        emit({ type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: reasoning.id, summary_index: 0, delta: summary })
      }
      emit({ type: 'response.output_item.done', output_index: 0, item: reasoning })
      await barriers.get(round)?.wait
      if (response.destroyed) return
      let item: JsonObject
      if (round <= 2) {
        const name = round === 1 ? 'write' : 'read'
        const args = round === 1 ? { path: 'report.md', content: '# Report\n\nThinking summaries use the standard Pi transcript.\n' } : { path: 'report.md' }
        item = { id: `fc_${round}`, type: 'function_call', call_id: `call_${round}`, name, arguments: JSON.stringify(args), status: 'completed' }
        emit({ type: 'response.output_item.added', output_index: 1, item: { ...item, arguments: '', status: 'in_progress' } })
        emit({ type: 'response.function_call_arguments.delta', output_index: 1, item_id: item.id, delta: item.arguments })
      } else {
        const text = empty ? 'The response is complete. No thinking text accompanied this reply.' : 'Created **report.md** and read it back successfully.'
        item = { id: `msg_${round}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
        emit({ type: 'response.output_item.added', output_index: 1, item: { ...item, content: [], status: 'in_progress' } })
        emit({ type: 'response.output_text.delta', output_index: 1, item_id: item.id, content_index: 0, delta: text })
      }
      emit({ type: 'response.output_item.done', output_index: 1, item })
      emit({ type: 'response.completed', response: { id: responseId, status: 'completed', output: [reasoning, item], usage: { input_tokens: round * 200, output_tokens: 100, total_tokens: round * 200 + 100, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: empty ? 92 : 40 } } } })
      response.end()
    })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : new Error(String(error))) })
  })
  const dispose = async () => {
    active?.destroy(); releaseTitle(); for (const barrier of barriers.values()) barrier.release()
    if (bound) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
    await rm(root, { recursive: true, force: true })
  }
  try {
    await Promise.all([mkdir(agentDir), mkdir(cwd)])
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { bound = true; resolve() }) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Responses fixture did not bind')
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: 'openai-responses', apiKey: 'fixture-only', models: [{ id: 'scripted', name: 'Responses fixture', reasoning: true, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }))
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'scripted', defaultThinkingLevel: 'high', compaction: { enabled: false } }))
    const runtime: PiRuntime = { ...selected, agentDir, args: [...selected.args, '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes'], env: { ...selected.env, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(agentDir, 'sessions') } }
    const runtimeConfig = join(root, 'runtime.json')
    await writeFile(runtimeConfig, JSON.stringify(runtime))
    return { root, cwd, agentDir, runtime, runtimeConfig, requests, titleRequests, release, releaseTitle, dispose }
  } catch (error) { await dispose(); throw error }
}
