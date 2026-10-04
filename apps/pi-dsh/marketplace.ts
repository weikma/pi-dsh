/** Read-only adapter for Pi's public gallery and npm manifests; no credentials or package execution. */
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { isJsonObject } from './bridge/types.ts'
import type { MarketplaceQuery, MarketplacePackage, MarketplacePage, MarketplaceDetail, PackageResourceType } from './bridge/marketplace-types.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const types: PackageResourceType[] = ['extension', 'skill', 'prompt', 'theme']
const npmName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const attr = (element: Element, name: string): string => element.attrs.find(item => item.name === name)?.value ?? ''
const classed = (element: Element, name: string): boolean => attr(element, 'class').split(/\s+/u).includes(name)
function descendants(root: Node): Node[] {
  const result: Node[] = [], queue = [root]
  while (queue.length) {
    const node = queue.pop()!
    result.push(node)
    if ('childNodes' in node) queue.push(...[...node.childNodes].reverse())
  }
  return result
}
const elements = (root: Node): Element[] => descendants(root).filter((node): node is Element => 'tagName' in node)
const text = (node: Node | undefined): string => node ? descendants(node).flatMap(value => 'value' in value ? [value.value] : []).join('').replace(/\s+/gu, ' ').trim() : ''
const bounded = (value: unknown, length = 800): string => typeof value === 'string' ? value.slice(0, length) : ''
const packageUrl = (name: string): string => 'https://pi.dev/packages/' + name.split('/').map(encodeURIComponent).join('/')

/** Parse the gallery's resource tags instead of guessing package content from its name. */
export function parseMarketplace(html: string, query: MarketplaceQuery): MarketplacePage {
  const nodes = elements(parse(html)), counter = nodes.find(node => classed(node, 'packages-count'))
  const match = text(counter).match(/^(?:\d+-\d+\s*\/\s*)?(\d+)(?:\s*\/\s*\d+)?(?:\s*\(of \d+\))?$/u)
  if (!counter || !match) throw new Error('The Pi package gallery format changed. Open the official gallery or retry later.')
  const total = Number(match[1]), cards = nodes.filter(node => attr(node, 'data-package-card') === 'true')
  if (cards.length > 50 || total > 0 && cards.length === 0) throw new Error('The Pi package gallery returned an incomplete page.')
  const packages: MarketplacePackage[] = cards.map(card => {
    const name = attr(card, 'data-package-name'), fields = elements(card)
    const resourceTypes = attr(card, 'data-package-types').split(/\s+/u).filter((value): value is PackageResourceType => types.some(type => type === value))
    const downloads = Number(attr(card, 'data-package-downloads'))
    if (!npmName.test(name) || name.length > 214 || !resourceTypes.includes(query.kind) || !Number.isSafeInteger(downloads) || downloads < 0) throw new Error('The Pi package gallery returned unsupported package metadata.')
    const meta = fields.find(node => classed(node, 'packages-meta'))
    return { name, description: bounded(text(fields.find(node => classed(node, 'packages-desc')))), author: bounded(text(meta && elements(meta).find(node => node.tagName === 'span')), 120), downloads, types: resourceTypes, url: packageUrl(name) }
  })
  const url = new URL('https://pi.dev/packages')
  url.search = new URLSearchParams({ type: query.kind, name: query.query, sort: query.sort, page: String(query.page) }).toString()
  return { packages, total, page: query.page, hasNext: query.page * 50 < total, url: url.href }
}

/** Validate public registry metadata before offering an exact native npm installation. */
export function parseMarketplaceDetail(input: unknown, name: string): MarketplaceDetail {
  if (!isJsonObject(input) || input.name !== name || typeof input.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u.test(input.version)) throw new Error('The package registry returned invalid package metadata.')
  const manifest = isJsonObject(input.pi) ? input.pi : {}, peers = isJsonObject(input.peerDependencies) ? input.peerDependencies : {}
  const resources = types.flatMap(type => {
    const key = type === 'extension' ? 'extensions' : type === 'skill' ? 'skills' : type === 'prompt' ? 'prompts' : 'themes'
    const paths = manifest[key]
    return Array.isArray(paths) && paths.every(path => typeof path === 'string') && paths.length ? [{ type, paths: paths.slice(0, 100).map(path => bounded(path, 512)) }] : []
  })
  let homepage: string | undefined
  if (typeof input.homepage === 'string') {
    try { const url = new URL(input.homepage); if (url.protocol === 'https:' && !url.username && !url.password) homepage = url.href }
    catch (error) { void error /* Invalid publisher links are omitted from the UI. */ }
  }
  const piRequirement = bounded(peers['@earendil-works/pi-coding-agent'] ?? peers['@mariozechner/pi-coding-agent'], 120)
  return { name, version: input.version, description: bounded(input.description, 2000), license: bounded(input.license, 120), resources, url: packageUrl(name), ...(homepage ? { homepage } : {}), ...(piRequirement ? { piRequirement } : {}) }
}

/** Host-scoped requests have a size/deadline bound and are aborted and joined at shutdown. */
export class PackageMarketplace {
  private readonly abort = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly pages = new Map<string, { time: number; page: MarketplacePage }>()
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async read(url: string): Promise<string> {
    if (this.abort.signal.aborted) throw new Error('Package browsing stopped')
    const operation = (async () => {
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)])
      let address = new URL(url), response: Response
      for (let count = 0; ; count++) {
        response = await this.fetcher(address.href, { redirect: 'manual', credentials: 'omit', signal })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (!location || count >= 3) throw new Error('Package catalog redirect could not be resolved')
        const next = new URL(location, address)
        if (next.origin !== new URL(url).origin || next.username || next.password) throw new Error('Package catalog redirected outside its public source')
        address = next
      }
      if (!response.ok || !response.body) throw new Error('Package catalog is unavailable. Retry or open the official gallery.')
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2 * 1024 * 1024) throw new Error('Package catalog response is too large'); chunks.push(part.value) }
      } finally { await reader.cancel(); reader.releaseLock() }
      return Buffer.concat(chunks).toString('utf8')
    })()
    this.pending.add(operation)
    try { return await operation } finally { this.pending.delete(operation) }
  }
  async browse(query: MarketplaceQuery, refresh = false): Promise<MarketplacePage> {
    if (this.abort.signal.aborted) throw new Error('Package browsing stopped')
    if (!['extension', 'skill'].includes(query.kind) || !['downloads', 'recent', 'name'].includes(query.sort) || !Number.isSafeInteger(query.page) || query.page < 1 || query.page > 10000 || query.query.length > 200) throw new Error('Invalid package search')
    const url = new URL('https://pi.dev/packages')
    url.search = new URLSearchParams({ type: query.kind, name: query.query, sort: query.sort, page: String(query.page) }).toString()
    const cached = this.pages.get(url.href)
    if (!refresh && cached && Date.now() - cached.time < 300_000) return cached.page
    const page = parseMarketplace(await this.read(url.href), query)
    if (this.pages.size >= 24) this.pages.delete(this.pages.keys().next().value!)
    this.pages.set(url.href, { time: Date.now(), page })
    return page
  }
  async detail(name: string): Promise<MarketplaceDetail> {
    if (!npmName.test(name) || name.length > 214) throw new Error('Invalid npm package name')
    const value: unknown = JSON.parse(await this.read('https://registry.npmjs.org/' + encodeURIComponent(name) + '/latest'))
    return parseMarketplaceDetail(value, name)
  }
  async close(): Promise<void> { this.abort.abort(); await Promise.allSettled(this.pending); this.pages.clear() }
}
