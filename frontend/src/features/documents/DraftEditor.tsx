import { ArrowDown, ArrowUp, ChevronDown, Eye, Merge, Pencil, Plus, Scissors, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'

import type { ExerciseDraft, PartDraft, SubjectNode } from '@/api/types'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Tooltip } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

import { isEmptyDraft, newId, nextPartLabel } from './draftOps'
import { TopicPicker } from './TopicPicker'

interface Props {
  draft: ExerciseDraft
  index: number
  total: number
  selected: boolean
  nodes: SubjectNode[]
  onChange: (d: ExerciseDraft) => void
  onSelect: () => void
  onMergeNext: () => void
  onSplitBeforePart: (partIndex: number) => void
  onSplitAtCursor: (offset: number) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
  onShowFigure: (page: number, figureId: string) => void
  onRemoveFigure: (figureId: string) => void
}

export function DraftEditor({ draft, index, total, selected, nodes, onChange, onSelect, onMergeNext, onSplitBeforePart, onSplitAtCursor, onMove, onDelete, onShowFigure, onRemoveFigure }: Props) {
  const [preview, setPreview] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const statementRef = useRef<HTMLTextAreaElement>(null)
  const set = <K extends keyof ExerciseDraft>(key: K, value: ExerciseDraft[K]) => onChange({ ...draft, [key]: value })
  const setPart = (i: number, patch: Partial<PartDraft>) => set('parts', draft.parts.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const empty = isEmptyDraft(draft)

  return (
    <article
      id={`draft-${draft.id}`}
      onClick={onSelect}
      className={cn('rounded-xl border bg-bg-elevated shadow-card transition-colors', selected ? 'border-accent ring-1 ring-accent/30' : 'hover:border-line-strong')}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <button onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed) }} className="rounded p-0.5 text-fg-subtle hover:text-fg" aria-label={collapsed ? t('common.open') : t('common.close')}>
          <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && '-rotate-90')} />
        </button>
        <Input value={draft.number ?? ''} onChange={(e) => set('number', e.target.value || null)} placeholder={t('review.number')} className="h-7 w-16 text-xs" />
        <Input value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder={t('review.titleField')} className="h-7 flex-1 text-sm font-medium" />
        <span className="hidden text-[11px] text-fg-subtle tabular-nums sm:inline">p. {draft.page_from === draft.page_to ? draft.page_from : `${draft.page_from}–${draft.page_to}`}</span>
        <div className="flex items-center">
          <Tooltip content={preview ? t('review.edit') : t('review.preview')}>
            <Button size="icon-sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setPreview(!preview) }}>
              {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>
          <Tooltip content={t('review.moveUp')}>
            <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={(e) => { e.stopPropagation(); onMove(-1) }}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('review.moveDown')}>
            <Button size="icon-sm" variant="ghost" disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); onMove(1) }}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('review.merge')}>
            <Button size="icon-sm" variant="ghost" disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); onMergeNext() }}>
              <Merge className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('review.delete')}>
            <Button size="icon-sm" variant="ghost" className="hover:text-red-600" onClick={(e) => { e.stopPropagation(); onDelete() }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </header>

      {!collapsed && (
        <div className="space-y-3 border-t px-3 py-3">
          {empty && <p className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">{t('review.empty')}</p>}

          <Labeled label={t('review.statement')}>
            {preview ? (
              <Markdown>{draft.statement || '*—*'}</Markdown>
            ) : (
              <>
                <Textarea ref={statementRef} value={draft.statement} onChange={(e) => set('statement', e.target.value)} rows={Math.min(12, Math.max(3, draft.statement.split('\n').length + 1))} className="font-mono text-xs leading-relaxed" />
                {draft.statement.length > 40 && (
                  <button
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
                    onClick={(e) => { e.stopPropagation(); const el = statementRef.current; if (el) onSplitAtCursor(el.selectionStart) }}
                  >
                    <Scissors className="h-3 w-3" /> {t('review.splitAtCursor')}
                  </button>
                )}
              </>
            )}
          </Labeled>

          <Labeled label={`${t('review.parts')} (${draft.parts.length})`}>
            <ol className="space-y-2">
              {draft.parts.map((p, i) => (
                <li key={p.id} className="rounded-lg border bg-bg-sunken/40 p-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Input value={p.label} onChange={(e) => setPart(i, { label: e.target.value })} className="h-6 w-12 text-center font-mono text-xs" />
                    <span className="text-[11px] text-fg-subtle">{t('review.part')}</span>
                    <div className="ml-auto flex items-center gap-0.5">
                      {i > 0 && (
                        <Tooltip content={t('review.splitHere')}>
                          <Button size="icon-sm" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onSplitBeforePart(i) }}>
                            <Scissors className="h-3 w-3" />
                          </Button>
                        </Tooltip>
                      )}
                      <Button size="icon-sm" variant="ghost" className="h-6 w-6 hover:text-red-600" onClick={(e) => { e.stopPropagation(); set('parts', draft.parts.filter((_, j) => j !== i)) }} aria-label={t('review.remove')}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {preview ? (
                    <div className="space-y-1">
                      <Markdown>{p.statement}</Markdown>
                      {p.solution && <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-1.5 text-xs"><Markdown>{p.solution}</Markdown></div>}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Textarea value={p.statement} onChange={(e) => setPart(i, { statement: e.target.value })} rows={Math.min(8, Math.max(2, p.statement.split('\n').length))} className="min-h-0 bg-bg-elevated font-mono text-xs" placeholder={t('review.statement')} />
                      <Textarea value={p.solution ?? ''} onChange={(e) => setPart(i, { solution: e.target.value || null })} rows={p.solution ? Math.min(8, Math.max(2, p.solution.split('\n').length)) : 1} className="min-h-0 bg-bg-elevated font-mono text-xs" placeholder={`${t('review.solution')} (${t('common.optional')})`} />
                      <Textarea value={p.hints.join('\n')} onChange={(e) => setPart(i, { hints: e.target.value.split('\n').filter((h) => h.trim()) })} rows={p.hints.length ? p.hints.length : 1} className="min-h-0 bg-bg-elevated font-mono text-xs" placeholder={`${t('review.hints')} (${t('common.optional')})`} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <Button size="sm" variant="ghost" className="mt-1.5" onClick={(e) => { e.stopPropagation(); set('parts', [...draft.parts, { id: newId(), label: nextPartLabel(draft.parts), statement: '', hints: [], solution: null }]) }}>
              <Plus className="h-3.5 w-3.5" /> {t('review.addPart')}
            </Button>
          </Labeled>

          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label={t('review.hints')}>
              {preview ? (
                <ul className="list-disc pl-4 text-sm">{draft.hints.map((h, i) => <li key={i}><Markdown inline>{h}</Markdown></li>)}</ul>
              ) : (
                <Textarea value={draft.hints.join('\n')} onChange={(e) => set('hints', e.target.value.split('\n').filter((h) => h.trim()))} rows={2} className="min-h-0 font-mono text-xs" />
              )}
            </Labeled>
            <Labeled label={t('review.solution')}>
              {preview ? (
                <Markdown>{draft.solution || '*—*'}</Markdown>
              ) : (
                <Textarea value={draft.solution ?? ''} onChange={(e) => set('solution', e.target.value || null)} rows={2} className="min-h-0 font-mono text-xs" />
              )}
            </Labeled>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Labeled label={t('review.difficulty')}>
              <Select value={draft.difficulty ?? ''} onChange={(e) => set('difficulty', e.target.value ? Number(e.target.value) : null)} className="h-8 w-24 text-xs">
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{'●'.repeat(d)}</option>)}
              </Select>
            </Labeled>
            <Labeled label={t('review.pagesField')}>
              <div className="flex items-center gap-1">
                <Input type="number" min={1} value={draft.page_from} onChange={(e) => set('page_from', Number(e.target.value) || 1)} className="h-8 w-16 text-xs" />
                <span className="text-fg-subtle">–</span>
                <Input type="number" min={1} value={draft.page_to} onChange={(e) => set('page_to', Number(e.target.value) || draft.page_from)} className="h-8 w-16 text-xs" />
              </div>
            </Labeled>
          </div>

          <Labeled label={`${t('review.figures')} (${draft.figures.length})`}>
            {draft.figures.length === 0 ? (
              <p className="text-xs text-fg-subtle">{t('review.addFigure')}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {draft.figures.map((f) => (
                  <li key={f.id} className="group relative w-36 overflow-hidden rounded-lg border bg-white">
                    <button onClick={(e) => { e.stopPropagation(); onShowFigure(f.page, f.id) }} className="block w-full" title={t('review.figureOnPage', { n: f.page })}>
                      <img src={f.url ?? `/api/files/${f.path}`} alt={f.caption} className="h-24 w-full object-contain" />
                    </button>
                    <input
                      value={f.caption}
                      onChange={(e) => set('figures', draft.figures.map((g) => (g.id === f.id ? { ...g, caption: e.target.value } : g)))}
                      placeholder={t('review.figureCaption')}
                      className="w-full border-t bg-bg-elevated px-1.5 py-1 text-[11px] text-fg focus:outline-none"
                    />
                    <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={(e) => { e.stopPropagation(); onRemoveFigure(f.id) }} className="rounded bg-black/60 p-0.5 text-white" aria-label={t('review.remove')}>
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <Badge className="absolute top-1 left-1 bg-black/60 text-white">p. {f.page}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Labeled>

          <Labeled label={t('review.topics')}>
            <TopicPicker nodes={nodes} value={draft.node_ids} suggested={draft.suggested_node_ids} onChange={(ids) => set('node_ids', ids)} compact />
          </Labeled>
        </div>
      )}
    </article>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold tracking-wide text-fg-muted uppercase">{label}</p>
      {children}
    </div>
  )
}
