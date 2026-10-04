/** Build-time manifest interfaces; no official Pi modules enter the GUI dependency graph. */
export interface TargetMetadata {
  os: string;
  cpu: string;
  libc?: string;
  nodeArchive?: string;
  nodeSha256?: string;
  ripgrepArchive?: string;
  ripgrepSha256?: string;
  fdArchive?: string;
  fdSha256?: string;
}
export interface BundleLock {
  format: 'pi-dsh-bundle-lock-v1';
  nodeVersion: string;
  pi: { package: string; version: string; url: string; integrity: string; gitHead: string; license: { url: string; sha256: string } };
  pnpm: { version: string; url: string; integrity: string };
  ripgrepVersion: string;
  fdVersion: string;
  targets: Record<string, TargetMetadata>;
}
export interface LockedPackage {
  version?: string;
  optional?: boolean;
  os?: string[];
  cpu?: string[];
  libc?: string[];
}
export interface BundleManifest {
  format: 'pi-dsh-runtime-v1';
  payloadRevision: number;
  target: string;
  mainDigest: string;
  node: { version: string; executable: string; archiveSha256: string };
  pi: { package: string; version: string; packageRoot: string; cli: string; lockfile: string; integrity: string; gitHead: string; defaultArgs: string[]; licenseFile: string; licenseSha256: string };
  pnpm: { version: string; packageRoot: string; cli: string; integrity: string };
  tools: Record<'ripgrep' | 'fd', { version: string; executable: string; archiveSha256: string; resourcesDirectory: string }>;
  pathDirectories: string[];
  removedOptionalPackages: string[];
  shellRequirements: string[];
  auxiliary: {
    format: 'pi-dsh-auxiliary-v1';
    python: { version: string; executable: string; packagesDirectory: string; archiveSha256: string; distributions: Record<string, string> };
    office: { skillsDirectory: string; checker: string };
    extension: string;
    payloadDigest: string;
  };
}
/** Validate pinned official package and target records before any network requests. */
export function validateBundleLock(value: unknown): BundleLock;
/** Match npm platform metadata, including exclusions, against the intended artifact target. */
export function packageMatchesTarget(packageInfo: LockedPackage, target: TargetMetadata): boolean;
/** Require current payload fields before attempting to read a cached runtime's files. */
export function canReusePreparedPayload(value: unknown, mainDigest: string): boolean;
/** Remove foreign optional binaries and require applicable production package versions. */
export function pruneOptionalDependencies(directory: string, productionLock: { packages: Record<string, LockedPackage> }, target: TargetMetadata): Promise<string[]>;
/** Assemble official unmodified payloads for a target without executing foreign binaries. */
export function prepareRuntime(options: { target: string; output: string; cache?: string }): Promise<BundleManifest>;
/** Verify versions and execute the target esbuild binary only on its native host. */
export function smokeRuntime(root: string, manifest: BundleManifest): Promise<Record<string, string>>;
