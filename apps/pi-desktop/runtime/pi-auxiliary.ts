/** Public Pi extension exposing the Desktop's immutable interpreter resources. */
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Type } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Register the resource tool and Office skills through Pi's public extension APIs. */
export default function registerDesktopResources(pi: ExtensionAPI): void {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const source: unknown = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  if (!object(source) || source.format !== 'pi-desktop-runtime-v1' || !object(source.node) || !object(source.pnpm) || !object(source.auxiliary)
    || !object(source.auxiliary.python) || !object(source.auxiliary.office)) throw new Error('Invalid Pi-DSH runtime manifest')
  const path = (value: unknown, directory = false): string => {
    if (typeof value !== 'string' || !value || isAbsolute(value) || /^[A-Za-z]:/u.test(value)) throw new Error('Invalid Desktop runtime resource path')
    const absolute = resolve(root, value)
    const local = relative(root, absolute)
    if (local.startsWith('..') || isAbsolute(local)) throw new Error('Desktop runtime resource leaves its installation')
    const information = statSync(absolute)
    if (directory ? !information.isDirectory() : !information.isFile()) throw new Error(`Desktop runtime resource is missing: ${value}`)
    return absolute
  }
  const versions = source.auxiliary.python.distributions
  if (!object(versions) || Object.values(versions).some(value => typeof value !== 'string')) throw new Error('Invalid bundled Python distribution versions')
  const resources = {
    node: path(source.node.executable), python: path(source.auxiliary.python.executable), pnpm: path(source.pnpm.cli),
    pythonPackages: path(source.auxiliary.python.packagesDirectory, true), pythonDistributions: versions,
    nodePackages: path(typeof source.target === 'string' && source.target.startsWith('win-') ? 'node/node_modules' : 'node/lib/node_modules', true), officeSkills: path(source.auxiliary.office.skillsDirectory, true), officeChecker: path(source.auxiliary.office.checker),
    versions: { node: source.node.version, python: source.auxiliary.python.version, pnpm: source.pnpm.version },
  }
  pi.on('resources_discover', async () => ({ skillPaths: [resources.officeSkills] }))
  pi.registerTool({
    name: 'load_workspace_dependencies', label: 'Workspace dependencies',
    description: 'Get absolute paths to the bundled Node.js, Python, pnpm and Python libraries. Python includes numpy, pandas, python-docx, python-pptx, openpyxl, Pillow, lxml and XlsxWriter. Use them for Office files unless user or workspace instructions select another environment. Run pnpm with the returned Node executable and pnpm script. The runtime is read-only; write scripts and output in the task workspace. This does not change PATH, settings or authentication.',
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: 'text', text: JSON.stringify(resources, null, 2) }], details: resources }
    },
  })
}
