import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import { ArrowDownToLine, ArrowRightToLine, Crosshair, EyeOff, Info, Maximize, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PlanDetail, Status } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/misc'
import { t } from '@/i18n'
import { useIsMobile } from '@/lib/useMediaQuery'
import { cn, STATUS_COLOR } from '@/lib/utils'

import { buildVisibleGraph, childrenMap, type GraphEdge } from './graph'
import { layoutGraph, type Box, type Direction } from './layout'
import { PlanGroupNode, type PlanGroupFlowNode } from './PlanGroupNode'
import { PlanNodeCard, type PlanFlowNode } from './PlanNodeCard'

const nodeTypes = { plan: PlanNodeCard, planGroup: PlanGroupNode }
type FlowNode = PlanFlowNode | PlanGroupFlowNode

interface Props {
  plan: PlanDetail
  selectedId: number | null
  onSelect: (id: number | null) => void
  onSetStatus: (id: number, status: Status) => void
}

export function MindMap(props: Props) {
  return (
    <ReactFlowProvider>
      <MindMapInner {...props} />
    </ReactFlowProvider>
  )
}

function MindMapInner({ plan, selectedId, onSelect, onSetStatus }: Props) {
  const isMobile = useIsMobile()
  const { fitView, setCenter, getZoom, getInternalNode } = useReactFlow()
  const [direction, setDirection] = useState<Direction>(() => (localStorage.getItem('map.direction') as Direction) || (isMobile ? 'DOWN' : 'RIGHT'))
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [hideFinished, setHideFinished] = useState(false)
  const [focus, setFocus] = useState(false)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [legendOpen, setLegendOpen] = useState(false)
  const layoutKeyRef = useRef('')
  const firstFit = useRef(true)
  const fitPending = useRef(false)

  const children = useMemo(() => childrenMap(plan.nodes), [plan.nodes])
  const graph = useMemo(
    () => buildVisibleGraph(plan.nodes, { collapsed, hideFinished, focusId: focus ? selectedId : null }),
    [plan.nodes, collapsed, hideFinished, focus, selectedId],
  )

  // Re-layout only when the structure changes (not on status/progress changes)
  const layoutKey = `${direction}|${graph.nodes.map((n) => `${n.id}:${n.parent_id}`).join(',')}|${graph.edges.map((e) => e.id).join(',')}`
  useEffect(() => {
    if (layoutKey === layoutKeyRef.current) return
    let cancelled = false
    layoutGraph(graph.nodes.map((n) => ({ id: n.id, parentId: n.parent_id })), graph.edges, direction)
      .then((result) => {
        if (cancelled) return
        layoutKeyRef.current = layoutKey
        fitPending.current = true
        setBoxes(result)
      })
      .catch((err) => console.error('Graph layout failed', err))
    return () => {
      cancelled = true
    }
  }, [layoutKey, graph, direction])

  // Fit the viewport once the new positions have been committed to React Flow
  useEffect(() => {
    if (!fitPending.current) return
    fitPending.current = false
    const id = requestAnimationFrame(() => {
      fitView({ padding: { top: '64px', left: '16px', right: '16px', bottom: '16px' }, duration: firstFit.current ? 0 : 400, maxZoom: 1 })
      firstFit.current = false
    })
    return () => cancelAnimationFrame(id)
  }, [boxes, fitView, isMobile])

  // Center on externally selected node (deep link, outline -> map)
  const lastCentered = useRef<number | null>(null)
  useEffect(() => {
    if (selectedId === null || boxes.length === 0 || lastCentered.current === selectedId) return
    const internal = getInternalNode(String(selectedId))
    if (!internal) return
    lastCentered.current = selectedId
    const { x, y } = internal.internals.positionAbsolute
    const w = internal.measured.width ?? 224
    const h = internal.measured.height ?? 72
    setCenter(x + w / 2, y + h / 2, { zoom: Math.max(getZoom(), 0.9), duration: 400 })
  }, [selectedId, boxes, setCenter, getZoom, getInternalNode])

  const toggleCollapse = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const collapseAll = () => setCollapsed(new Set(plan.nodes.filter((n) => children.get(n.id)?.length).map((n) => n.id)))
  const expandAll = () => setCollapsed(new Set())
  const changeDirection = (d: Direction) => {
    setDirection(d)
    localStorage.setItem('map.direction', d)
  }

  const related = useMemo(() => {
    if (selectedId === null) return null
    const set = new Set<number>([selectedId])
    for (const e of graph.edges) {
      if (e.source === selectedId) set.add(e.target)
      if (e.target === selectedId) set.add(e.source)
    }
    const byId = new Map(plan.nodes.map((n) => [n.id, n]))
    // parents and children of the selection stay readable too
    for (const id of [...set]) {
      let cur = byId.get(id)?.parent_id ?? null
      while (cur !== null) {
        set.add(cur)
        cur = byId.get(cur)?.parent_id ?? null
      }
    }
    for (const c of children.get(selectedId) ?? []) set.add(c.id)
    return set
  }, [selectedId, graph.edges, plan.nodes, children])

  const rfNodes: FlowNode[] = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))
    const out: FlowNode[] = []
    for (const box of boxes) {
      const n = byId.get(box.id)
      if (!n) continue
      const dimmed = related !== null && !related.has(n.id) && !focus
      const common = { id: String(n.id), position: { x: box.x, y: box.y }, parentId: box.parentId !== null ? String(box.parentId) : undefined, draggable: true }
      if (box.isGroup) {
        out.push({
          ...common,
          type: 'planGroup',
          style: { width: box.width, height: box.height },
          width: box.width,
          height: box.height,
          data: { node: n, selected: n.id === selectedId, direction, accent: plan.subject_color, dimmed, onToggleCollapse: toggleCollapse, onSetStatus },
        } as PlanGroupFlowNode)
      } else {
        out.push({
          ...common,
          type: 'plan',
          width: box.width,
          height: box.height,
          data: {
            node: n,
            selected: n.id === selectedId,
            collapsed: collapsed.has(n.id),
            hiddenCount: graph.hiddenDescendants.get(n.id) ?? 0,
            hasChildren: !!children.get(n.id)?.length,
            direction,
            accent: plan.subject_color,
            dimmed,
            onToggleCollapse: toggleCollapse,
            onSetStatus,
          },
        } as PlanFlowNode)
      }
    }
    return out
  }, [graph, boxes, selectedId, collapsed, children, direction, plan.subject_color, related, focus, toggleCollapse, onSetStatus])

  const rfEdges: Edge[] = useMemo(
    () => graph.edges.filter((e) => e.kind !== 'hierarchy').map((e) => toEdge(e, selectedId)),
    [graph.edges, selectedId],
  )

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => onSelect(Number(node.id)), [onSelect])
  const ready = boxes.length > 0 || graph.nodes.length === 0

  return (
    <div className={cn('relative h-full w-full transition-opacity duration-300', !ready && 'opacity-0')}>
      <ReactFlow
        nodes={rfNodes as Node[]}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelect(null)}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        fitView
        panOnScroll={!isMobile}
        zoomOnScroll={!isMobile}
        onlyRenderVisibleElements={plan.nodes.length > 150}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--line-strong)" />
        {!isMobile && <Controls showInteractive={false} position="bottom-right" />}
        {!isMobile && plan.nodes.length > 12 && (
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            nodeColor={(n) => (n.type === 'planGroup' ? 'transparent' : STATUS_COLOR[(n as PlanFlowNode).data.node.progress.status])}
            nodeStrokeColor={(n) => (n.type === 'planGroup' ? 'var(--line-strong)' : 'transparent')}
            nodeStrokeWidth={4}
            maskColor="color-mix(in oklab, var(--bg-sunken) 75%, transparent)"
            style={{ background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--line)', width: 160, height: 100 }}
          />
        )}
      </ReactFlow>

      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border bg-bg-elevated/90 p-1 shadow-card backdrop-blur">
        <Tooltip content={t('plan.direction')}>
          <Button size="icon-sm" variant="ghost" onClick={() => changeDirection(direction === 'RIGHT' ? 'DOWN' : 'RIGHT')}>
            {direction === 'RIGHT' ? <ArrowRightToLine className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
          </Button>
        </Tooltip>
        <Tooltip content={t('plan.collapseAll')}>
          <Button size="icon-sm" variant="ghost" onClick={collapseAll}>
            <Minus className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t('plan.expandAll')}>
          <Button size="icon-sm" variant="ghost" onClick={expandAll}>
            <Plus className="h-4 w-4" />
          </Button>
        </Tooltip>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <Tooltip content={t('plan.onlyUnfinished')}>
          <Button size="icon-sm" variant={hideFinished ? 'secondary' : 'ghost'} onClick={() => setHideFinished(!hideFinished)} className={cn(hideFinished && 'text-accent')}>
            <EyeOff className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t('plan.focus')}>
          <Button size="icon-sm" variant={focus ? 'secondary' : 'ghost'} disabled={selectedId === null && !focus} onClick={() => setFocus(!focus)} className={cn(focus && 'text-accent')}>
            <Crosshair className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t('plan.fit')}>
          <Button size="icon-sm" variant="ghost" onClick={() => fitView({ padding: { top: '64px', left: '16px', right: '16px', bottom: '16px' }, duration: 400 })}>
            <Maximize className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t('plan.legend')}>
          <Button size="icon-sm" variant={legendOpen ? 'secondary' : 'ghost'} onClick={() => setLegendOpen(!legendOpen)}>
            <Info className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
      {legendOpen && <Legend accent={plan.subject_color} />}
    </div>
  )
}

