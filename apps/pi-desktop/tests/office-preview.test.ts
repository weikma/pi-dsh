/** Exercise real Office libraries and the same project-confined HTTP preview used by the GUI. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { test } from 'node:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { startHost } from '../server.ts'
import { availableBundledRuntime, bundledPi } from '../runtime/bundled.ts'
import { isJsonObject } from '../bridge/types.ts'
import { createPiFixture } from './pi-fixture.ts'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
test('bundled Python previews modern Office files, escapes document text and bounds spreadsheets', { timeout: 60_000 }, async context => {
  const runtime = await availableBundledRuntime(appRoot)
  if (!runtime) { context.skip('Run pnpm runtime:prepare to validate the independent Office interpreter'); return }
  const fixture = await createPiFixture(bundledPi(runtime))
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    const script = `import sys\nfrom pathlib import Path\nfrom openpyxl import Workbook\nfrom docx import Document\nfrom pptx import Presentation\nroot=Path(sys.argv[1])\nw=Workbook()\nw.active.title='Numbers'\nw.active.append(['Code','Value'])\nw.active.append(['0012',7])\nw.create_sheet('Formulas').append(['=1+2'])\nw.save(root/'numbers.xlsx')\nd=Document()\nd.add_heading('Report',1)\nd.add_paragraph('<script>alert("unsafe")</script> & summary')\nd.add_table(rows=1,cols=1).cell(0,0).text='Table text'\nd.save(root/'brief.docx')\np=Presentation()\ns=p.slides.add_slide(p.slide_layouts[6])\ns.shapes.add_textbox(0,0,1000000,1000000).text='Slide text'\nt=s.shapes.add_table(2,2,0,0,1000000,1000000).table\nt.cell(1,1).text='Slide table <value>'\np.save(root/'deck.pptx')\n`
    await promisify(execFile)(runtime.auxiliary.python.executable, ['-I', '-B', '-c', script, fixture.cwd], { timeout: 30_000 })
    await writeFile(join(fixture.cwd, 'data.csv'), 'Code,Description\n0012,"comma, and\nline"\n')
    await writeFile(join(fixture.cwd, 'bounded.tsv'), Array.from({ length: 1001 }, (_, index) => index + '\tvalue').join('\n'))
    await writeFile(join(fixture.cwd, 'invalid.xlsx'), 'not an Office archive')
    const root = dirname(fixture.cwd)
    await mkdir(join(root, 'runtime'))
    await writeFile(join(root, 'runtime/selected.json'), await readFile(fixture.runtimeConfig))
    host = await startHost({ port: 0, appRoot: root, home: join(root, 'gui'), bundledRoot: runtime.root })
    const response = await fetch(host.url + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: fixture.cwd }) })
    const opened: unknown = await response.json()
    assert.ok(isJsonObject(opened) && typeof opened.id === 'string', JSON.stringify(opened))
    const preview = async (name: string) => {
      const response = await fetch(host!.url + '/api/files?' + new URLSearchParams({ sessionId: String(opened.id), path: name }))
      const result: unknown = await response.json()
      assert.equal(response.status, 200, JSON.stringify(result))
      assert.ok(isJsonObject(result))
      return result
    }
    const spreadsheet = await preview('numbers.xlsx')
    assert.deepEqual(spreadsheet.sheets, [{ name: 'Numbers', rows: [['Code', 'Value'], ['0012', '7']] }, { name: 'Formulas', rows: [['=1+2']] }])
    const csv = await preview('data.csv')
    assert.deepEqual(csv.sheets, [{ name: 'data.csv', rows: [['Code', 'Description'], ['0012', 'comma, and\nline']] }])
    const bounded = await preview('bounded.tsv')
    assert.equal(bounded.truncated, true)
    assert.ok(Array.isArray(bounded.sheets) && isJsonObject(bounded.sheets[0]) && Array.isArray(bounded.sheets[0].rows))
    assert.equal(bounded.sheets[0].rows.length, 1000)
    const document = await preview('brief.docx')
    assert.equal(document.kind, 'document')
    assert.ok(typeof document.html === 'string')
    assert.ok(document.html.includes('&lt;script&gt;alert'))
    assert.ok(!document.html.includes('<script>'))
    assert.ok(document.html.includes('Table text'))
    const slides = await preview('deck.pptx')
    assert.ok(typeof slides.html === 'string' && slides.html.includes('Slide text'))
    assert.ok(typeof slides.html === 'string' && slides.html.includes('Slide table &lt;value&gt;'))
    assert.equal((await fetch(host.url + '/api/files?' + new URLSearchParams({ sessionId: String(opened.id), path: 'invalid.xlsx' }))).status, 400)
    const status: unknown = await (await fetch(host.url + '/api/runtime')).json()
    assert.ok(isJsonObject(status) && isJsonObject(status.bundled))
    assert.equal(status.bundled.python, runtime.auxiliary.python.version)
  } finally { await host?.close(); await fixture.dispose() }
})
