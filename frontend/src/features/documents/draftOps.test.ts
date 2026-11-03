import { describe, expect, it } from 'vitest'

import type { ExerciseDraft } from '@/api/types'

import { emptyDraft, isEmptyDraft, mergeWithNext, move, nextPartLabel, splitBeforePart, splitStatementAt } from './draftOps'

function draft(over: Partial<ExerciseDraft>): ExerciseDraft {
  return { ...emptyDraft(1), ...over }
}

const a = draft({ id: 'a', number: '1', statement: 'Intro', parts: [{ id: 'p1', label: 'a', statement: 'A', hints: [], solution: null }], figures: [{ id: 'f1', page: 1, bbox: [0, 0, 0.5, 0.5], caption: '', part_label: 'a', path: 'x' }], node_ids: [1], page_to: 1 })
const b = draft({ id: 'b', number: '2', statement: 'More', parts: [{ id: 'p2', label: 'a', statement: 'B', hints: [], solution: 'sol' }], page_from: 2, page_to: 2, node_ids: [2] })

describe('mergeWithNext', () => {
  it('concatenates content, relabels clashing parts and widens the page range', () => {
    const [m] = mergeWithNext([a, b], 0)
    expect(m.statement).toBe('Intro\n\nMore')
    expect(m.parts.map((p) => p.label)).toEqual(['a', "a'"])
    expect([m.page_from, m.page_to]).toEqual([1, 2])
    expect(m.node_ids).toEqual([1, 2])
    expect(mergeWithNext([a, b], 1)).toHaveLength(2)
  })
})

describe('split', () => {
  it('splits before a part and moves part-bound figures along', () => {
    const d = draft({ id: 'd', number: '3', parts: [{ id: '1', label: 'a', statement: 'A', hints: [], solution: null }, { id: '2', label: 'b', statement: 'B', hints: [], solution: null }], figures: [{ id: 'f', page: 1, bbox: [0, 0, 1, 1], caption: '', part_label: 'b', path: 'p' }] })
    const out = splitBeforePart([d], 0, 1)
    expect(out).toHaveLength(2)
    expect(out[0].parts.map((p) => p.label)).toEqual(['a'])
    expect(out[1].parts.map((p) => p.label)).toEqual(['b'])
    expect(out[0].figures).toEqual([])
    expect(out[1].figures).toHaveLength(1)
    expect(out[1].number).toBe('3b')
    expect(splitBeforePart([d], 0, 0)).toHaveLength(1)
  })

  it('splits a statement at a cursor offset', () => {
    const d = draft({ id: 'd', statement: 'First task. Second task.' })
    const out = splitStatementAt([d], 0, 12)
    expect(out.map((x) => x.statement)).toEqual(['First task.', 'Second task.'])
    expect(splitStatementAt([d], 0, 0)).toHaveLength(1)
  })
})

describe('helpers', () => {
  it('moves and detects empties', () => {
    expect(move([a, b], 0, 1).map((d) => d.id)).toEqual(['b', 'a'])
    expect(move([a, b], 1, 1).map((d) => d.id)).toEqual(['a', 'b'])
    expect(isEmptyDraft(emptyDraft(1))).toBe(true)
    expect(isEmptyDraft(a)).toBe(false)
  })
  it('suggests the next part label', () => {
    expect(nextPartLabel([])).toBe('a')
    expect(nextPartLabel([{ id: '1', label: 'b', statement: '', hints: [], solution: null }])).toBe('c')
    expect(nextPartLabel([{ id: '1', label: '2', statement: '', hints: [], solution: null }])).toBe('3')
  })
})
