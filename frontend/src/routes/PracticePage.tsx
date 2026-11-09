import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Flag, Lightbulb, Play, RotateCcw, Shuffle, Sigma, SkipForward, Timer } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { useSubjectNodes } from '@/api/documents'
import { useAddAttempt, useExercise, useSubjects } from '@/api/hooks'
import { fetchPracticeQueue, type PracticeRequest } from '@/api/learning'
import type { AttemptResult, Exercise } from '@/api/types'
import { PageHeader } from '@/components/layout/AppShell'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import { Badge, Checkbox, Kbd, ProgressBar, Spinner } from '@/components/ui/misc'
import { TopicPicker } from '@/features/documents/TopicPicker'
import { FormulaQuickAdd } from '@/features/formulas/FormulaQuickAdd'
import { RESULT_COLOR } from '@/features/exercises/ExerciseRow'
import { t } from '@/i18n'
import { cn, difficultyDots } from '@/lib/utils'

type Phase = 'setup' | 'session' | 'summary'
type Outcome = AttemptResult | 'skipped'

export function PracticePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { data: subjects } = useSubjects()
  const [subjectId, setSubjectId] = useState<string>(params.get('subject') ?? '')
  const { data: nodes = [] } = useSubjectNodes(subjectId ? Number(subjectId) : undefined)
  const [nodeIds, setNodeIds] = useState<number[]>(params.get('node') ? [Number(params.get('node'))] : [])
  const [minDiff, setMinDiff] = useState('')
  const [maxDiff, setMaxDiff] = useState('')
  const [unsolved, setUnsolved] = useState(false)
  const [count, setCount] = useState('10')
  const [mode, setMode] = useState<PracticeRequest['mode']>((params.get('mode') as PracticeRequest['mode']) || 'random')
  const [available, setAvailable] = useState<number | null>(null)
  const [queue, setQueue] = useState<number[]>([])
  const [phase, setPhase] = useState<Phase>('setup')
  const [loading, setLoading] = useState(false)
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({})
  const [index, setIndex] = useState(0)
  const startedAt = useRef<number>(0)

  // default subject: first one
  useEffect(() => {
    if (!subjectId && subjects?.length && !params.get('subject')) setSubjectId(String(subjects[0].id))
  }, [subjects, subjectId, params])

  const request = useMemo<PracticeRequest>(
    () => ({
      subject_id: subjectId ? Number(subjectId) : null,
      node_ids: nodeIds.length ? nodeIds : null,
      difficulty_min: minDiff ? Number(minDiff) : null,
      difficulty_max: maxDiff ? Number(maxDiff) : null,
      unsolved_only: unsolved,
      limit: Math.min(100, Math.max(1, Number(count) || 10)),
      mode,
    }),
    [subjectId, nodeIds, minDiff, maxDiff, unsolved, count, mode],
  )

  // live "N exercises match"
  useEffect(() => {
    if (phase !== 'setup') return
    const handle = setTimeout(() => fetchPracticeQueue({ ...request, limit: 1 }).then((q) => setAvailable(q.total_available)).catch(() => setAvailable(null)), 300)
    return () => clearTimeout(handle)
  }, [request, phase])

  const start = async () => {
    setLoading(true)
    try {
      const q = await fetchPracticeQueue(request)
      if (q.exercise_ids.length === 0) return
      setQueue(q.exercise_ids)
      setOutcomes({})
      setIndex(0)
      startedAt.current = Date.now()
      setPhase('session')
    } finally {
      setLoading(false)
    }
  }

  const autostart = params.get('autostart') === '1'
  useEffect(() => {
    if (autostart && phase === 'setup' && available !== null && available > 0 && queue.length === 0) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, available])

  if (phase === 'session') {
    return (
      <Session
        queue={queue}
        index={index}
        outcomes={outcomes}
        onOutcome={(id, o) => setOutcomes((prev) => ({ ...prev, [id]: o }))}
        onIndex={setIndex}
        onFinish={() => setPhase('summary')}
        onQuit={() => setPhase('setup')}
      />
    )
  }
  if (phase === 'summary') {
    return (
      <Summary
        queue={queue}
        outcomes={outcomes}
        seconds={Math.round((Date.now() - startedAt.current) / 1000)}
        onAgain={() => setPhase('setup')}
        onBack={() => navigate(subjectId ? `/subjects/${subjectId}` : '/')}
      />
    )
  }

  return (
    <>
      <PageHeader title={t('practice.setupTitle')} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 md:px-6">
        <div className="space-y-5 rounded-xl border bg-bg-elevated p-5 shadow-card">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('practice.subject')}>
              <Select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setNodeIds([]) }}>
                <option value="">{t('common.all')}</option>
                {subjects?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label={t('practice.mode')} hint={mode === 'exam' ? t('practice.examHint') : undefined}>
              <Select value={mode} onChange={(e) => setMode(e.target.value as PracticeRequest['mode'])}>
                <option value="random">{t('practice.random')}</option>
                <option value="exam">{t('practice.exam')}</option>
                <option value="sequential">{t('practice.sequential')}</option>
              </Select>
            </Field>
          </div>
          {subjectId && (
            <Field label={t('practice.topics')} hint={nodeIds.length === 0 ? t('practice.allTopics') : undefined}>
              <TopicPicker nodes={nodes} value={nodeIds} onChange={setNodeIds} />
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label={`${t('practice.difficulty')} min`}>
              <Select value={minDiff} onChange={(e) => setMinDiff(e.target.value)}>
                <option value="">{t('practice.any')}</option>
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label={`${t('practice.difficulty')} max`}>
              <Select value={maxDiff} onChange={(e) => setMaxDiff(e.target.value)}>
                <option value="">{t('practice.any')}</option>
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label={t('practice.count')}>
              <Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
          </div>
          <Checkbox checked={unsolved} onCheckedChange={setUnsolved} label={t('practice.unsolvedOnly')} />
          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <span className={cn('text-sm', available === 0 ? 'text-red-600 dark:text-red-400' : 'text-fg-muted')}>
              {available === null ? '…' : available === 0 ? t('practice.none') : t('practice.available', { n: available })}
            </span>
            <Button variant="primary" size="lg" onClick={start} disabled={loading || !available}>
              {loading ? <Spinner /> : mode === 'exam' ? <Shuffle className="h-4 w-4" /> : <Play className="h-4 w-4" />} {t('practice.start')}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-fg-subtle">{t('practice.shortcuts')}</p>
      </main>
    </>
  )
}

function Session({ queue, index, outcomes, onOutcome, onIndex, onFinish, onQuit }: { queue: number[]; index: number; outcomes: Record<number, Outcome>; onOutcome: (id: number, o: Outcome) => void; onIndex: (i: number) => void; onFinish: () => void; onQuit: () => void }) {
  const exerciseId = queue[index]
  const { data: exercise, isLoading } = useExercise(exerciseId)
  const addAttempt = useAddAttempt()
  const [hintsShown, setHintsShown] = useState(0)
  const [showSolution, setShowSolution] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    setHintsShown(0)
    setShowSolution(false)
    startRef.current = Date.now()
    setElapsed(0)
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - startRef.current) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [exerciseId])

  const next = useCallback(() => {
    if (index + 1 < queue.length) onIndex(index + 1)
    else onFinish()
  }, [index, queue.length, onIndex, onFinish])

  const log = useCallback(
    (result: AttemptResult) => {
      if (!exercise || outcomes[exercise.id]) return
      onOutcome(exercise.id, result)
      addAttempt.mutate({ exerciseId: exercise.id, body: { result, notes: '', answer: '', duration_seconds: Math.round((Date.now() - startRef.current) / 1000) } })
    },
    [exercise, outcomes, onOutcome, addAttempt],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select')) return
      const totalHints = (exercise?.hints.length ?? 0)
      if (e.key === 'h' && hintsShown < totalHints) setHintsShown((h) => h + 1)
      else if (e.key === 's' && (exercise?.solution || exercise?.parts.some((p) => p.solution))) setShowSolution((v) => !v)
      else if (e.key === '1') log('solved')
      else if (e.key === '2') log('partial')
      else if (e.key === '3') log('failed')
      else if (e.key === 'n' || e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exercise, hintsShown, log, next])

  const outcome = exercise ? outcomes[exercise.id] : undefined
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <Button variant="ghost" size="icon-sm" onClick={onQuit} aria-label={t('common.back')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums">{t('practice.progress', { i: index + 1, n: queue.length })}</span>
          <ProgressBar value={(100 * (index + (outcome ? 1 : 0))) / queue.length} className="flex-1" />
          <span className="inline-flex items-center gap-1 font-mono text-sm text-fg-muted tabular-nums">
            <Timer className="h-3.5 w-3.5" /> {mm}:{ss}
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {isLoading || !exercise ? (
          <div className="flex justify-center py-20 text-fg-muted"><Spinner className="h-5 w-5" /></div>
        ) : (
          <article className="space-y-5 animate-rise" key={exercise.id}>
            <header>
              <h1 className="text-lg font-semibold tracking-tight">
                {exercise.number && <span className="mr-2 font-mono text-fg-muted">{exercise.number}</span>}
                {exercise.title}
              </h1>
              <p className="mt-1 flex flex-wrap gap-1.5 text-xs text-fg-muted">
                {exercise.source_label && <span>{exercise.source_label}</span>}
                {exercise.difficulty && <Badge>{difficultyDots(exercise.difficulty)}</Badge>}
                {exercise.node_keys.map((k) => <Badge key={k} className="font-mono">{k}</Badge>)}
              </p>
            </header>
            <ExerciseContent exercise={exercise} hintsShown={hintsShown} onHint={() => setHintsShown(hintsShown + 1)} showSolution={showSolution} onToggleSolution={() => setShowSolution(!showSolution)} onAddFormula={() => setFormulaOpen(true)} />
            <FormulaQuickAdd exercise={exercise} open={formulaOpen} onOpenChange={setFormulaOpen} />

            <section className="rounded-xl border bg-bg-sunken/40 p-4">
              {outcome ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-medium">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: outcome === 'skipped' ? 'var(--fg-subtle)' : RESULT_COLOR[outcome] }} />
                    {t(`practice.${outcome}`)}
                  </span>
                  <Button variant="primary" onClick={next} autoFocus>
                    {index + 1 < queue.length ? t('practice.next') : t('practice.finish')} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  {(['solved', 'partial', 'failed'] as AttemptResult[]).map((r, i) => (
                    <Button key={r} variant="outline" onClick={() => log(r)} className="justify-between gap-2" style={{ borderColor: `color-mix(in oklab, ${RESULT_COLOR[r]} 50%, transparent)` }}>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: RESULT_COLOR[r] }} />
                        {t(`exercise.${r}`)}
                      </span>
                      <Kbd>{i + 1}</Kbd>
                    </Button>
                  ))}
                  <Button variant="ghost" onClick={() => { onOutcome(exercise.id, 'skipped'); next() }}>
                    <SkipForward className="h-4 w-4" /> {t('practice.skip')}
                  </Button>
                </div>
              )}
            </section>
          </article>
        )}
      </main>
    </div>
  )
}

