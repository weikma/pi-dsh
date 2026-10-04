/** Runtime settings describe API-key arguments without returning their values to a renderer. */
const MASK = '[configured API key]'

/** Replace Pi's API-key argument values with a write-only configuration hint. */
export function publicRuntimeArgs(args: string[]): string[] {
  return args.map((arg, index) => args[index - 1] === '--api-key' ? MASK : arg.startsWith('--api-key=') ? '--api-key=' + MASK : arg)
}

/** Retain masked keys during runtime edits; removing the flag explicitly removes its override. */
export function restoreRuntimeArgs(previous: string[], requested: string[]): string[] {
  const keys = previous.flatMap((arg, index) => arg === '--api-key' && previous[index + 1] !== undefined ? [previous[index + 1]!] : arg.startsWith('--api-key=') ? [arg.slice('--api-key='.length)] : [])
  let keyIndex = 0
  return requested.map((arg, index) => {
    const paired = requested[index - 1] === '--api-key'
    const inline = arg.startsWith('--api-key=')
    if (!paired && !inline) return arg
    const key = keys[keyIndex++]
    const value = inline ? arg.slice('--api-key='.length) : arg
    if (value !== MASK) return arg
    if (key === undefined) throw new Error('Re-enter the API key for this runtime argument')
    return inline ? '--api-key=' + key : key
  })
}
