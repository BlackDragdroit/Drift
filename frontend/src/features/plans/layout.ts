import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'

import type { GraphEdge } from './graph'

export type Direction = 'RIGHT' | 'DOWN'

export const NODE_WIDTH = 224
export const NODE_HEIGHT = 72
export const GROUP_HEADER = 48
const GROUP_PAD = 14

let elk: InstanceType<typeof ELK> | null = null

export interface LayoutInput {
  id: number
  parentId: number | null
}

export interface Box {
  id: number
  parentId: number | null
  /** Position relative to the parent box (React Flow convention). */
  x: number
  y: number
  width: number
  height: number
  isGroup: boolean
}

/**
 * Compound layered layout: nodes with visible children become group containers,
 * prerequisite edges define the flow inside and across groups.
 * Returns boxes in depth-first order (parents before children).
 */
export async function layoutGraph(nodes: LayoutInput[], edges: GraphEdge[], direction: Direction): Promise<Box[]> {
  elk ??= new ELK()
  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<number | null, number[]>()
  for (const n of nodes) {
    const parent = n.parentId !== null && ids.has(n.parentId) ? n.parentId : null
    const list = children.get(parent) ?? []
    list.push(n.id)
    children.set(parent, list)
  }

  const layered = {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.layered.spacing.nodeNodeBetweenLayers': direction === 'RIGHT' ? '64' : '48',
    'elk.spacing.nodeNode': direction === 'RIGHT' ? '18' : '24',
    'elk.spacing.componentComponent': '28',
    'elk.layered.spacing.edgeNodeBetweenLayers': '20',
    // NOTE: considerModelOrder / forceNodeModelOrder crash ELK on compound graphs (INCLUDE_CHILDREN)
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
    'elk.edgeRouting': 'ORTHOGONAL',
  }

  const toElk = (id: number): ElkNode => {
    const kids = children.get(id)
    if (!kids?.length) return { id: String(id), width: NODE_WIDTH, height: NODE_HEIGHT }
    return {
      id: String(id),
      layoutOptions: { ...layered, 'elk.padding': `[top=${GROUP_HEADER + GROUP_PAD},left=${GROUP_PAD},bottom=${GROUP_PAD},right=${GROUP_PAD}]` },
      children: kids.map(toElk),
    }
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: { ...layered, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' },
    children: (children.get(null) ?? []).map(toElk),
    edges: edges
      .filter((e) => e.kind !== 'hierarchy' && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ id: e.id, sources: [String(e.source)], targets: [String(e.target)] })),
  }

  const result = await elk.layout(graph)
  const boxes: Box[] = []
  const visit = (node: ElkNode, parentId: number | null) => {
    for (const child of node.children ?? []) {
      const id = Number(child.id)
      boxes.push({
        id,
        parentId,
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? NODE_WIDTH,
        height: child.height ?? NODE_HEIGHT,
        isGroup: !!child.children?.length,
      })
      visit(child, id)
    }
  }
  visit(result, null)
  return boxes
}