function ExerciseContent({ exercise, hintsShown, onHint, showSolution, onToggleSolution, onAddFormula }: { exercise: Exercise; hintsShown: number; onHint: () => void; showSolution: boolean; onToggleSolution: () => void; onAddFormula: () => void }) {
  const figureFor = (partId: number | null) => exercise.figures.filter((f) => f.part_id === partId)
  return (
    <>
      {exercise.statement && <Markdown className="text-base">{exercise.statement}</Markdown>}
      {figureFor(null).map((f) => (
        <figure key={f.id} className="overflow-hidden rounded-lg border bg-white">
          <img src={f.url} alt={f.caption} className="mx-auto max-h-96 object-contain" />
          {f.caption && <figcaption className="border-t bg-bg-elevated px-3 py-1.5 text-xs text-fg-muted">{f.caption}</figcaption>}
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
                  {figureFor(p.id).map((f) => <img key={f.id} src={f.url} alt={f.caption} className="max-h-72 rounded-md border bg-white object-contain" />)}
                  {showSolution && p.solution && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-sm"><Markdown>{p.solution}</Markdown></div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {exercise.hints.length > 0 && hintsShown < exercise.hints.length && (
          <Button size="sm" variant="outline" onClick={onHint}>
            <Lightbulb className="h-3.5 w-3.5" /> {t('exercise.hint')} ({hintsShown + 1}/{exercise.hints.length}) <Kbd>H</Kbd>
          </Button>
        )}
        {(exercise.solution || exercise.parts.some((p) => p.solution)) && (
          <Button size="sm" variant={showSolution ? 'secondary' : 'outline'} onClick={onToggleSolution}>
            {showSolution ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {showSolution ? t('exercise.hideSolution') : t('exercise.solution')} <Kbd>S</Kbd>
          </Button>
        )}
        {showSolution && exercise.nodes.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onAddFormula} className="animate-rise">
            <Sigma className="h-3.5 w-3.5" /> {t('formulas.addTo')}
          </Button>
        )}
      </div>
      {exercise.hints.slice(0, hintsShown).map((h, i) => (
        <div key={i} className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm animate-rise">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <Markdown>{h}</Markdown>
        </div>
      ))}
      {showSolution && exercise.solution && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 animate-rise">
          <Markdown>{exercise.solution}</Markdown>
        </div>
      )}
    </>
  )
}

