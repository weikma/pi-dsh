/** Public metadata parsing and network lifecycle have no package-manager or credential access. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PackageMarketplace, parseMarketplace, parseMarketplaceDetail } from '../marketplace.ts'

const query = { kind: 'skill', query: 'native & local', sort: 'downloads', page: 1 } as const
const card = `<article data-package-card="true" data-package-name="@example/mixed" data-package-types="extension skill" data-package-downloads="1234"><h3 class="packages-name">@example/mixed</h3><p class="packages-desc">Skills &amp; tools &lt;script&gt;</p><div class="packages-meta"><span>example</span><span>1.2K/mo</span></div></article>`
const html = `<span class="packages-count">1-1 / 1 (of 5000)</span>${card}`

test('gallery projection preserves resource types and text without executing HTML or treating format errors as empty', () => {
  const page = parseMarketplace(html, query)
  assert.equal(page.total, 1); assert.equal(page.hasNext, false)
  assert.deepEqual(page.packages, [{ name: '@example/mixed', description: 'Skills & tools <script>', author: 'example', downloads: 1234, types: ['extension', 'skill'], url: 'https://pi.dev/packages/%40example/mixed' }])
  assert.equal(new URL(page.url).searchParams.get('name'), 'native & local')
  assert.equal(parseMarketplace('<span class="packages-count">0 / 5000</span>', query).total, 0)
  assert.throws(() => parseMarketplace('<h1>Unavailable</h1>', query), /format changed/)
  assert.throws(() => parseMarketplace(html.replace('extension skill', 'extension'), query), /unsupported/)
  assert.throws(() => parseMarketplace(html.replace('@example/mixed', '../arbitrary'), query), /unsupported/)
  assert.throws(() => parseMarketplace(html.replace(card, ''), query), /incomplete/)
})

test('registry details disclose mixed resources and pin identity while discarding executable links and unrelated fields', () => {
  const details = parseMarketplaceDetail({ name: '@example/mixed', version: '1.2.3-beta.1', description: 'Description', license: 'MIT', homepage: 'javascript:alert(1)',
    pi: { extensions: ['./index.ts'], skills: ['./skills'], themes: ['./theme.json'] }, peerDependencies: { '@earendil-works/pi-coding-agent': '>=0.99.0' }, scripts: { postinstall: 'arbitrary' }, _authToken: 'must-not-project' }, '@example/mixed')
  assert.equal(details.version, '1.2.3-beta.1'); assert.equal(details.homepage, undefined); assert.equal(details.piRequirement, '>=0.99.0')
  assert.deepEqual(details.resources.map(item => item.type), ['extension', 'skill', 'theme'])
  assert.ok(!JSON.stringify(details).includes('arbitrary') && !JSON.stringify(details).includes('must-not-project'))
  assert.throws(() => parseMarketplaceDetail({ name: 'other', version: '1.0.0' }, '@example/mixed'), /invalid/)
  assert.throws(() => parseMarketplaceDetail({ name: '@example/mixed', version: 'latest' }, '@example/mixed'), /invalid/)
})

test('read-only searches follow same-origin canonical redirects, cache results, and reject cross-origin or oversized responses', async () => {
  const requests: string[] = []
  let mode: 'normal' | 'redirect' | 'large' = 'normal'
  const market = new PackageMarketplace(async (input, options) => {
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'manual')
    const url = String(input); requests.push(url)
    if (mode === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/catalog' } })
    if (mode === 'large') return new Response('x'.repeat(2 * 1024 * 1024 + 1))
    if (requests.length === 1) return new Response(null, { status: 302, headers: { location: '/packages?type=skill&name=native%20%26%20local' } })
    return new Response(html)
  })
  try {
    await market.browse(query); const count = requests.length
    await market.browse(query); assert.equal(requests.length, count)
    mode = 'redirect'; await assert.rejects(market.browse(query, true), /outside its public source/)
    mode = 'large'; await assert.rejects(market.browse(query, true), /too large/)
    await assert.rejects(market.detail('https://elsewhere.test'), /Invalid npm/)
    await assert.rejects(market.browse({ ...query, page: -1 }), /Invalid package/)
  } finally { await market.close() }
  await assert.rejects(market.browse(query), /stopped/)
})

test('Host-owned catalog shutdown aborts and joins pending reads', async () => {
  let started!: () => void, aborted = false
  const ready = new Promise<void>(resolve => { started = resolve })
  const market = new PackageMarketplace(async (_input, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('Aborted fixture')) }, { once: true })
    started()
  }))
  const loading = assert.rejects(market.browse(query), /Aborted fixture/)
  await ready; await market.close(); await loading
  assert.equal(aborted, true)
})
