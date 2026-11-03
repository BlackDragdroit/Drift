import { describe, expect, it } from 'vitest'

import type { PlanNode, Status } from '@/api/types'

import { buildVisibleGraph, relatedNodes, treeOrder } from './graph'

function node(id: number, overrides: Partial<PlanNode> & { parent_id?: number | null; status?: Status; prereqs?: [number, 'required' | 'recommended'][] } = {}): PlanNode {
  const { parent_id = null, status = 'not_started', prereqs = [], ...rest } = overrides
  return {
    id,
    key: `n${id}`,
    parent_id,
    title: `Node ${id}`,
    description: '',
    objectives: [],
    estimated_minutes: 30,
    difficulty: null,
    resources: [],
    keywords: [],
    sort_order: id,
    prerequisites: prereqs.map(([pid, kind]) => ({ node_id: pid, key: `n${pid}`, kind, note: null })),
    progress: { status, started_at: null, understood_at: null, mastered_at: null, updated_at: null },
    ready: false,
    blocked_by: [],
    descendants_total: 0,
    descendants_done: 0,
    has_note: false,
    flashcard_count: 0,
    exercise_count: 0,
    ...rest,
  }
}

// 1 (chapter) -> 2, 3 ; 4 (chapter) -> 5 ; prereqs: 2 -> 3, 3 -> 5, 2 -> 5 (recommended)
const nodes: PlanNode[] = [
  node(1),
  node(2, { parent_id: 1, status: 'understood' }),
  node(3, { parent_id: 1, prereqs: [[2, 'required']] }),
  node(4),
  node(5, { parent_id: 4, prereqs: [[3, 'required'], [2, 'recommended']] }),
]

describe('treeOrder', () => {
  it('walks depth-first with depths', () => {
    expect(treeOrder(nodes).map((r) => [r.node.id, r.depth])).toEqual([[1, 0], [2, 1], [3, 1], [4, 0], [5, 1]])
  })
})

describe('buildVisibleGraph', () => {
  const base = { collapsed: new Set<number>(), hideFinished: false, focusId: null }

  it('emits hierarchy and prerequisite edges with satisfaction', () => {
    const g = buildVisibleGraph(nodes, base)
    expect(g.nodes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5])
    const prereqs = g.edges.filter((e) => e.kind !== 'hierarchy').map((e) => [e.source, e.target, e.kind, e.satisfied])
    expect(prereqs).toEqual([
      [2, 3, 'required', true],
      [3, 5, 'required', false],
      [2, 5, 'recommended', true],
    ])
    expect(g.edges.filter((e) => e.kind === 'hierarchy').map((e) => [e.source, e.target])).toEqual([[1, 2], [1, 3], [4, 5]])
  })

  it('collapsing re-routes edges of hidden descendants to the collapsed node', () => {
    const g = buildVisibleGraph(nodes, { ...base, collapsed: new Set([1]) })
    expect(g.nodes.map((n) => n.id)).toEqual([1, 4, 5])
    expect(g.hiddenDescendants.get(1)).toBe(2)
    const prereqs = g.edges.filter((e) => e.kind !== 'hierarchy').map((e) => [e.source, e.target, e.kind])
    // 2->3 becomes internal (dropped), 3->5 and 2->5 both become 1->5 (deduped per kind)
    expect(prereqs).toEqual([
      [1, 5, 'required'],
      [1, 5, 'recommended'],
    ])
  })

  it('hideFinished hides done leaves but keeps their edges anchored to the parent', () => {
    const g = buildVisibleGraph(nodes, { ...base, hideFinished: true })
    expect(g.nodes.map((n) => n.id)).toEqual([1, 3, 4, 5])
    const prereqs = g.edges.filter((e) => e.kind !== 'hierarchy').map((e) => [e.source, e.target])
    expect(prereqs).toContainEqual([1, 3])
  })

  it('focus keeps the prerequisite neighbourhood plus containing parents', () => {
    const g = buildVisibleGraph(nodes, { ...base, focusId: 3 })
    expect(g.nodes.map((n) => n.id).sort()).toEqual([1, 2, 3, 4, 5])
    const g2 = buildVisibleGraph([...nodes, node(6)], { ...base, focusId: 3 })
    expect(g2.nodes.find((n) => n.id === 6)).toBeUndefined()
  })
})

describe('relatedNodes', () => {
  it('collects transitive prerequisites and dependents', () => {
    expect([...relatedNodes(3, nodes)].sort()).toEqual([2, 3, 5])
    expect([...relatedNodes(2, nodes)].sort()).toEqual([2, 3, 5])
  })
})
