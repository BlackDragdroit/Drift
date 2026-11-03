import type { ExerciseDraft, PartDraft } from '@/api/types'

export const newId = () => Math.random().toString(36).slice(2, 12)

export function emptyDraft(page: number): ExerciseDraft {
  return { id: newId(), number: null, title: '', statement: '', parts: [], hints: [], solution: null, difficulty: null, page_from: page, page_to: page, figures: [], node_ids: [], suggested_node_ids: [] }
}

export function isEmptyDraft(d: ExerciseDraft) {
  return !d.statement.trim() && !d.parts.some((p) => p.statement.trim())
}

/** Merge drafts[i + 1] into drafts[i]. */
export function mergeWithNext(drafts: ExerciseDraft[], i: number): ExerciseDraft[] {
  if (i < 0 || i + 1 >= drafts.length) return drafts
  const a = drafts[i]
  const b = drafts[i + 1]
  const labels = new Set(a.parts.map((p) => p.label))
  const parts = [...a.parts, ...b.parts.map((p) => (labels.has(p.label) ? { ...p, label: `${p.label}'` } : p))]
  const merged: ExerciseDraft = {
    ...a,
    number: a.number || b.number,
    title: a.title || b.title,
    statement: [a.statement, b.statement].filter((s) => s.trim()).join('\n\n'),
    parts,
    hints: [...a.hints, ...b.hints],
    solution: a.solution && b.solution ? `${a.solution}\n\n${b.solution}` : a.solution || b.solution,
    difficulty: a.difficulty ?? b.difficulty,
    page_from: Math.min(a.page_from, b.page_from),
    page_to: Math.max(a.page_to, b.page_to),
    figures: [...a.figures, ...b.figures],
    node_ids: [...new Set([...a.node_ids, ...b.node_ids])],
    suggested_node_ids: [...new Set([...a.suggested_node_ids, ...b.suggested_node_ids])],
  }
  return [...drafts.slice(0, i), merged, ...drafts.slice(i + 2)]
}

/** Split drafts[i] so that parts[partIndex..] become a new exercise right after it. */
export function splitBeforePart(drafts: ExerciseDraft[], i: number, partIndex: number): ExerciseDraft[] {
  const d = drafts[i]
  if (!d || partIndex <= 0 || partIndex >= d.parts.length) return drafts
  const head: ExerciseDraft = { ...d, parts: d.parts.slice(0, partIndex) }
  const movedLabels = new Set(d.parts.slice(partIndex).map((p) => p.label))
  const tail: ExerciseDraft = {
    ...emptyDraft(d.page_to),
    number: d.number ? `${d.number}b` : null,
    title: d.title ? `${d.title} (2)` : '',
    parts: d.parts.slice(partIndex),
    page_from: d.page_from,
    page_to: d.page_to,
    figures: d.figures.filter((f) => f.part_label && movedLabels.has(f.part_label)),
    node_ids: [...d.node_ids],
    suggested_node_ids: [...d.suggested_node_ids],
    difficulty: d.difficulty,
  }
  head.figures = d.figures.filter((f) => !(f.part_label && movedLabels.has(f.part_label)))
  return [...drafts.slice(0, i), head, tail, ...drafts.slice(i + 1)]
}

/** Split the statement of drafts[i] at a character offset; the remainder becomes a new exercise. */
export function splitStatementAt(drafts: ExerciseDraft[], i: number, offset: number): ExerciseDraft[] {
  const d = drafts[i]
  if (!d) return drafts
  const before = d.statement.slice(0, offset).trimEnd()
  const after = d.statement.slice(offset).trimStart()
  if (!before || !after) return drafts
  const head: ExerciseDraft = { ...d, statement: before }
  const tail: ExerciseDraft = { ...emptyDraft(d.page_to), statement: after, page_from: d.page_from, page_to: d.page_to, node_ids: [...d.node_ids], suggested_node_ids: [...d.suggested_node_ids], difficulty: d.difficulty }
  return [...drafts.slice(0, i), head, tail, ...drafts.slice(i + 1)]
}

export function move(drafts: ExerciseDraft[], i: number, dir: -1 | 1): ExerciseDraft[] {
  const j = i + dir
  if (j < 0 || j >= drafts.length) return drafts
  const copy = [...drafts]
  ;[copy[i], copy[j]] = [copy[j], copy[i]]
  return copy
}

export function nextPartLabel(parts: PartDraft[]): string {
  const last = parts.at(-1)?.label ?? ''
  if (/^[a-y]$/i.test(last)) return String.fromCharCode(last.charCodeAt(0) + 1)
  if (/^\d+$/.test(last)) return String(Number(last) + 1)
  return parts.length === 0 ? 'a' : `${parts.length + 1}`
}
