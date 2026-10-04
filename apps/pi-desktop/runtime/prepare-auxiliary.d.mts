/** Relative file paths and locked library versions carried by the auxiliary payload. */
export interface AuxiliaryManifest {
  format: 'pi-desktop-auxiliary-v1'
  python: { version: string; executable: string; packagesDirectory: string; archiveSha256: string; distributions: Record<string, string> }
  office: { skillsDirectory: string; checker: string }
  extension: string
  payloadDigest: string
}
/** Reject incomplete distribution sets, unrecognized sources and mismatched wheel versions. */
export function validateAuxiliaryLock(value: unknown): unknown
/** Prepare the selected target's immutable Python resources and public Pi extension. */
export function prepareAuxiliary(options: { target: string; output: string; cache: string }): Promise<AuxiliaryManifest>
/** Execute native interpreters and verify library versions and Office file round trips. */
export function smokeAuxiliary(root: string, auxiliary: AuxiliaryManifest): Promise<{ python: string; distributions: Record<string, string> }>
