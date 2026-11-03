import { ArrowRight, CalendarClock, Plus, Sparkles, Upload } from 'lucide-react'
import { Link, useOutletContext } from 'react-router'

import { useDashboard } from '@/api/hooks'
import { PageHeader } from '@/components/layout/AppShell'
import { StatusDot } from '@/components/StatusControl'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, ProgressBar, Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn, difficultyDots, formatDate, formatMinutes } from '@/lib/utils'

import type { Status } from '@/api/types'

type DashboardNode = NonNullable<ReturnType<typeof useDashboard>['data']>['ready'][number]

export function DashboardPage() {
  const { data, isLoading } = useDashboard()
  const { openImport } = useOutletContext<{ openImport: () => void }>()
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={today}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/subjects">
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">{t('dashboard.newSubject')}</span>
              </Link>
            </Button>
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
              <Button variant="primary" onClick={openImport}>
                <Upload className="h-4 w-4" /> {t('dashboard.importPlan')}
              </Button>
            }
          />
        )}
        {data && data.subjects_count > 0 && (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-8">
              {data.in_progress.length > 0 && (
                <Section title={t('dashboard.inProgress')} count={data.in_progress.length}>
                  <NodeList nodes={data.in_progress} />
                </Section>
              )}
              <Section title={t('dashboard.readyToLearn')} count={data.ready.length} empty={t('dashboard.nothingReady')}>
                {data.ready.length > 0 && <NodeList nodes={data.ready} ready />}
              </Section>
            </div>
            <aside className="space-y-6">
              <Section title={t('dashboard.upcomingExams')} count={data.exams.length}>
                <div className="space-y-2">
                  {data.exams.map((e) => (
                    <Link
                      key={e.plan_id}
                      to={`/plans/${e.plan_id}`}
                      className="block rounded-xl border bg-bg-elevated p-3.5 shadow-card transition-colors hover:border-line-strong"
                    >
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
                      <p className="mt-1.5 text-[11px] text-fg-subtle">{t('plan.remaining', { time: formatMinutes(e.minutes_remaining) })}</p>
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
                  {data.plans_count} {data.plans_count === 1 ? 'plan' : 'plans'} · {data.subjects_count} {data.subjects_count === 1 ? 'subject' : 'subjects'}
                </p>
              </div>
            </aside>
          </div>
        )}
      </main>
    </>
  )
}

function Section({ title, count, empty, children }: { title: string; count?: number; empty?: string; children: React.ReactNode }) {
  const isEmpty = count === 0
  return (
    <section>
      <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold tracking-tight">
        {title}
        {count !== undefined && count > 0 && <span className="rounded-full bg-bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-fg-muted tabular-nums">{count}</span>}
      </h2>
      {isEmpty && empty ? <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-fg-muted">{empty}</p> : children}
    </section>
  )
}

function NodeList({ nodes, ready }: { nodes: DashboardNode[]; ready?: boolean }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {nodes.map((n) => (
        <li key={n.node_id}>
          <Link
            to={`/plans/${n.plan_id}?node=${n.node_id}`}
            className={cn('group flex items-center gap-3 rounded-xl border bg-bg-elevated p-3 shadow-card transition-colors hover:border-line-strong')}
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
