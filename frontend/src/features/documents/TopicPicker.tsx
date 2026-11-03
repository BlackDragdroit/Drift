import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { SubjectNode } from '@/api/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

interface Props {
  nodes: SubjectNode[]
  value: number[]
  suggested?: number[]
  onChange: (ids: number[]) => void
  compact?: boolean
}

/** Chip list of linked topics + a small search box to add more. */
export function TopicPicker({ nodes, value, suggested = [], onChange, compact }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return nodes.filter((n) => !value.includes(n.id) && (!q || n.title.toLowerCase().includes(q) || n.key.includes(q))).slice(0, 8)
  }, [nodes, query, value])

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {value.map((id) => {
          const n = byId.get(id)
          if (!n) return null
          return (
            <Badge key={id} color={suggested.includes(id) ? 'var(--accent)' : undefined} className="gap-1 pr-1">
              {n.title}
              {suggested.includes(id) && <span className="text-[9px] opacity-70">· {t('review.suggested')}</span>}
              <button onClick={() => onChange(value.filter((v) => v !== id))} className="rounded-full p-0.5 hover:bg-fg/10" aria-label={t('review.remove')}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )
        })}
        {!open && (
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg">
            <Plus className="h-3 w-3" /> {t('review.addTopic')}
          </button>
        )}
      </div>
      {open && (
        <div className={cn('rounded-md border bg-bg-elevated', compact ? 'p-1.5' : 'p-2')}>
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} className="h-8 text-xs" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
          <ul className="mt-1 max-h-40 overflow-y-auto">
            {matches.map((n) => (
              <li key={n.id}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange([...value, n.id]); setQuery('') }}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-bg-sunken"
                >
                  <span className="truncate">{n.title}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-fg-subtle">{n.plan_title}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-2 py-1 text-xs text-fg-subtle">—</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
