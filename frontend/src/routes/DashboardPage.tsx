import { AlertTriangle, ArrowRight, CalendarClock, Flame, Layers, Plus, Sparkles, Target, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useOutletContext } from 'react-router'

import { useDashboardV2, type DashboardNode } from '@/api/learning'
import type { Status } from '@/api/types'
import { PageHeader } from '@/components/layout/AppShell'
import { StatusDot } from '@/components/StatusControl'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, ProgressBar, Spinner } from '@/components/ui/misc'
import { ExerciseDialog } from '@/features/exercises/ExerciseDialog'
import { RESULT_COLOR } from '@/features/exercises/ExerciseRow'
import { t } from '@/i18n'
import { cn, difficultyDots, formatDate, formatMinutes } from '@/lib/utils'

export function DashboardPage() {
  const { data, isLoading } = useDashboardV2()
  const { openImport } = useOutletContext<{ openImport: () => void }>()
  const [exerciseId, setExerciseId] = useState<number | null>(null)
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={today}
        actions={
          <>
            {data && data.exercises_total > 0 && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/practice?mode=exam&autostart=1">
                  <Sparkles className="h-4 w-4" /> <span className="hidden sm:inline">{t('dashboard2.quickPractice')}</span>
                </Link>
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={openImport}>
              <Upload className="h-4 w-4" /> {t('dashboard.importPlan')}
            </Button>
          </>
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
        {isLoading && (
          <div className="flex justify-center py-20 text-fg-muted">
            <Spinner className="h-5 w-5" />
          </div>
        )}
        {data && data.subjects_count === 0 && (
          <EmptyState
            icon={<Sparkles className="h-8 w-8" />}
            title={t('dashboard.empty')}
            hint={t('dashboard.emptyHint')}
            action={
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link to="/subjects"><Plus className="h-4 w-4" /> {t('dashboard.newSubject')}</Link>
                </Button>
                <Button variant="primary" onClick={openImport}>
                  <Upload className="h-4 w-4" /> {t('dashboard.importPlan')}
                </Button>
              </div>
            }
          />
        )}
        {data && data.subjects_count > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-8">
              {data.due_today.length > 0 && (
                <Section title={t('dashboard2.dueToday')} count={data.due_today.length}>
                  <NodeList nodes={data.due_today} />
                </Section>
              )}
              {data.in_progress.length > 0 && (
                <Section title={t('dashboard.inProgress')} count={data.in_progress.length}>
                  <NodeList nodes={data.in_progress} />
                </Section>
              )}
              <Section title={t('dashboard.readyToLearn')} count={data.ready.length} empty={data.due_today.length ? undefined : t('dashboard.nothingReady')}>
                {data.ready.length > 0 && <NodeList nodes={data.ready} ready />}
              </Section>

              {(data.weak_spots.length > 0 || data.retry_exercises.length > 0) && (
                <Section title={t('dashboard2.weakSpots')} count={data.weak_spots.length} hint={t('dashboard2.weakHint')}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <ul className="min-w-0 space-y-2">
                      {data.weak_spots.map((w) => (
                        <li key={w.node_id}>
                          <Link to={`/plans/${w.plan_id}?node=${w.node_id}`} className="flex items-center gap-3 rounded-xl border bg-bg-elevated p-3 shadow-card hover:border-line-strong" style={{ borderLeftColor: w.subject_color, borderLeftWidth: 3 }}>
                            <Target className="h-4 w-4 shrink-0 text-red-500" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{w.title}</span>
                              <span className="block truncate text-xs text-fg-muted">{w.subject_name} · {w.plan_title}</span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end text-[11px] tabular-nums">
                              <span className="font-semibold text-red-500">{Math.round(w.score * 100)}%</span>
                              <span className="text-fg-subtle">{w.failed}✗ {w.partial}½ / {w.attempts}</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                      {data.weak_spots.length === 0 && <li className="rounded-xl border border-dashed px-4 py-5 text-sm text-fg-muted">{t('dashboard2.noWeak')}</li>}
                    </ul>
                    {data.retry_exercises.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">{t('dashboard2.retry')}</p>
                        <ul className="divide-y rounded-xl border bg-bg-elevated shadow-card">
                          {data.retry_exercises.map((e) => (
                            <li key={e.id}>
                              <button onClick={() => setExerciseId(e.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-bg-sunken/60">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RESULT_COLOR[e.last_result] }} />
                                <span className="min-w-0 flex-1 truncate">
                                  {e.number && <span className="mr-1.5 font-mono text-xs text-fg-subtle">{e.number}</span>}
                                  {e.title}
                                </span>
                                <span className="shrink-0 text-[11px] text-fg-subtle">{e.subject_name}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Section>
              )}
            </div>

            <aside className="space-y-5">
              <StreakCard streak={data.streak} />
              {(data.flashcards_due > 0 || data.flashcards_new > 0) && (
                <Link to="/review" className="flex items-center gap-3 rounded-xl border bg-bg-elevated p-4 shadow-card transition-colors hover:border-line-strong">
                  <Layers className="h-5 w-5 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t('cards.reviewAll')}</span>
                    <span className="block text-xs text-fg-muted">{t('cards.due', { n: data.flashcards_due })} · {t('cards.new', { n: data.flashcards_new })}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-fg-subtle" />
                </Link>
              )}
              <Section title={t('dashboard.upcomingExams')} count={data.exams.length}>
                <div className="space-y-2">
                  {data.exams.map((e) => (
                    <Link key={e.plan_id} to={`/plans/${e.plan_id}/schedule`} className="block rounded-xl border bg-bg-elevated p-3.5 shadow-card transition-colors hover:border-line-strong">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{e.plan_title}</p>
                          <p className="truncate text-xs text-fg-muted">
                            {e.exam_name ? `${e.exam_name} · ` : ''}
                            {formatDate(e.exam_date)}
                          </p>
                        </div>
                        <Badge color={e.days_left <= 7 ? '#ef4444' : e.subject_color}>
                          <CalendarClock className="h-3 w-3" />
                          {e.days_left === 0 ? t('dashboard.examToday') : t('dashboard.daysLeft', { n: e.days_left })}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <ProgressBar value={e.percent} color={e.subject_color} className="flex-1" />
                        <span className="text-[11px] font-medium text-fg-muted tabular-nums">{Math.round(e.percent)}%</span>
                      </div>
                      <p className={cn('mt-1.5 flex items-center gap-1 text-[11px]', e.behind ? 'text-red-500' : 'text-fg-subtle')}>
                        {e.behind && <AlertTriangle className="h-3 w-3" />}
                        {t('plan.remaining', { time: formatMinutes(e.minutes_remaining) })} · {t('dashboard2.needPerDay', { time: formatMinutes(e.needed_per_day) })}
                        {e.behind && ` · ${t('dashboard2.behind')}`}
                      </p>
                    </Link>
                  ))}
                </div>
              </Section>
              <div className="rounded-xl border bg-bg-elevated p-4 text-sm shadow-card">
                <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">Overall</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
                  {data.nodes_done}
                  <span className="text-base font-normal text-fg-muted"> / {data.nodes_total}</span>
                </p>
                <ProgressBar value={data.nodes_total ? (100 * data.nodes_done) / data.nodes_total : 0} className="mt-2" />
                <p className="mt-2 text-xs text-fg-muted">
                  {data.plans_count} {data.plans_count === 1 ? 'plan' : 'plans'} · {data.subjects_count} {data.subjects_count === 1 ? 'subject' : 'subjects'} · {data.exercises_total} {t('subject.exercises').toLowerCase()}
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>
      <ExerciseDialog exerciseId={exerciseId} onClose={() => setExerciseId(null)} />
    </>
  )
}

function StreakCard({ streak }: { streak: { current: number; longest: number; active_today: boolean; minutes_today: number; days: string[] } }) {
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().slice(0, 10)
  })
  const active = new Set(streak.days)
  return (
    <div className="rounded-xl border bg-bg-elevated p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-fg-subtle uppercase">{t('dashboard2.streak')}</p>
        <span className="text-[11px] text-fg-subtle">{t('dashboard2.bestStreak', { n: streak.longest })}</span>
      </div>
      <div className="mt-1 flex items-end gap-3">
        <p className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight tabular-nums">
          <Flame className={cn('h-6 w-6', streak.current > 0 ? 'text-orange-500' : 'text-fg-subtle')} />
          {streak.current === 1 ? t('dashboard2.day') : t('dashboard2.days', { n: streak.current })}
        </p>
        <p className="pb-1 text-xs text-fg-muted">{formatMinutes(streak.minutes_today)} {t('dashboard2.minutesToday')}</p>
      </div>
      <div className="mt-3 flex gap-1">
        {last7.map((d) => (
          <span key={d} className={cn('h-2 flex-1 rounded-full', active.has(d) ? 'bg-orange-500' : 'bg-line')} title={d} />
        ))}
      </div>
    </div>
  )
}

function Section({ title, count, empty, hint, children }: { title: string; count?: number; empty?: string; hint?: string; children: React.ReactNode }) {
  const isEmpty = count === 0
  return (
    <section>
      <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold tracking-tight">
        {title}
        {count !== undefined && count > 0 && <span className="rounded-full bg-bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-fg-muted tabular-nums">{count}</span>}
        {hint && <span className="text-xs font-normal text-fg-subtle">· {hint}</span>}
      </h2>
      {isEmpty && empty ? <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-fg-muted">{empty}</p> : children}
    </section>
  )
}

function NodeList({ nodes, ready }: { nodes: DashboardNode[]; ready?: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {nodes.map((n) => (
        <li key={n.node_id} className="min-w-0">
          <Link
            to={`/plans/${n.plan_id}?node=${n.node_id}`}
            className="group flex items-center gap-3 rounded-xl border bg-bg-elevated p-3 shadow-card transition-colors hover:border-line-strong"
            style={{ borderLeftColor: n.subject_color, borderLeftWidth: 3 }}
          >
            <StatusDot status={n.status as Status} ready={ready} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{n.title}</p>
              <p className="truncate text-xs text-fg-muted">
                {n.subject_name} · {n.plan_title}
              </p>
            </div>
            <div className="hidden shrink-0 text-right text-[11px] text-fg-subtle tabular-nums sm:block">
              {n.estimated_minutes > 0 && <div>{formatMinutes(n.estimated_minutes)}</div>}
              {n.difficulty && <div className="tracking-tighter">{difficultyDots(n.difficulty)}</div>}
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
