import { ChevronRight, ClipboardList, Layers, Lock, NotebookPen, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { PlanDetail, PlanNode, Status } from '@/api/types'
import { StatusIcon } from '@/components/StatusControl'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'
import { cn, formatMinutes, isDone, nextStatus } from '@/lib/utils'

import { childrenMap, descendantsOf, treeOrder } from './graph'

type Filter = 'all' | 'ready' | 'in_progress' | 'open'

interface Props {
  plan: PlanDetail
  selectedId: number | null
  onSelect: (id: number | null) => void
  onSetStatus: (id: number, status: Status) => void
}

export function OutlineView({ plan, selectedId, onSelect, onSetStatus }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const children = useMemo(() => childrenMap(plan.nodes), [plan.nodes])
  const rows = useMemo(() => treeOrder(plan.nodes), [plan.nodes])

  const matches = (n: PlanNode) => {
    if (query && !`${n.title} ${n.key} ${n.keywords.join(' ')}`.toLowerCase().includes(query.toLowerCase())) return false
    if (filter === 'ready') return n.ready
    if (filter === 'in_progress') return n.progress.status === 'in_progress'
    if (filter === 'open') return !isDone(n.progress.status)
    return true
  }

  const visible = useMemo(() => {
    const filtering = filter !== 'all' || query.trim() !== ''
    const keep = new Set<number>()
    if (filtering) {
      const byId = new Map(plan.nodes.map((n) => [n.id, n]))
      for (const n of plan.nodes) {
        if (!matches(n)) continue
        keep.add(n.id)
        let cur = n.parent_id
        while (cur !== null) {
          keep.add(cur)
          cur = byId.get(cur)?.parent_id ?? null
        }
      }
    }
    const hidden = new Set<number>()
    if (!filtering) for (const id of collapsed) descendantsOf(id, children).forEach((d) => hidden.add(d))
    return rows.filter(({ node }) => !hidden.has(node.id) && (!filtering || keep.has(node.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, collapsed, children, filter, query, plan.nodes])

  const toggle = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: t('common.all') },
    { id: 'ready', label: t('status.ready') },
    { id: 'in_progress', label: t('status.in_progress') },
    { id: 'open', label: t('plan.onlyUnfinished') },
  ]

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 md:px-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} className="pl-8" />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn('rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors', filter === f.id ? 'border-accent bg-accent/10 text-accent' : 'text-fg-muted hover:bg-bg-sunken')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && <p className="py-10 text-center text-sm text-fg-muted">{t('plan.noNodes')}</p>}
      <ul className="overflow-hidden rounded-xl border bg-bg-elevated shadow-card">
        {visible.map(({ node, depth }) => {
          const kids = children.get(node.id) ?? []
          const hasKids = kids.length > 0
          const status = node.progress.status
          const blocked = status === 'not_started' && node.blocked_by.length > 0
          const selected = node.id === selectedId
          return (
            <li
              key={node.id}
              className={cn('group flex items-center gap-1 border-b pr-2 last:border-b-0 hover:bg-bg-sunken/60', selected && 'bg-accent/5')}
              style={{ paddingLeft: 8 + depth * 20 }}
            >
              <button
                className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:text-fg', !hasKids && 'invisible')}
                onClick={() => toggle(node.id)}
                aria-label={collapsed.has(node.id) ? t('plan.expandAll') : t('plan.collapseAll')}
              >
                <ChevronRight className={cn('h-4 w-4 transition-transform', !collapsed.has(node.id) && 'rotate-90')} />
              </button>
              <button
                className="flex h-9 w-8 shrink-0 items-center justify-center transition-transform hover:scale-110"
                onClick={() => onSetStatus(node.id, nextStatus(status))}
                aria-label={t(`status.${status}`)}
                title={t(`status.${status}`)}
              >
                <span
                  className={cn('flex h-6 w-6 items-center justify-center rounded-full', node.ready && 'animate-pulse-ring')}
                  style={node.ready ? { ['--ready' as string]: plan.subject_color } : undefined}
                >
                  <StatusIcon status={status} className="h-[18px] w-[18px]" />
                </span>
              </button>
              <button className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left" onClick={() => onSelect(node.id)}>
                <span className={cn('truncate text-sm', hasKids && 'font-medium', isDone(status) && 'text-fg-muted line-through decoration-line-strong')}>{node.title}</span>
                {node.ready && (
                  <span className="hidden shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold tracking-wide uppercase sm:inline" style={{ color: plan.subject_color, background: `color-mix(in oklab, ${plan.subject_color} 12%, transparent)` }}>
                    {t('status.ready')}
                  </span>
                )}
                {blocked && <Lock className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />}
                <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-fg-subtle tabular-nums">
                  {hasKids && node.descendants_total > 0 && (
                    <span>
                      {node.descendants_done}/{node.descendants_total}
                    </span>
                  )}
                  {node.exercise_count > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <ClipboardList className="h-3 w-3" />
                      {node.exercise_count}
                    </span>
                  )}
                  {node.flashcard_count > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Layers className="h-3 w-3" />
                      {node.flashcard_count}
                    </span>
                  )}
                  {node.has_note && <NotebookPen className="h-3 w-3" />}
                  {node.estimated_minutes > 0 && <span className="hidden sm:inline">{formatMinutes(node.estimated_minutes)}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