function Summary({ queue, outcomes, seconds, onAgain, onBack }: { queue: number[]; outcomes: Record<number, Outcome>; seconds: number; onAgain: () => void; onBack: () => void }) {
  const counts = { solved: 0, partial: 0, failed: 0, skipped: 0 }
  for (const id of queue) counts[outcomes[id] ?? 'skipped'] += 1
  const mins = Math.floor(seconds / 60)
  return (
    <>
      <PageHeader title={t('practice.summary')} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <div className="rounded-xl border bg-bg-elevated p-6 text-center shadow-card">
          <Flag className="mx-auto h-8 w-8 text-accent" />
          <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
            {counts.solved}<span className="text-base font-normal text-fg-muted"> / {queue.length} {t('practice.solved').toLowerCase()}</span>
          </p>
          <div className="mx-auto mt-4 flex h-2.5 max-w-sm overflow-hidden rounded-full bg-line">
            {(['solved', 'partial', 'failed'] as const).map((k) => (
              <div key={k} style={{ width: `${(100 * counts[k]) / queue.length}%`, background: RESULT_COLOR[k] }} />
            ))}
          </div>
          <dl className="mt-5 grid grid-cols-4 gap-2 text-sm">
            {(['solved', 'partial', 'failed', 'skipped'] as const).map((k) => (
              <div key={k} className="rounded-lg bg-bg-sunken/60 p-2">
                <dt className="text-[11px] text-fg-muted uppercase">{t(`practice.${k}`)}</dt>
                <dd className="text-lg font-semibold tabular-nums">{counts[k]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-fg-muted">
            {t('practice.totalTime')}: {mins} {t('common.minutes')} {seconds % 60}s
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="outline" onClick={onBack}>
              <Check className="h-4 w-4" /> {t('practice.back')}
            </Button>
            <Button variant="primary" onClick={onAgain}>
              <RotateCcw className="h-4 w-4" /> {t('practice.again')}
            </Button>
          </div>
        </div>
        <p className="mt-4 text-center">
          <Link to="/" className="text-sm text-accent hover:underline">{t('nav.home')}</Link>
        </p>
      </main>
    </>
  )
}
