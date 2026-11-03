import { Check, CheckCheck, Circle, CircleDashed, type LucideProps } from 'lucide-react'

import type { Status } from '@/api/types'
import { t } from '@/i18n'
import { cn, STATUS_COLOR, STATUS_ORDER } from '@/lib/utils'

const ICONS: Record<Status, React.ComponentType<LucideProps>> = {
  not_started: Circle,
  in_progress: CircleDashed,
  understood: Check,
  mastered: CheckCheck,
}

export function StatusIcon({ status, className, ...props }: { status: Status; className?: string } & LucideProps) {
  const Icon = ICONS[status]
  return <Icon className={cn('h-4 w-4', className)} style={{ color: STATUS_COLOR[status] }} strokeWidth={status === 'not_started' ? 2 : 2.5} {...props} />
}

export function StatusDot({ status, className, ready }: { status: Status; className?: string; ready?: boolean }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', ready && 'animate-pulse-ring', className)}
      style={{ background: STATUS_COLOR[status], ['--ready' as string]: 'var(--ready)' }}
      aria-hidden
    />
  )
}

/** Segmented control to set a node's status. */
export function StatusSegmented({ value, onChange, size = 'md', disabled }: { value: Status; onChange: (s: Status) => void; size?: 'sm' | 'md'; disabled?: boolean }) {
  return (
    <div className={cn('inline-flex w-full rounded-lg border bg-bg-sunken p-0.5', size === 'sm' ? 'text-[10.5px]' : 'text-[11px]')} role="radiogroup">
      {STATUS_ORDER.map((s) => {
        const active = s === value
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(s)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-7' : 'h-8',
              active ? 'bg-bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
            )}
            style={active ? { boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${STATUS_COLOR[s]} 60%, transparent)` } : undefined}
          >
            <StatusIcon status={s} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t(`status.${s}`)}</span>
          </button>
        )
      })}
    </div>
  )
}
