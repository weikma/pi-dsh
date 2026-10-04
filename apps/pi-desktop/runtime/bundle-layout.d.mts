/** Build-only artifact APIs shared by the Node and Python payload preparers. */
export interface DownloadOptions {
  url: string;
  sha256?: string;
  integrity?: string;
  cache: string;
  filename?: string;
}
/** Return a content-verified cache path; failed downloads leave no completed entry. */
export function downloadVerified(options: DownloadOptions): Promise<string>;
/** Extract tar or ZIP into a confined directory, optionally stripping enclosing folders. */
export function extractSafe(options: { archive: string; destination: string; strip?: number }): Promise<void>;
/** Copy a payload executable and retain POSIX executable permissions. */
export function copyExecutable(source: string, destination: string): Promise<void>;
/** Atomically replace a complete JSON manifest. */
export function writeManifest(path: string, value: unknown): Promise<void>;
