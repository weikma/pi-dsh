/** Safe, transient provider-login state shared by the local Host and GUI. */
import type { ProviderAuthPrompt, ProviderAuthType } from './provider-types.ts'
export type { ProviderAuthPrompt } from './provider-types.ts'

/** Credentials remain in Pi; this record contains only its login interaction. */
export interface ProviderAuthAttempt {
  id: string
  providerId: string
  authType: ProviderAuthType
  status: 'working' | 'waiting' | 'complete' | 'cancelled' | 'error'
  prompt?: ProviderAuthPrompt
  authUrl?: string
  instructions?: string
  userCode?: string
  message?: string
  error?: string
}
