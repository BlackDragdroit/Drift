import { Eye, EyeOff, FileText, Lightbulb, MoreHorizontal, Pencil, Sigma, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { pageImageUrl, useDeleteExercise } from '@/api/documents'
import { useAddAttempt, useExercise } from '@/api/hooks'
import { useSimilarExercise } from '@/api/phase4'
import type { AttemptResult, Exercise } from '@/api/types'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { Badge, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, Spinner } from '@/components/ui/misc'
import { FormulaQuickAdd } from '@/features/formulas/FormulaQuickAdd'
import { t } from '@/i18n'
import { cn, difficultyDots, formatDate } from '@/lib/utils'

import { AnswerBox } from './AnswerBox'
import { ExerciseEditDialog } from './ExerciseEditDialog'
import { RESULT_COLOR } from './ExerciseRow'

export function ExerciseDialog({ exerciseId, onClose }: { exerciseId: number | null; onClose: () => void }) {
  const [overrideId, setOverrideId] = useState<number | null>(null)
  const currentId = overrideId ?? exerciseId
  const { data: exercise, isLoading } = useExercise(currentId)
  const similar = useSimilarExercise()
  const del = useDeleteExercise()
  useEffect(() => { setOverrideId(null) }, [exerciseId])
  const [editOpen, setEditOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)

  const onDelete = () => {
    if (exercise && confirm(t('exercise.deleteConfirm'))) del.mutate(exercise.id, { onSuccess: onClose })
  }

  return (
    <Dialog open={currentId !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title={exercise ? `${exercise.number ? `${exercise.number} · ` : ''}${exercise.title}` : t('exercise.title')}
        description={exercise?.source_label ?? undefined}
        className="max-w-2xl"
      >
        {isLoading || !exercise ? (
          <div className="flex justify-center py-10 text-fg-muted">
            <Spinner />
          </div>
        ) : (
          <>
            {similar.isPending && <p className="mb-2 flex items-center gap-2 text-xs text-fg-muted"><Spinner /> {t('similar.generating')}</p>}
            <div className="-mt-1 mb-3 flex items-center gap-1">
              {exercise.document_id && exercise.page_from && (
                <Button size="sm" variant="outline" onClick={() => setSourceOpen(true)}>
                  <FileText className="h-3.5 w-3.5" /> {t('exercise.showSource')}
                </Button>
              )}
              {exercise.nodes.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setFormulaOpen(true)}>
                  <Sigma className="h-3.5 w-3.5" /> {t('formulas.addTo')}
                </Button>
              )}
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button size="sm" variant="ghost" className="ml-auto" aria-label={t('common.more')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownTrigger>
                <DropdownContent>
                  <DropdownItem onSelect={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" /> {t('exercise.edit')}
                  </DropdownItem>
                  <DropdownItem disabled={similar.isPending} onSelect={() => similar.mutate(exercise.id, { onSuccess: (ex) => setOverrideId(ex.id) })}>
                    <Sparkles className="h-4 w-4" /> {similar.isPending ? t('similar.generating') : t('similar.generate')}
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem danger onSelect={onDelete}>
                    <Trash2 className="h-4 w-4" /> {t('exercise.delete')}
                  </DropdownItem>
                </DropdownContent>
              </Dropdown>
            </div>
            <ExerciseBody key={exercise.id} exercise={exercise} />
            <ExerciseEditDialog open={editOpen} onOpenChange={setEditOpen} exercise={exercise} subjectId={exercise.subject_id} />
            <FormulaQuickAdd exercise={exercise} open={formulaOpen} onOpenChange={setFormulaOpen} />
            {exercise.document_id && exercise.page_from && (
              <SourcePageDialog open={sourceOpen} onOpenChange={setSourceOpen} documentId={exercise.document_id} pageFrom={exercise.page_from} pageTo={exercise.page_to ?? exercise.page_from} title={exercise.document_title ?? ''} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SourcePageDialog({ open, onOpenChange, documentId, pageFrom, pageTo, title }: { open: boolean; onOpenChange: (v: boolean) => void; documentId: number; pageFrom: number; pageTo: number; title: string }) {
  const [page, setPage] = useState(pageFrom)
  useEffect(() => { if (open) setPage(pageFrom) }, [open, pageFrom])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={`p. ${page}`} className="max-w-3xl">
        <div className="mb-2 flex items-center justify-center gap-2 text-sm">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
          <span className="tabular-nums">{page}</span>
          <Button size="sm" variant="ghost" onClick={() => setPage(page + 1)}>›</Button>
          {pageTo > pageFrom && <span className="text-xs text-fg-subtle">({pageFrom}–{pageTo})</span>}
          <Button size="sm" variant="link" asChild>
            <a href={`/api/documents/${documentId}/file#page=${page}`} target="_blank" rel="noreferrer">{t('documents.openPdf')}</a>
          </Button>
        </div>
        <img src={pageImageUrl(documentId, page, 2)} alt={`Page ${page}`} className="mx-auto w-full rounded-md border bg-white" />
      </DialogContent>
    </Dialog>
  )
}

function ExerciseBody({ exercise }: { exercise: Exercise }) {
  const addAttempt = useAddAttempt()
  const [notes, setNotes] = useState('')
  const [answer, setAnswer] = useState('')
  const [locked, setLocked] = useState(false)
  const [showSolution, setShowSolution] = useState(false)
  const [hintsShown, setHintsShown] = useState(0)
  const hasSolution = !!exercise.solution || exercise.parts.some((p) => p.solution)

  useEffect(() => {
    setShowSolution(false)
    setHintsShown(0)
    setAnswer('')
    setLocked(false)
  }, [exercise.id])

  const reveal = () => {
    setShowSolution(true)
    setLocked(true)
  }
  const log = (result: AttemptResult) => {
    setLocked(true)
    addAttempt.mutate({ exerciseId: exercise.id, body: { result, notes, answer: answer.trim() } }, { onSuccess: () => { setNotes(''); setAnswer(''); setLocked(false) } })
  }
  const figureFor = (partId: number | null) => exercise.figures.filter((f) => f.part_id === partId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {exercise.difficulty && <Badge>{t('exercise.difficulty')} {difficultyDots(exercise.difficulty)}</Badge>}
        {exercise.node_keys.map((k) => (
          <Badge key={k} className="font-mono">{k}</Badge>
        ))}
      </div>

      {exercise.statement && <Markdown>{exercise.statement}</Markdown>}
      {figureFor(null).map((f) => (
        <Figure key={f.id} url={f.url} caption={f.caption} />
      ))}

      {exercise.parts.length > 0 && (
        <ol className="space-y-3">
          {exercise.parts.map((p) => (
            <li key={p.id} className="rounded-lg border p-3">
              <div className="flex gap-2.5">
                <span className="mt-0.5 font-mono text-sm font-semibold text-fg-muted">{p.label})</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <Markdown>{p.statement}</Markdown>
                  {figureFor(p.id).map((f) => (
                    <Figure key={f.id} url={f.url} caption={f.caption} />
                  ))}
                  <HintList hints={p.hints} />
                  {p.solution && <Solution text={p.solution} onReveal={() => setLocked(true)} />}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {hasSolution && <AnswerBox value={answer} onChange={setAnswer} locked={locked} onReveal={exercise.solution ? reveal : undefined} />}

      {exercise.hints.length > 0 && (
        <div className="space-y-2">
          {exercise.hints.slice(0, hintsShown).map((h, i) => (
            <div key={i} className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <Markdown>{h}</Markdown>
            </div>
          ))}
          {hintsShown < exercise.hints.length && (
            <Button size="sm" variant="outline" onClick={() => setHintsShown(hintsShown + 1)}>
              <Lightbulb className="h-3.5 w-3.5" /> {t('exercise.hint')} ({hintsShown + 1}/{exercise.hints.length})
            </Button>
          )}
        </div>
      )}

      {exercise.solution && (
        <div>
          <Button size="sm" variant={showSolution ? 'secondary' : 'outline'} onClick={() => (showSolution ? setShowSolution(false) : reveal())}>
            {showSolution ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showSolution ? t('exercise.hideSolution') : t('exercise.solution')}
          </Button>
          {showSolution && (
            <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <Markdown>{exercise.solution}</Markdown>
            </div>
          )}
        </div>
      )}

      <section className="rounded-xl border bg-bg-sunken/40 p-3.5">
        <p className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">{t('exercise.logAttempt')}</p>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('exercise.attemptNotes')} rows={2} className="mb-2.5 bg-bg-elevated" />
        <div className="grid grid-cols-3 gap-2">
          {(['solved', 'partial', 'failed'] as AttemptResult[]).map((r) => (
            <Button key={r} variant="outline" disabled={addAttempt.isPending} onClick={() => log(r)} className="gap-2" style={{ borderColor: `color-mix(in oklab, ${RESULT_COLOR[r]} 50%, transparent)` }}>
              <span className="h-2 w-2 rounded-full" style={{ background: RESULT_COLOR[r] }} />
              {t(`exercise.${r}`)}
            </Button>
          ))}
        </div>
      </section>

      <section>
        <p className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">{t('exercise.attempts')}</p>
        {exercise.attempts.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('exercise.noAttempts')}</p>
        ) : (
          <ul className="space-y-1.5">
            {exercise.attempts.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: RESULT_COLOR[a.result] }} />
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{t(`exercise.${a.result}`)}</span>
                  <span className="ml-2 text-xs text-fg-subtle">{formatDate(a.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  {a.answer && <AttemptAnswer answer={a.answer} />}
                  {a.notes && <p className="text-fg-muted">{a.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Figure({ url, caption }: { url: string; caption: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border bg-white">
      <img src={url} alt={caption} className="mx-auto max-h-80 object-contain" />
      {caption && <figcaption className="border-t bg-bg-elevated px-3 py-1.5 text-xs text-fg-muted">{caption}</figcaption>}
    </figure>
  )
}

function HintList({ hints }: { hints: string[] }) {
  const [shown, setShown] = useState(0)
  if (hints.length === 0) return null
  return (
    <div className="space-y-1.5">
      {hints.slice(0, shown).map((h, i) => (
        <div key={i} className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-sm">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <Markdown>{h}</Markdown>
        </div>
      ))}
      {shown < hints.length && (
        <button className="text-xs font-medium text-amber-600 hover:underline dark:text-amber-400" onClick={() => setShown(shown + 1)}>
          {t('exercise.hint')} ({shown + 1}/{hints.length})
        </button>
      )}
    </div>
  )
}

function AttemptAnswer({ answer }: { answer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-0.5">
      <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {t('exercise.yourAnswer')}
      </button>
      {open && (
        <div className="mt-1 rounded-md border bg-bg-sunken/40 px-2.5 py-1.5 text-sm">
          <Markdown>{answer}</Markdown>
        </div>
      )}
    </div>
  )
}

function Solution({ text, onReveal }: { text: string; onReveal?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button className={cn('text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400')} onClick={() => { if (!open) onReveal?.(); setOpen(!open) }}>
        {open ? t('exercise.hideSolution') : t('exercise.solution')}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  )
}
