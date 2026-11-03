import { Plus, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { useCreateExercise, useSubjectNodes, useUpdateExercise } from '@/api/documents'
import type { Exercise, ExercisePartIn } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Spinner } from '@/components/ui/misc'
import { nextPartLabel } from '@/features/documents/draftOps'
import { TopicPicker } from '@/features/documents/TopicPicker'
import { t } from '@/i18n'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Existing exercise to edit; omit to create a new one in `subjectId`. */
  exercise?: Exercise
  subjectId: number
  defaultNodeIds?: number[]
  onSaved?: (exercise: Exercise) => void
}

export function ExerciseEditDialog({ open, onOpenChange, exercise, subjectId, defaultNodeIds = [], onSaved }: Props) {
  const update = useUpdateExercise()
  const create = useCreateExercise()
  const { data: nodes = [] } = useSubjectNodes(subjectId)
  const [number, setNumber] = useState('')
  const [title, setTitle] = useState('')
  const [statement, setStatement] = useState('')
  const [hints, setHints] = useState('')
  const [solution, setSolution] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [parts, setParts] = useState<ExercisePartIn[]>([])
  const [nodeIds, setNodeIds] = useState<number[]>([])

  useEffect(() => {
    if (!open) return
    setNumber(exercise?.number ?? '')
    setTitle(exercise?.title ?? '')
    setStatement(exercise?.statement ?? '')
    setHints(exercise?.hints.join('\n') ?? '')
    setSolution(exercise?.solution ?? '')
    setDifficulty(exercise?.difficulty ? String(exercise.difficulty) : '')
    setParts(exercise?.parts.map((p) => ({ label: p.label, statement: p.statement, hints: p.hints, solution: p.solution })) ?? [])
    setNodeIds(exercise?.node_ids ?? defaultNodeIds)
  }, [open, exercise, defaultNodeIds])

  const pending = update.isPending || create.isPending
  const setPart = (i: number, patch: Partial<ExercisePartIn>) => setParts(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const common = {
      number: number.trim() || null,
      title: title.trim(),
      statement,
      hints: hints.split('\n').map((h) => h.trim()).filter(Boolean),
      solution: solution.trim() || null,
      difficulty: difficulty ? Number(difficulty) : null,
      parts: parts.map((p) => ({ ...p, hints: p.hints ?? [], solution: p.solution?.trim() || null })),
      node_ids: nodeIds,
    }
    const done = (ex: Exercise) => { onOpenChange(false); onSaved?.(ex) }
    if (exercise) update.mutate({ id: exercise.id, body: { ...common, clear_solution: !common.solution, clear_difficulty: !common.difficulty } }, { onSuccess: done })
    else create.mutate({ subject_id: subjectId, tags: [], ...common }, { onSuccess: done })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={exercise ? t('exercise.edit') : t('exercise.new')}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" type="submit" form="exercise-form" disabled={pending || !title.trim()}>
              {pending ? <Spinner /> : exercise ? t('common.save') : t('exercise.create')}
            </Button>
          </>
        }
      >
        <form id="exercise-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Field label={t('review.number')}>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
            <Field label={t('review.titleField')}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
            </Field>
          </div>
          <Field label={t('review.statement')} hint="Markdown + $LaTeX$">
            <Textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={5} className="font-mono text-xs" />
          </Field>
          <Field label={`${t('review.parts')} (${parts.length})`}>
            <ol className="space-y-2">
              {parts.map((p, i) => (
                <li key={i} className="rounded-lg border bg-bg-sunken/40 p-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Input value={p.label} onChange={(e) => setPart(i, { label: e.target.value })} className="h-6 w-12 text-center font-mono text-xs" />
                    <Button size="icon-sm" variant="ghost" className="ml-auto h-6 w-6" onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label={t('review.remove')}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <Textarea value={p.statement} onChange={(e) => setPart(i, { statement: e.target.value })} rows={2} className="mb-1.5 min-h-0 bg-bg-elevated font-mono text-xs" placeholder={t('review.statement')} />
                  <Textarea value={p.solution ?? ''} onChange={(e) => setPart(i, { solution: e.target.value })} rows={1} className="min-h-0 bg-bg-elevated font-mono text-xs" placeholder={`${t('review.solution')} (${t('common.optional')})`} />
                </li>
              ))}
            </ol>
            <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => setParts([...parts, { label: nextPartLabel(parts.map((p, i) => ({ id: String(i), label: p.label, statement: p.statement, hints: p.hints ?? [], solution: p.solution ?? null }))), statement: '', hints: [], solution: null }])}>
              <Plus className="h-3.5 w-3.5" /> {t('review.addPart')}
            </Button>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('review.hints')}>
              <Textarea value={hints} onChange={(e) => setHints(e.target.value)} rows={2} className="min-h-0 font-mono text-xs" />
            </Field>
            <Field label={t('review.solution')}>
              <Textarea value={solution} onChange={(e) => setSolution(e.target.value)} rows={2} className="min-h-0 font-mono text-xs" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Field label={t('review.difficulty')}>
              <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{'●'.repeat(d)}</option>)}
              </Select>
            </Field>
            <Field label={t('review.topics')}>
              <TopicPicker nodes={nodes} value={nodeIds} onChange={setNodeIds} compact />
            </Field>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
