/** Localized presentation over public Pi command records; Pi invocations keep their exact names. */
import type { JsonObject } from '../bridge/types.ts'
import type { translate } from './i18n.ts'

type Translate = (key: Parameters<typeof translate>[1]) => string
export type SlashIcon = 'model' | 'thinking' | 'compact' | 'branch' | 'info' | 'edit' | 'new' | 'search' | 'settings' | 'copy' | 'export' | 'skill' | 'prompt' | 'pi'
export interface SlashCommand {
  name: string
  label: string
  description: string
  group: 'commands' | 'piCommands' | 'skillsSettings' | 'slashPrompts'
  icon: SlashIcon
  native: boolean
}
const definitions = [
  ['model', 'model', 'slashModelDescription', 'model'],
  ['thinking', 'thinkingLevel', 'slashThinkingDescription', 'thinking'],
  ['compact', 'compact', 'slashCompactDescription', 'compact'],
  ['fork', 'fork', 'slashForkDescription', 'branch'],
  ['session', 'sessionInfo', 'slashSessionDescription', 'info'],
  ['tree', 'sessionTree', 'slashTreeDescription', 'branch'],
  ['name', 'rename', 'slashNameDescription', 'edit'],
  ['new', 'newSession', 'slashNewDescription', 'new'],
  ['resume', 'resumeSession', 'slashResumeDescription', 'search'],
  ['settings', 'settings', 'slashSettingsDescription', 'settings'],
  ['reload', 'configurationReload', 'slashReloadDescription', 'settings'],
  ['copy', 'copyLastReply', 'slashCopyDescription', 'copy'],
  ['clone', 'cloneSession', 'slashCloneDescription', 'branch'],
  ['export', 'exportSession', 'slashExportDescription', 'export'],
  ['login', 'modelSetup', 'slashLoginDescription', 'settings'],
  ['logout', 'modelSetup', 'slashLogoutDescription', 'settings'],
] as const

/** Native commands win collisions, including future sources; the bridge's internal helper stays hidden. */
export function slashCatalog(native: readonly JsonObject[], t: Translate): SlashCommand[] {
  const commands = new Map<string, SlashCommand>()
  for (const value of native) {
    if (typeof value.name !== 'string' || !value.name || value.name === 'desktop-session' || value.name === 'desktop-reload' || commands.has(value.name)) continue
    const group = value.source === 'skill' ? 'skillsSettings' : value.source === 'prompt' ? 'slashPrompts' : 'piCommands'
    commands.set(value.name, { name: value.name, label: value.source === 'skill' ? value.name.replace(/^skill:/u, '') : value.name,
      description: typeof value.description === 'string' ? value.description : t('slashNativeDescription'), group,
      icon: value.source === 'skill' ? 'skill' : value.source === 'prompt' ? 'prompt' : 'pi', native: true })
  }
  for (const [name, label, description, icon] of definitions) if (!commands.has(name)) commands.set(name, { name, label: t(label), description: t(description), group: 'commands', icon, native: false })
  return [...commands.values()]
}

/** Empty input stays curated; typed queries rank names, localized titles and descriptions within source groups. */
export function matchSlashCommands(catalog: readonly SlashCommand[], query: string, suggestedNames: readonly string[]): SlashCommand[] {
  if (query === '') return suggestedNames.flatMap(name => {
    const command = catalog.find(value => value.name === name)
    return command === undefined ? [] : [{ ...command, group: 'commands' as const }]
  })
  const text = query.toLocaleLowerCase()
  const score = (command: SlashCommand) => {
    const name = command.name.toLocaleLowerCase(), label = command.label.toLocaleLowerCase()
    return name === text ? 0 : name.startsWith(text) ? 1 : label.startsWith(text) ? 2 : name.includes(text) ? 3 : label.includes(text) ? 4 : command.description.toLocaleLowerCase().includes(text) ? 5 : Infinity
  }
  const matches = catalog.map(command => ({ command, score: score(command) })).filter(value => Number.isFinite(value.score))
  const groups = [...new Set(matches.map(value => value.command.group))].sort((a, b) => Math.min(...matches.filter(value => value.command.group === a).map(value => value.score)) - Math.min(...matches.filter(value => value.command.group === b).map(value => value.score)))
  return groups.flatMap(group => matches.filter(value => value.command.group === group).sort((a, b) => a.score - b.score).map(value => value.command))
}
