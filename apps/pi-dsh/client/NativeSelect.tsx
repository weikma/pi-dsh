import type { SelectHTMLAttributes } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './NativeSelect.module.css'

/** Native keyboard and popup behavior with a consistently inset disclosure icon. */
export function NativeSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className={css.wrapper}>
    <select {...props} className={[css.select, className].filter(Boolean).join(' ')}>{children}</select>
    <IconChevronDownOutlineRegular size={14} className={css.chevron} aria-hidden="true" />
  </span>
}
