import { Eye, EyeOff, Lightbulb } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAddAttempt, useExercise } from '@/api/hooks'
import type { AttemptResult, Exercise } from '@/api/types'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { Badge, Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn, difficultyDots, formatDate } from '@/lib/utils'

import { RESULT_COLOR } from './ExerciseRow'

export function ExerciseDialog({ exerciseId, onClose }: { exerciseId: number | null; onClose: () => void }) {
  const { data: exercise, isLoading } = useExercise(exerciseId)
  return (
    <Dialog open={exerciseId !== null} onOpenChange={(v) => !v && onClose()}>
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
          <ExerciseBody key={exercise.id} exercise={exercise} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ExerciseBody({ exercise }: { exercise: Exercise }) {
  const addAttempt = useAddAttempt()
  const [notes, setNotes] = useState('')
  const [showSolution, setShowSolution] = useState(false)
  const [hintsShown, setHintsShown] = useState(0)

  useEffect(() => {
    setShowSolution(false)
    setHintsShown(0)
  }, [exercise.id])

  const log = (result: AttemptResult) => addAttempt.mutate({ exerciseId: exercise.id, body: { result, notes } }, { onSuccess: () => setNotes('') })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5">
        {exercise.difficulty && <Badge>{t('exercise.difficulty')} {difficultyDots(exercise.difficulty)}</Badge>}
        {exercise.node_keys.map((k) => (
          <Badge key={k} className="font-mono">{k}</Badge>
        ))}
      </div>

      {exercise.statement && <Markdown>{exercise.statement}</Markdown>}
      {exercise.figures.map((f) => (
        <figure key={f.id} className="overflow-hidden rounded-lg border bg-white">
          <img src={f.url} alt={f.caption} className="mx-auto max-h-80 object-contain" />
          {f.caption && <figcaption className="border-t px-3 py-1.5 text-xs text-fg-muted">{f.caption}</figcaption>}
        </figure>
      ))}

      {exercise.parts.length > 0 && (
        <ol className="space-y-3">
          {exercise.parts.map((p) => (
            <li key={p.id} className="rounded-lg border p-3">
              <div className="flex gap-2.5">
                <span className="mt-0.5 font-mono text-sm font-semibold text-fg-muted">{p.label})</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <Markdown>{p.statement}</Markdown>
                  <HintList hints={p.hints} />
                  {p.solution && <Solution text={p.solution} />}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

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
          <Button size="sm" variant={showSolution ? 'secondary' : 'outline'} onClick={() => setShowSolution(!showSolution)}>
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

function Solution({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button className={cn('text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400')} onClick={() => setOpen(!open)}>
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