function toEdge(e: GraphEdge, selectedId: number | null): Edge {
  const connected = selectedId !== null && (e.source === selectedId || e.target === selectedId)
  const color = connected ? 'var(--accent)' : e.satisfied ? 'var(--status-mastered)' : 'var(--fg-subtle)'
  return {
    id: e.id,
    source: String(e.source),
    target: String(e.target),
    type: 'default',
    animated: connected && !e.satisfied,
    zIndex: connected ? 10 : 1,
    style: { stroke: color, strokeWidth: connected ? 2.5 : 1.8, strokeDasharray: e.kind === 'recommended' ? '6 5' : undefined, opacity: connected ? 1 : 0.85 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
  }
}

function Legend({ accent }: { accent: string }) {
  const row = 'flex items-center gap-2 text-xs text-fg-muted'
  return (
    <div className="absolute top-14 left-3 z-10 w-56 space-y-2 rounded-lg border bg-bg-elevated/95 p-3 shadow-card backdrop-blur animate-rise">
      {(['not_started', 'in_progress', 'understood', 'mastered'] as Status[]).map((s) => (
        <div key={s} className={row}>
          <span className="h-3 w-3 rounded-sm" style={{ background: STATUS_COLOR[s] }} /> {t(`status.${s}`)}
        </div>
      ))}
      <div className={row}>
        <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: accent, boxShadow: `0 0 0 3px color-mix(in oklab, ${accent} 30%, transparent)` }} /> {t('status.ready')}
      </div>
      <div className="my-1 h-px bg-line" />
      <div className={row}>
        <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--fg-subtle)" strokeWidth="2" /></svg> {t('plan.requiredEdge')}
      </div>
      <div className={row}>
        <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--fg-subtle)" strokeWidth="2" strokeDasharray="5 4" /></svg> {t('plan.recommendedEdge')}
      </div>
      <div className={row}>
        <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="var(--status-mastered)" strokeWidth="2" /></svg> {t('status.understood')} ✓
      </div>
    </div>
  )
}
