/** Launch the selected official Pi TUI for provider configuration without copying its credential store. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PiRuntime } from './bridge/types.ts'

/** A terminal entry uses the selected executable and native Pi data directory. */
export interface PiSetup { commandLine: string; cwd: string }

/** A private, reusable terminal entry owned by the Host that created it. */
export interface PiSetupLauncher extends PiSetup {
  /** Remove this launcher's file without removing other launchers. */
  dispose(): Promise<void>
}

function posix(value: string): string { return "'" + value.replaceAll("'", "'\"'\"'") + "'" }
function powershell(value: string): string { return "'" + value.replaceAll("'", "''") + "'" }

function interactiveArgs(args: string[], hideKey = false): string[] {
  const result: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '--mode') { index++; continue }
    if (arg.startsWith('--mode=') || arg === '--print' || arg === '-p') continue
    if (hideKey && arg === '--api-key') { index++; continue }
    if (hideKey && arg.startsWith('--api-key=')) continue
    result.push(arg)
  }
  return result
}

/** Return a copyable terminal command without configured API-key arguments or environment values. */
export async function piSetup(runtime: PiRuntime, cwd = homedir(), platform: NodeJS.Platform = process.platform): Promise<PiSetup> {
  cwd = resolve(cwd)
  if (!(await stat(cwd)).isDirectory()) throw new Error('Pi configuration directory must be a directory')
  const quote = platform === 'win32' ? powershell : posix
  const command = [runtime.command, ...interactiveArgs(runtime.args, true)].map(quote).join(' ')
  const agentDir = runtime.agentDir ?? runtime.env?.PI_CODING_AGENT_DIR
  const prefix = agentDir === undefined ? '' : platform === 'win32' ? '$env:PI_CODING_AGENT_DIR = ' + quote(agentDir) + '; ' : 'PI_CODING_AGENT_DIR=' + quote(agentDir) + ' '
  return { cwd, commandLine: platform === 'win32' ? 'Set-Location -LiteralPath ' + quote(cwd) + '; ' + prefix + '& ' + command : 'cd -- ' + quote(cwd) + ' && ' + prefix + command }
}

/** Build an owned, self-removing terminal script; all command arguments remain literal data. */
export function piTerminalScript(runtime: PiRuntime, cwd: string, script: string, platform: NodeJS.Platform, base: NodeJS.ProcessEnv): string {
  return terminalScript(runtime, cwd, script, platform, base, true)
}

function terminalScript(runtime: PiRuntime, cwd: string, script: string, platform: NodeJS.Platform, base: NodeJS.ProcessEnv, selfRemoving: boolean): string {
  const env = Object.entries({ ...base, ...runtime.env, ...(runtime.agentDir === undefined ? {} : { PI_CODING_AGENT_DIR: runtime.agentDir }) })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  if (platform === 'win32') {
    const variables = env.map(([key, value]) => '[Environment]::SetEnvironmentVariable(' + powershell(key) + ',' + powershell(value) + ',"Process")').join('\n')
    return (selfRemoving ? 'Remove-Item -LiteralPath ' + powershell(script) + '\n' : '')
      + '[Environment]::GetEnvironmentVariables("Process").Keys | ForEach-Object { [Environment]::SetEnvironmentVariable($_,$null,"Process") }\n'
      + variables + '\nSet-Location -LiteralPath ' + powershell(cwd) + '\n& ' + [runtime.command, ...interactiveArgs(runtime.args)].map(powershell).join(' ') + '\n'
  }
  return '#!/bin/sh\n' + (selfRemoving ? 'rm -- "$0"\n' : '') + 'cd -- ' + posix(cwd) + ' || exit\nexec /usr/bin/env -i ' + env.map(([key, value]) => posix(key + '=' + value)).join(' ') + ' ' + [runtime.command, ...interactiveArgs(runtime.args)].map(posix).join(' ') + '\n'
}

/** Create a reusable copyable command whose private file carries the selected Pi environment.
 * @param runtime - Independently selected official executable, arguments and environment.
 * @param cwd - Pi's working directory; the home directory when absent.
 * @param home - Host-owned directory for private launcher files.
 * @param platform - Target shell syntax; defaults to the current operating system.
 * @param base - Host environment before selected Pi overrides; defaults to the current process.
 * @returns Command text without environment values or API keys, and its owned file disposer.
 */
export async function createPiSetupLauncher(runtime: PiRuntime, cwd: string | undefined, home: string, platform: NodeJS.Platform = process.platform, base: NodeJS.ProcessEnv = process.env): Promise<PiSetupLauncher> {
  const setup = await piSetup(runtime, cwd, platform)
  const directory = join(home, 'terminal-launchers')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const script = join(directory, randomUUID() + (platform === 'win32' ? '.ps1' : '.command'))
  try {
    await writeFile(script, terminalScript(runtime, setup.cwd, script, platform, base, false), { mode: 0o600, flag: 'wx' })
    if (platform !== 'win32') await chmod(script, 0o700)
    const commandLine = platform === 'win32'
      ? 'Set-Location -LiteralPath ' + powershell(setup.cwd) + '; & ' + ['powershell.exe', '-NoProfile', '-EncodedCommand', Buffer.from('Invoke-Expression ([IO.File]::ReadAllText(' + powershell(script) + '))', 'utf16le').toString('base64')].map(powershell).join(' ')
      : 'cd -- ' + posix(setup.cwd) + ' && /bin/sh ' + posix(script)
    return { cwd: setup.cwd, commandLine, dispose: async () => { await rm(script, { force: true }) } }
  } catch (error) { await rm(script, { force: true }); throw error }
}

/** Open the OS terminal with the same Pi environment; failures remove the private launcher file. */
export async function openPiTerminal(runtime: PiRuntime, cwd: string | undefined, home: string): Promise<void> {
  const setup = await piSetup(runtime, cwd)
  const directory = join(home, 'terminal-launchers')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const script = join(directory, randomUUID() + (process.platform === 'win32' ? '.ps1' : '.command'))
  try {
    await writeFile(script, piTerminalScript(runtime, setup.cwd, script, process.platform, process.env), { mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') await chmod(script, 0o700)
    const windowsCommand = Buffer.from('Invoke-Expression ([IO.File]::ReadAllText(' + powershell(script) + '))', 'utf16le').toString('base64')
    const launchers: [string, string[]][] = process.platform === 'darwin' ? [['/usr/bin/open', ['-a', 'Terminal', script]]]
      : process.platform === 'win32' ? [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process powershell.exe -ArgumentList ' + ['-NoProfile', '-NoExit', '-EncodedCommand', windowsCommand].map(powershell).join(',')]]]
        : [['x-terminal-emulator', ['-e', script]], ['gnome-terminal', ['--', script]], ['konsole', ['-e', script]], ['xterm', ['-e', script]]]
    let failure: Error | undefined
    for (const [command, args] of launchers) {
      try {
        await new Promise<void>((complete, reject) => {
          const waitsForLauncher = process.platform === 'darwin' || process.platform === 'win32'
          const child = spawn(command, args, { detached: !waitsForLauncher, stdio: 'ignore', windowsHide: process.platform === 'win32' })
          child.once('error', reject)
          if (waitsForLauncher) child.once('close', code => code === 0 ? complete() : reject(new Error('Terminal could not open Pi configuration')))
          else child.once('spawn', () => { child.unref(); complete() })
        })
        return
      } catch (error) { failure = error instanceof Error ? error : new Error(String(error)) }
    }
    throw failure ?? new Error('No system terminal is available')
  } catch (error) { await rm(script, { force: true }); throw error }
}
