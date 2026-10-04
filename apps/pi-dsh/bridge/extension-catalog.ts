/** Reviewed package identities and exact defaults; native Pi remains the package resolver. */
import type { AgentConfigurationView, PiPackage } from './agent-types.ts'

export const extensionCatalog = [
  { name: 'pi-subagents', version: '0.74.0', key: 'extensionSubagents', category: 'rpc', recommended: true, url: 'https://github.com/nicobailon/pi-subagents' },
  { name: 'pi-web-access', version: '0.35.0', key: 'extensionWebAccess', category: 'rpc', recommended: true, url: 'https://github.com/nicobailon/pi-web-access' },
  { name: '@juicesharp/rpiv-ask-user-question', version: '2.12.0', key: 'extensionQuestions', category: 'rpc', recommended: true, url: 'https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question' },
  { name: '@juicesharp/rpiv-todo', version: '2.12.0', key: 'extensionTodos', category: 'tools', recommended: true, url: 'https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo' },
  { name: '@plannotator/pi-extension', version: '0.27.25', key: 'extensionPlannotator', category: 'browser', recommended: false, url: 'https://github.com/backnotprop/plannotator' },
  { name: 'pi-mcp-adapter', version: '5.0.0', key: 'extensionMcpAdapter', category: 'alternative', recommended: false, url: 'https://github.com/nicobailon/pi-mcp-adapter' },
  { name: 'pi-lens', version: '4.3.0', key: 'extensionLens', category: 'tools', recommended: false, url: 'https://github.com/apmantza/pi-lens' },
  { name: 'pi-interactive-shell', version: '0.17.0', key: 'extensionShell', category: 'terminal', recommended: false, url: 'https://github.com/nicobailon/pi-interactive-shell' },
  { name: 'billion-context', version: '0.1.180', key: 'extensionContext', category: 'alternative', recommended: false, url: 'https://github.com/ranxianglei/billion-context' },
  { name: '@langfuse/pi-observability-plugin', version: '0.1.2', key: 'extensionObservability', category: 'alternative', recommended: false, url: 'https://github.com/langfuse/pi-observability-plugin' },
] as const
export type CatalogExtension = typeof extensionCatalog[number]

/** Default collection preferences, never a package compatibility rule. Native configuration can make these coexist. */
const defaultAlternatives: Readonly<Record<string, readonly string[]>> = { 'pi-web-access': ['pi-web-search'] }

function matchesPackage(source: string, name: string): boolean {
  return source === name || source === `npm:${name}` || source.startsWith(`npm:${name}@`)
}

/** Preserve enabled search packages when installing defaults; explicit install and enable actions remain Pi-owned. */
export function installedDefaultAlternatives(name: string, view: AgentConfigurationView): PiPackage[] {
  const names = defaultAlternatives[name] ?? []
  return view.packages.filter(item => {
    if (!names.some(name => item.name === name || matchesPackage(item.source, name))) return false
    const extensions = view.resources.filter(resource => resource.packageId === item.id && resource.kind === 'extensions')
    return extensions.length === 0 || extensions.some(resource => resource.enabled)
  })
}
