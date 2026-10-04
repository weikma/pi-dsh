/** Read-only Office content supplied by the local Host. */
import { useState } from 'react'
import { Button, IconCopyOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FilePreview } from './http.ts'
import type { T } from './i18n.ts'
import css from './OfficePreview.module.css'

type OfficeFile = Extract<FilePreview, { kind: 'spreadsheet' | 'document' }>

function columnName(index: number): string {
  let value = index + 1
  let name = ''
  while (value > 0) {
    value -= 1
    name = String.fromCharCode(65 + value % 26) + name
    value = Math.floor(value / 26)
  }
  return name
}

/** Display saved spreadsheet values or a sandboxed document preview.
 * @param props - Host preview, localized controls, and shell-owned operation feedback.
 * @returns A read-only Office preview without an agent or file-write API.
 */
export function OfficePreview({ file, t, feedback }: { file: OfficeFile; t: T; feedback: (text: string) => void }) {
  const [sheetIndex, setSheetIndex] = useState(0)
  if (file.kind === 'document') return <div className={css.document}>
    <p className={css.notice}>{t('readOnlyPreview')}</p>
    <iframe className={css.documentFrame} title={`${t('documentPreview')}: ${file.path}`} sandbox="" referrerPolicy="no-referrer" srcDoc={file.html} />
  </div>

  const activeIndex = Math.min(sheetIndex, file.sheets.length - 1)
  const sheet = file.sheets[activeIndex]
  if (sheet === undefined) return <p className={css.notice}>{t('emptyWorksheet')}</p>
  const columns = Math.max(0, ...sheet.rows.map(row => row.length))
  const headers = Array.from({ length: columns }, (_, index) => columnName(index))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sheet.rows.map(row => row.map(value => /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join('\t')).join('\n'))
      feedback(t('copied'))
    } catch (reason) { feedback(reason instanceof Error ? reason.message : t('operationFailed')) }
  }
  return <div className={css.workbook}>
    <div className={css.toolbar}><span>{t('sheetSize', { rows: sheet.rows.length, columns })}</span><Button size="sm" icon={<IconCopyOutlineRegular size={14} />} onClick={() => { void copy() }}>{t('copySheet')}</Button></div>
    <div className={css.sheetTabs} role="tablist" aria-label={t('worksheets')}>
      {file.sheets.map((value, index) => <button type="button" role="tab" aria-selected={activeIndex === index} key={`${index}:${value.name}`} tabIndex={activeIndex === index ? 0 : -1}
        onClick={() => { setSheetIndex(index) }} onKeyDown={event => {
          let target: number
          if (event.key === 'ArrowRight') target = (index + 1) % file.sheets.length
          else if (event.key === 'ArrowLeft') target = (index - 1 + file.sheets.length) % file.sheets.length
          else if (event.key === 'Home') target = 0
          else if (event.key === 'End') target = file.sheets.length - 1
          else return
          event.preventDefault(); setSheetIndex(target)
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus()
        }}>{value.name}</button>)}
    </div>
    <div className={css.grid} role="tabpanel" aria-label={sheet.name} tabIndex={0}>
      {sheet.rows.length === 0 ? <p className={css.notice}>{t('emptyWorksheet')}</p> : <table className={css.table} aria-label={sheet.name}>
        <thead><tr><th aria-hidden="true" />{headers.map(name => <th scope="col" key={name}>{name}</th>)}</tr></thead>
        <tbody>{sheet.rows.map((row, index) => <tr key={index}><th scope="row">{index + 1}</th>{headers.map((_, column) => <td key={column}>{row[column] ?? ''}</td>)}</tr>)}</tbody>
      </table>}
    </div>
    <p className={css.notice}>{t('readOnlyPreview')}</p>
  </div>
}
