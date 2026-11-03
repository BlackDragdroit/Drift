import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Settings2 } from 'lucide-react'
import { useMemo } from 'react'

import { useSchedule, type ScheduleDay } from '@/api/learning'
import type { PlanDetail, Status } from '@/api/types'
import { StatusIcon } from '@/components/StatusControl'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, ProgressBar, Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn, formatDate, formatMinutes, nextStatus } from '@/lib/utils'

interface Props {
  plan: PlanDetail
  selectedId: number | null
  onSelect: (id: number | null) => void
  onSetStatus: (id: number, status: Status) => void
  onEditPlan: () => void
}

export function ScheduleView({ plan, selectedId, onSelect, onSetStatus, onEditPlan }: Props) {
  const { data, isLoading } = useSchedule(plan.id)
  const todayIso = new Date().toISOString().slice(0, 10)

  const groups = useMemo(() => {
    if (!data) return []
    const today = new Date(`${todayIso}T00:00:00`)
    const week = new Date(today)
    week.setDate(week.getDate() + 7)
    const buckets: { key: string; label: string; days: ScheduleDay[] }[] = [
      { key: 'today', label: t('schedule.today'), days: [] },
      { key: 'tomorrow', label: t('schedule.tomorrow'), days: [] },
      { key: 'week', label: t('schedule.thisWeek'), days: [] },
      { key: 'later', label: t('schedule.later'), days: [] },
    ]
    for (const d of data.days) {
      const date = new Date(`${d.date}T00:00:00`)
      const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000)
      const bucket = diff <= 0 ? 0 : diff === 1 ? 1 : date < week ? 2 : 3
      buckets[bucket].days.push(d)
    }
    return buckets.filter((b) => b.days.length > 0)
  }, [data, todayIso])

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-20 text-fg-muted">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }
  const s = data.summary
  const maxMinutes = Math.max(s.needed_per_day, s.capacity_minutes, ...data.days.map((d) => d.minutes), 1)

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 md:px-6">
      <section className="rounded-xl border bg-bg-elevated p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {s.exam_date ? (
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="h-4 w-4" style={{ color: plan.subject_color }} />
                {plan.exam_name || t('plan.exam')} · {formatDate(s.exam_date, { weekday: 'short', day: 'numeric', month: 'short' })}
                <Badge color={s.days_left !== null && s.days_left <= 7 ? '#ef4444' : plan.subject_color}>{t('schedule.daysLeft', { n: s.days_left ?? 0 })}</Badge>
              </p>
            ) : (
              <p className="text-sm font-semibold text-fg-muted">{t('schedule.noExam')}</p>
            )}
            <p className="mt-1 text-xs text-fg-muted">
              {t('schedule.remaining', { time: formatMinutes(s.remaining_minutes), n: s.remaining_nodes })}
              {s.exam_date && ` · ${t('schedule.studyDays', { n: s.study_days })}`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onEditPlan}>
            <Settings2 className="h-3.5 w-3.5" /> {s.exam_date ? t('schedule.editCapacity') : t('plan.setExam')}
          </Button>
        </div>

        {s.remaining_nodes === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> {t('schedule.allDone')}
          </p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Meter label={t('schedule.perDay', { time: formatMinutes(s.needed_per_day) })} value={s.needed_per_day} max={maxMinutes} color={s.behind ? '#ef4444' : plan.subject_color} />
              <Meter label={t('schedule.capacity', { time: formatMinutes(s.capacity_minutes) })} value={s.capacity_minutes} max={maxMinutes} color="var(--fg-subtle)" />
            </div>
            <p className={cn('mt-3 flex items-start gap-2 text-sm', s.behind ? 'text-red-600 dark:text-red-400' : 'text-fg-muted')}>
              {s.behind ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Clock className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                {s.behind
                  ? t('schedule.behind', { needed: formatMinutes(s.needed_per_day), capacity: formatMinutes(s.capacity_minutes) })
                  : s.exam_date
                    ? t('schedule.onTrack', { date: formatDate(s.finish_date), time: formatMinutes(s.needed_per_day) })
                    : t('schedule.finishBy', { time: formatMinutes(s.capacity_minutes), date: formatDate(s.finish_date) })}
              </span>
            </p>
          </>
        )}
      </section>

      {!s.exam_date && s.remaining_nodes > 0 && <p className="mt-3 text-xs text-fg-subtle">{t('schedule.noExamHint')}</p>}

      {groups.length === 0 && s.remaining_nodes === 0 && <EmptyState title={t('schedule.allDone')} />}

      {groups.map((g) => (
        <section key={g.key} className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">{g.label}</h2>
          <div className="space-y-3">
            {g.days.map((d) => (
              <div key={d.date} className={cn('overflow-hidden rounded-xl border bg-bg-elevated shadow-card', d.date === todayIso && 'border-accent/60')}>
                <div className="flex items-center justify-between border-b bg-bg-sunken/40 px-3 py-1.5 text-xs">
                  <span className={cn('font-medium', d.date === todayIso && 'text-accent')}>{formatDate(d.date, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                  <span className="text-fg-muted tabular-nums">{formatMinutes(d.minutes)}</span>
                </div>
                <ul>
                  {d.nodes.map((n) => (
                    <li key={n.node_id} className={cn('flex items-center gap-2 border-b pr-3 last:border-b-0 hover:bg-bg-sunken/60', selectedId === n.node_id && 'bg-accent/5')}>
                      <button
                        className="flex h-10 w-10 shrink-0 items-center justify-center transition-transform hover:scale-110"
                        onClick={() => onSetStatus(n.node_id, nextStatus(n.status))}
                        aria-label={t('schedule.tick')}
                        title={t(`status.${n.status}`)}
                      >
                        <StatusIcon status={n.status} className="h-[18px] w-[18px]" />
                      </button>
                      <button className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left" onClick={() => onSelect(n.node_id)}>
                        <span className="truncate text-sm">{n.title}</span>
                        {n.ready && n.status === 'not_started' && (
                          <span className="hidden shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold tracking-wide uppercase sm:inline" style={{ color: plan.subject_color, background: `color-mix(in oklab, ${plan.subject_color} 12%, transparent)` }}>
                            {t('status.ready')}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-[11px] text-fg-subtle tabular-nums">{formatMinutes(n.minutes)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Meter({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <p className="mb-1 text-xs text-fg-muted">{label}</p>
      <ProgressBar value={(100 * value) / max} color={color} height="h-2" />
    </div>
  )
}
