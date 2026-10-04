/** Editable Pi preferences and resources; execution and persistence remain native Pi behavior. */
/** Native-resource identity is distinct from a transport request or session identity. */
export type ResourceId = string & { readonly __resourceId: unique symbol }
export type PackageId = string & { readonly __packageId: unique symbol }
export type ResourceKind = 'skills' | 'prompts' | 'instructions' | 'extensions'
export type ConfigurationScope = 'user' | 'project'
export interface AgentPreferences {
  defaultProvider: string
  defaultModel: string
  thinking: string
  steering: 'all' | 'one-at-a-time'
  followUp: 'all' | 'one-at-a-time'
  compaction: boolean
  retry: boolean
  autoResize: boolean
  blockImages: boolean
  skillCommands: boolean
}
export interface AgentResource {
  id: ResourceId
  kind: ResourceKind
  name: string
  description: string
  path: string
  scope: ConfigurationScope
  enabled: boolean
  editable: boolean
  packageId?: PackageId
}
/** Package metadata is read without importing extension code. Pi owns its installation and filters. */
export interface PiPackage {
  id: PackageId
  source: string
  scope: ConfigurationScope
  installed: boolean
  name: string
  version: string
  description: string
}
export interface McpConfiguration {
  name: string
  scope: ConfigurationScope
  endpoint: string
  enabled: boolean
  exposure: string
}
export interface AgentConfigurationView {
  sdkVersion: string
  agentDir: string
  cwd: string
  preferences: AgentPreferences
  projectTrusted: boolean
  overridden: string[]
  resources: AgentResource[]
  packages: PiPackage[]
  packageManagement: boolean
  mcp: McpConfiguration[]
  revision: string
}
export interface ResourceDocument { id: ResourceId; content: string; revision: string; path: string }
export type AgentConfigurationAction =
  | { action: 'package'; operation: 'install'; source: string; scope: ConfigurationScope }
  | { action: 'package'; operation: 'remove' | 'update'; packageId: PackageId }
  | { action: 'trust'; scope: 'project'; trusted: boolean }
  | { action: 'preferences'; values: Partial<AgentPreferences> }
  | { action: 'read'; resourceId: ResourceId }
  | { action: 'write'; resourceId: ResourceId; content: string; revision: string }
  | { action: 'create'; kind: 'skills' | 'prompts'; scope: ConfigurationScope; name: string; description: string; content: string }
  | { action: 'toggle'; resourceId: ResourceId; enabled: boolean }
  | { action: 'mcp'; name: string; scope: ConfigurationScope; enabled?: boolean; exposure?: string; command?: string; args?: string[]; url?: string }
