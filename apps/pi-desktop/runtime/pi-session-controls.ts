/** Public Pi extension for session titles, native history, resource reload and context estimates. */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { CONTEXT_STATUS_KEY } from '../bridge/context-breakdown.ts'
import { contextComposition } from './context-composition.ts'
import { SESSION_TITLE_PROMPT, SessionTitleGenerator } from './session-title.ts'
import { skillInvocation } from '../bridge/skill-presentation.ts'

export default function registerSessionControls(pi: ExtensionAPI): void {
  const titles = new SessionTitleGenerator()
  pi.on('session_shutdown', async () => { await titles.cancel() })
  pi.on('agent_settled', (_event, ctx) => {
    const branch = ctx.sessionManager.getBranch()
    const reply = branch.findLast(entry => entry.type === 'message' && entry.message.role === 'assistant')
    const last = reply?.type === 'message' ? reply.message : undefined
    const model = ctx.model
    if (!model || !last || last.role !== 'assistant' || last.stopReason !== 'stop' || pi.getSessionName()) return
    const first = branch.find(entry => entry.type === 'message' && entry.message.role === 'user')
    if (!first || first.type !== 'message' || first.message.role !== 'user') return
    const text = typeof first.message.content === 'string' ? first.message.content : first.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const skill = skillInvocation(text)
    titles.start({
      sessionId: ctx.sessionManager.getSessionId(),
      prompt: skill ? skill.prompt || '/skill:' + skill.name : text,
      currentSessionId: () => ctx.sessionManager.getSessionId(),
      getName: () => pi.getSessionName(),
      setName: name => pi.setSessionName(name),
      generate: async (prompt, signal) => {
        const result = await ctx.modelRegistry.streamSimple(model, {
          systemPrompt: SESSION_TITLE_PROMPT,
          messages: [{ role: 'user', content: 'Summarize this human message as a session title:\n' + JSON.stringify(prompt), timestamp: Date.now() }],
        }, { signal, maxTokens: 256, cacheRetention: 'none' }).result()
        return result.stopReason === 'stop' ? result.content.filter(block => block.type === 'text').map(block => block.text).join('') : undefined
      },
    })
  })
  const publishContext = (ctx: ExtensionContext, messages: readonly unknown[] = ctx.sessionManager.buildSessionProjection().messages): void => {
    const active = new Set(pi.getActiveTools())
    const sizes = contextComposition(ctx.getSystemPrompt(), pi.getAllTools().filter(tool => active.has(tool.name)), messages)
    ctx.ui.setStatus(CONTEXT_STATUS_KEY, JSON.stringify(sizes))
  }
  pi.on('session_start', (_event, ctx) => { publishContext(ctx) })
  pi.on('session_tree', (_event, ctx) => { publishContext(ctx) })
  pi.on('session_compact', (_event, ctx) => { publishContext(ctx) })
  pi.on('model_select', (_event, ctx) => { publishContext(ctx) })
  pi.on('agent_end', (_event, ctx) => { publishContext(ctx) })
  pi.on('context', (event, ctx) => { publishContext(ctx, event.messages) })
  pi.registerCommand('desktop-reload', {
    description: 'Reload native Pi resources in the running session',
    handler: async (_args, ctx) => {
      if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error('Finish the current task and queued messages before reloading resources')
      await ctx.reload()
    },
  })
  pi.registerCommand('desktop-session', {
    description: 'Navigate or fork a native session entry from the Desktop history controls',
    handler: async (args, ctx) => {
      const input: unknown = JSON.parse(args)
      if (input === null || typeof input !== 'object' || !('entryId' in input) || typeof input.entryId !== 'string'
        || !('action' in input) || (input.action !== 'navigate' && input.action !== 'fork')) throw new Error('A session entry and history action are required')
      if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error('Finish the current task and queued messages before changing history')
      if (ctx.sessionManager.getEntry(input.entryId) === undefined) throw new Error('The session entry is no longer available')
      const result = input.action === 'navigate'
        ? await ctx.navigateTree(input.entryId, { summarize: false })
        : await ctx.fork(input.entryId, { position: 'at' })
      if (result.cancelled) ctx.ui.notify('Session history action cancelled', 'info')
    },
  })
}
