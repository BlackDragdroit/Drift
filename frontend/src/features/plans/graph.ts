import type { PlanNode } from '@/api/types'
import { isDone } from '@/lib/utils'

export type EdgeKind = 'hierarchy' | 'required' | 'recommended'

export interface GraphEdge {
  id: string
  source: number
  target: number
  kind: EdgeKind
  /** For prerequisite edges: whether the prerequisite is already done. */
  satisfied: boolean
}

export interface VisibleGraph {
  nodes: PlanNode[]
  edges: GraphEdge[]
  /** node id -> number of hidden descendants (for collapsed badge) */
  hiddenDescendants: Map<number, number>
}

export interface GraphOptions {
  collapsed: Set<number>
  hideFinished: boolean
  focusId: number | null
}

export function childrenMap(nodes: PlanNode[]): Map<number | null, PlanNode[]> {
  const map = new Map<number | null, PlanNode[]>()
  for (const n of [...nodes].sort((a, b) => a.sort_order - b.sort_order)) {
    const list = map.get(n.parent_id) ?? []
    list.push(n)
    map.set(n.parent_id, list)
  }
  return map
}

/** Depth-first order with depth, as shown in the outline. */
export function treeOrder(nodes: PlanNode[]): { node: PlanNode; depth: number }[] {
  const children = childrenMap(nodes)
  const out: { node: PlanNode; depth: number }[] = []
  const visit = (parent: number | null, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      out.push({ node: n, depth })
      visit(n.id, depth + 1)
    }
  }
  visit(null, 0)
  // orphans (parent archived) go last
  const seen = new Set(out.map((o) => o.node.id))
  for (const n of nodes) if (!seen.has(n.id)) out.push({ node: n, depth: 0 })
  return out
}

export function descendantsOf(nodeId: number, children: Map<number | null, PlanNode[]>): number[] {
  const out: number[] = []
  const stack = [...(children.get(nodeId) ?? [])]
  while (stack.length) {
    const n = stack.pop()!
    out.push(n.id)
    stack.push(...(children.get(n.id) ?? []))
  }
  return out
}

/** Transitive prerequisite ancestors and dependents of a node (for focus mode). */
export function relatedNodes(nodeId: number, nodes: PlanNode[]): Set<number> {
  const prereqs = new Map<number, number[]>()
  const dependents = new Map<number, number[]>()
  for (const n of nodes) {
    prereqs.set(n.id, n.prerequisites.map((p) => p.node_id))
    for (const p of n.prerequisites) {
      const list = dependents.get(p.node_id) ?? []
      list.push(n.id)
      dependents.set(p.node_id, list)
    }
  }
  const related = new Set<number>([nodeId])
  const walk = (start: number, map: Map<number, number[]>) => {
    const stack = [start]
    while (stack.length) {
      const cur = stack.pop()!
      for (const next of map.get(cur) ?? []) {
        if (!related.has(next)) {
          related.add(next)
          stack.push(next)
        }
      }
    }
  }
  walk(nodeId, prereqs)
  walk(nodeId, dependents)
  return related
}

export function buildVisibleGraph(nodes: PlanNode[], opts: GraphOptions): VisibleGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = childrenMap(nodes)
  const hidden = new Set<number>()
  const hiddenDescendants = new Map<number, number>()

  for (const id of opts.collapsed) {
    if (!byId.has(id)) continue
    const desc = descendantsOf(id, children)
    desc.forEach((d) => hidden.add(d))
    hiddenDescendants.set(id, desc.length)
  }
  if (opts.hideFinished) {
    for (const n of nodes) {
      if (isDone(n.progress.status) && !(children.get(n.id)?.length)) hidden.add(n.id)
    }
  }
  let focus: Set<number> | null = null
  if (opts.focusId !== null && byId.has(opts.focusId)) {
    focus = relatedNodes(opts.focusId, nodes)
    // keep hierarchy parents of the related nodes for context
    for (const id of [...focus]) {
      let cur = byId.get(id)?.parent_id ?? null
      while (cur !== null && !focus.has(cur)) {
        focus.add(cur)
        cur = byId.get(cur)?.parent_id ?? null
      }
    }
    hidden.delete(opts.focusId)
  }

  const isVisible = (id: number) => !hidden.has(id) && (focus === null || focus.has(id))

  /** Nearest visible ancestor (hierarchy) or null. */
  const visibleAnchor = (id: number): number | null => {
    let cur: number | null = id
    while (cur !== null) {
      if (isVisible(cur)) return cur
      cur = byId.get(cur)?.parent_id ?? null
    }
    return null
  }

  const visibleNodes = nodes.filter((n) => isVisible(n.id))
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const push = (e: GraphEdge) => {
    if (e.source === e.target) return
    const key = `${e.kind}:${e.source}->${e.target}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push(e)
  }

  for (const n of nodes) {
    if (n.parent_id !== null && byId.has(n.parent_id)) {
      const s = visibleAnchor(n.parent_id)
      const t = visibleAnchor(n.id)
      if (s !== null && t !== null && t === n.id) push({ id: `h-${s}-${t}`, source: s, target: t, kind: 'hierarchy', satisfied: true })
    }
    for (const p of n.prerequisites) {
      const s = visibleAnchor(p.node_id)
      const t = visibleAnchor(n.id)
      if (s === null || t === null) continue
      const prereq = byId.get(p.node_id)
      push({ id: `p-${s}-${t}-${p.kind}`, source: s, target: t, kind: p.kind, satisfied: prereq ? isDone(prereq.progress.status) : false })
    }
  }
  return { nodes: visibleNodes, edges, hiddenDescendants }
}
