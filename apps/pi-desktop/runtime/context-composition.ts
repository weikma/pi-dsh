import { isJsonObject } from '../bridge/types.ts'
import type { ContextBreakdown } from '../bridge/context-breakdown.ts'
import { skillInvocation } from '../bridge/skill-presentation.ts'

interface ContextTool {
  name: string
  description: string
  parameters: unknown
  sourceInfo: { path: string }
}

/** Character counts grouped by source, normalized into shares by the GUI. Images use a fixed weight. */
export function contextComposition(systemPrompt: string, tools: readonly ContextTool[], messages: readonly unknown[]): ContextBreakdown {
  const sizes: ContextBreakdown = { system: 0, tools: 0, mcp: 0, extensions: 0, skills: 0, messages: 0, results: 0 }
  const prompt = systemPrompt.replace(/<available_skills>[\s\S]*?<\/available_skills>/gu, (skills) => {
    sizes.skills += skills.length
    return ''
  })
  sizes.system = prompt.length
  for (const tool of tools) {
    const category = tool.sourceInfo.path === 'builtin:mcp' ? 'mcp' : tool.sourceInfo.path.startsWith('builtin:') ? 'tools' : 'extensions'
    sizes[category] += JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length
  }
  for (const message of messages) {
    if (!isJsonObject(message) || message.role === 'system') continue
    if ((message.role === 'compactionSummary' || message.role === 'branchSummary') && typeof message.summary === 'string') {
      sizes.messages += message.summary.length
      continue
    }
    if (message.role === 'bashExecution') {
      if (!message.excludeFromContext) sizes.results += (typeof message.command === 'string' ? message.command.length : 0) + (typeof message.output === 'string' ? message.output.length : 0)
      continue
    }
    const category = message.role === 'toolResult' ? 'results' : 'messages'
    const addText = (text: string): void => {
      const skill = message.role === 'user' ? skillInvocation(text) : undefined
      if (skill) {
        sizes.skills += text.length - skill.prompt.length
        sizes.messages += skill.prompt.length
      } else sizes[category] += text.length
    }
    if (typeof message.content === 'string') addText(message.content)
    else if (Array.isArray(message.content)) for (const block of message.content) {
      if (!isJsonObject(block)) continue
      if (block.type === 'text' && typeof block.text === 'string') addText(block.text)
      else if (block.type === 'thinking' && typeof block.thinking === 'string') addText(block.thinking)
      else if (block.type === 'toolCall') sizes.messages += JSON.stringify({ name: block.name, arguments: block.arguments }).length
      else if (block.type === 'image') sizes[category] += 4096
    }
  }
  return sizes
}
