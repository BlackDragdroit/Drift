import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { ChevronsDownUp } from 'lucide-react'
import { memo } from 'react'

import type { PlanNode, Status } from '@/api/types'
import { StatusIcon } from '@/components/StatusControl'
import { t } from '@/i18n'
import { cn, formatMinutes, nextStatus } from '@/lib/utils'

import type { Direction } from './layout'

export type PlanGroupFlowNode = Node<
  {
    node: PlanNode
    selected: boolean
    direction: Direction
    accent: string
    dimmed: boolean
    onToggleCollapse: (id: number) => void
    onSetStatus: (id: number, status: Status) => void
  },
  'planGroup'
>

export const PlanGroupNode = memo(function PlanGroupNode({ data }: NodeProps<PlanGroupFlowNode>) {
  const { node, selected, direction, accent, dimmed } = data
  const status = node.progress.status
  const horizontal = direction === 'RIGHT'
  const percent = node.descendants_total ? (100 * node.descendants_done) / node.descendants_total : 0
  return (
    <div
      className={cn('h-full w-full rounded-2xl border transition-[opacity,border-color] duration-200', selected && 'border-accent', dimmed && 'opacity-50')}
      style={{
        borderColor: selected ? undefined : `color-mix(in oklab, ${accent} 35%, var(--line))`,
        background: `color-mix(in oklab, ${accent} 4%, transparent)`,
      }}
    >
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} />
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} />
      <div className="flex h-12 items-center gap-2 px-3">
        <button
          className="shrink-0 rounded-full p-0.5 transition-transform hover:scale-110 hover:bg-bg-sunken"
          onClick={(e) => {
            e.stopPropagation()
            data.onSetStatus(node.id, nextStatus(status))
          }}
          aria-label={t(`status.${status}`)}
          title={t(`status.${status}`)}
        >
          <StatusIcon status={status} className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight">{node.title}</span>
        <span className="shrink-0 text-[11px] text-fg-subtle tabular-nums">
          {node.descendants_done}/{node.descendants_total}
          {node.estimated_minutes > 0 && ` · ${formatMinutes(node.estimated_minutes)}`}
        </span>
        <button
          className="shrink-0 rounded-md p-1 text-fg-subtle hover:bg-bg-sunken hover:text-fg"
          onClick={(e) => {
            e.stopPropagation()
            data.onToggleCollapse(node.id)
          }}
          aria-label={t('plan.collapseAll')}
        >
          <ChevronsDownUp className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mx-3 h-[3px] overflow-hidden rounded-full bg-line/70">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${percent}%`, background: 'var(--status-mastered)' }} />
      </div>
    </div>
  )
})
