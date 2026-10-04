import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Menu, MenuItemButton, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, IconCheckOutlineRegular, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProviderModel } from '../bridge/provider-types.ts'
import type { T } from './i18n.ts'
import css from './App.module.css'

/** Search the configured catalog directly or browse one provider in a bounded menu. */
export function ModelPicker({ open, models, selected, label, disabled, t, toggle, close, select }: {
  open: boolean; models: readonly ProviderModel[]; selected?: { provider: string; id: string }; label: string; disabled: boolean; t: T
  toggle(): void; close(): void; select(model: ProviderModel): void
}) {
  const [provider, setProvider] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!open) { setProvider(null); setQuery('') } }, [open])
  useEffect(() => {
    if (!open) return
    // Portal measurement initially hides the menu; focus after its first visible frame.
    const frame = requestAnimationFrame(() => { search.current?.focus() })
    return () => { cancelAnimationFrame(frame) }
  }, [open, provider])
  const providers = useMemo(() => [...new Set(models.map(model => model.provider))].sort((a, b) => a.localeCompare(b)), [models])
  const needle = query.trim().toLowerCase()
  const filtered = models.filter(model => (provider === null ? needle !== '' : model.provider === provider) && `${model.provider} ${model.name} ${model.id}`.toLowerCase().includes(needle))
  const modelId = (model: { provider: string; id: string }) => `model:${JSON.stringify([model.provider, model.id])}`
  const modelItems: MenuItem[] = filtered.map(model => ({ id: modelId(model), label: <span className={css.modelName}><span>{model.name || model.id}</span><small>{provider === null ? `${model.provider} / ${model.id}` : model.id}</small></span> }))
  const items: MenuItem[] = provider === null
    ? [...providers.filter(value => value.toLowerCase().includes(needle)).map(value => ({ id: `provider:${value}`, label: `${value} · ${t('providerModelCount', { count: models.filter(model => model.provider === value).length })}` })), ...modelItems]
    : [{ id: 'back', label: t('chooseProvider'), icon: <IconChevronLeftOutlineRegular size={14} /> }, ...modelItems]
  const selectedId = selected === undefined ? undefined : provider === null && needle === '' ? `provider:${selected.provider}` : modelId(selected)
  const choose = (id: string) => {
    if (id === 'back') { setProvider(null); setQuery('') }
    else if (id.startsWith('provider:')) { setProvider(id.slice('provider:'.length)); setQuery('') }
    else { const model = filtered.find(value => modelId(value) === id); if (model) select(model) }
  }
  return <Menu open={open} portal side="top" align="end" onClose={close}
    anchor={<button type="button" className={css.chip} disabled={disabled} aria-label={t('model')} aria-haspopup="menu" aria-expanded={open} onClick={toggle}><span>{label}</span><IconChevronDownOutlineRegular size={12} /></button>}>
    <div className={css.modelFooter}>
      <Input ref={search} aria-label={t(provider === null ? 'providerSearch' : 'providerSearchModels')} placeholder={t(provider === null ? 'modelSearch' : 'providerSearchModels')} value={query} onChange={event => { setQuery(event.target.value) }} onKeyDown={event => { if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) event.stopPropagation() }} />
    </div>
    {items.map(item => <MenuItemButton key={item.id} icon={item.icon} onSelect={() => { choose(item.id) }}><span className={css.modelRow}>{item.label}{item.id === selectedId && <IconCheckOutlineRegular size={14} />}</span></MenuItemButton>)}
    {models.length === 0 && <p className={css.modelSetupHint}>{t('modelSetupInSettings')}</p>}
    {(items.length === 0 || provider !== null && filtered.length === 0) && <MenuItemButton disabled onSelect={() => {}}>{t(provider === null ? 'providerNoProviders' : 'providerNoModels')}</MenuItemButton>}
  </Menu>
}
