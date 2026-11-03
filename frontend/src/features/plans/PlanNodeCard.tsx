import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { ChevronDown, ChevronRight, ClipboardList, Layers, Lock, NotebookPen } from 'lucide-react'
import { memo } from 'react'

import type { PlanNode, Status } from '@/api/types'
import { StatusIcon } from '@/components/StatusControl'
import { t } from '@/i18n'
import { cn, formatMinutes, isDone, nextStatus, STATUS_COLOR } from '@/lib/utils'

import type { Direction } from './layout'

export type PlanFlowNode = Node<
  {
    node: PlanNode
    selected: boolean
    collapsed: boolean
    hiddenCount: number
    hasChildren: boolean
    direction: Direction
    accent: string
    dimmed: boolean
    onToggleCollapse: (id: number) => void
    onSetStatus: (id: number, status: Status) => void
  },
  'plan'
>

export const PlanNodeCard = memo(function PlanNodeCard({ data }: NodeProps<PlanFlowNode>) {
  const { node, selected, collapsed, hiddenCount, hasChildren, direction, accent, dimmed } = data
  const status = node.progress.status
  const color = STATUS_COLOR[status]
  const blocked = status === 'not_started' && node.blocked_by.length > 0
  const horizontal = direction === 'RIGHT'
  const childPercent = node.descendants_total ? (100 * node.descendants_done) / node.descendants_total : 0
  const ready = node.ready && !hasChildren

  return (
    <div
      className={cn(
        'group relative flex h-[72px] w-[224px] flex-col rounded-xl border bg-bg-elevated px-3 py-2 text-left shadow-card transition-[box-shadow,border-color,opacity,transform] duration-200',
        selected && 'border-accent shadow-pop',
        !selected && 'hover:border-line-strong',
        ready && !selected && 'animate-pulse-ring',
        dimmed && 'opacity-50',
        isDone(status) && !selected && 'border-transparent',
      )}
      style={{
        borderLeftWidth: 4,
        borderLeftColor: color,
        ['--ready' as string]: accent,
      }}
    >
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} />
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} />

      <div className="flex min-w-0 items-start gap-2">
        <button
          className="mt-0.5 shrink-0 rounded-full p-0.5 transition-transform hover:scale-110 hover:bg-bg-sunken"
          onClick={(e) => {
            e.stopPropagation()
            data.onSetStatus(node.id, nextStatus(status))
          }}
          aria-label={t(`status.${status}`)}
          title={t(`status.${status}`)}
        >
          <StatusIcon status={status} className="h-4 w-4" />
        </button>
        <p className={cn('line-clamp-2 min-w-0 flex-1 text-[13px] leading-[1.2] font-medium', isDone(status) && 'text-fg-muted')}>{node.title}</p>
        {blocked && <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" />}
      </div>

      <div className="mt-auto flex items-center gap-2 text-[10.5px] text-fg-subtle tabular-nums">
        {node.estimated_minutes > 0 && <span>{formatMinutes(node.estimated_minutes)}</span>}
        {node.difficulty && <span className="tracking-tighter">{'●'.repeat(node.difficulty)}</span>}
        {node.exercise_count > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <ClipboardList className="h-3 w-3" /> {node.exercise_count}
          </span>
        )}
        {node.flashcard_count > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <Layers className="h-3 w-3" /> {node.flashcard_count}
          </span>
        )}
        {node.has_note && <NotebookPen className="h-3 w-3" />}
        {ready && (
          <span className="ml-auto rounded-full px-1.5 py-px text-[9.5px] font-semibold tracking-wide uppercase" style={{ color: accent, background: `color-mix(in oklab, ${accent} 12%, transparent)` }}>
            {t('status.ready')}
          </span>
        )}
      </div>

      {hasChildren && (
        <>
          <div className="absolute inset-x-3 bottom-0 h-[3px] overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full" style={{ width: `${childPercent}%`, background: 'var(--status-mastered)' }} />
          </div>
          <button
            className={cn(
              'absolute flex h-5 min-w-5 items-center justify-center rounded-full border bg-bg-elevated px-1 text-[10px] font-semibold text-fg-muted shadow-card hover:border-line-strong hover:text-fg',
              horizontal ? 'top-1/2 -right-2.5 -translate-y-1/2' : '-bottom-2.5 left-1/2 -translate-x-1/2',
            )}
            onClick={(e) => {
              e.stopPropagation()
              data.onToggleCollapse(node.id)
            }}
            aria-label={collapsed ? t('plan.expandAll') : t('plan.collapseAll')}
          >
            {collapsed ? (
              <>
                {hiddenCount}
                {horizontal ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </>
            ) : horizontal ? (
              <ChevronDown className="h-3 w-3 -rotate-90" />
            ) : (
              <ChevronDown className="h-3 w-3 rotate-180" />
            )}
          </button>
        </>
      )}
    </div>
  )
})
