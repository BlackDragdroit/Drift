import { ArrowLeft, CalendarClock, CalendarDays, Download, ListTree, MoreHorizontal, Pencil, Sigma, Trash2, Upload, Waypoints } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { useDeletePlan, usePlan, useSetStatus } from '@/api/hooks'
import { exportUrl } from '@/api/hooks'
import type { Status } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Badge, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, ProgressBar, Spinner } from '@/components/ui/misc'
import { FormulaSheet } from '@/features/formulas/FormulaSheet'
import { ImportDialog } from '@/features/plans/ImportDialog'
import { NodePanel } from '@/features/plans/NodePanel'
import { OutlineView } from '@/features/plans/OutlineView'
import { PlanEditDialog } from '@/features/plans/PlanEditDialog'
import { ScheduleView } from '@/features/plans/ScheduleView'
import { t } from '@/i18n'
import { useIsMobile } from '@/lib/useMediaQuery'
import { cn, daysUntil, downloadJson, formatDate, formatMinutes } from '@/lib/utils'

type View = 'map' | 'outline' | 'schedule' | 'formulas'

const MindMap = lazy(() => import('@/features/plans/MindMap').then((m) => ({ default: m.MindMap })))

const Centered = ({ children }: { children: React.ReactNode }) => <div className="flex h-full items-center justify-center text-fg-muted">{children}</div>

export function PlanPage() {
  const params = useParams()
  const planId = Number(params.planId)
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: plan, isLoading } = usePlan(planId)
  const setStatus = useSetStatus(planId)
  const del = useDeletePlan()
  const [editOpen, setEditOpen] = useState(false)
  const [reimportOpen, setReimportOpen] = useState(false)

  const view: View = params.view === 'outline' ? 'outline' : params.view === 'schedule' ? 'schedule' : params.view === 'formulas' ? 'formulas' : params.view === 'map' ? 'map' : isMobile ? 'outline' : 'map'
  const selectedId = searchParams.get('node') ? Number(searchParams.get('node')) : null

  const select = useCallback(
    (id: number | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (id === null) next.delete('node')
          else next.set('node', String(id))
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const onSetStatus = useCallback((nodeId: number, status: Status) => setStatus.mutate({ nodeId, status }), [setStatus])

  // Escape closes the panel; m / o / s / f switch views (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId !== null) return select(null)
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      const views: Record<string, View> = { m: 'map', o: 'outline', s: 'schedule', f: 'formulas' }
      if (views[e.key]) navigate(`/plans/${planId}/${views[e.key]}${selectedId ? `?node=${selectedId}` : ''}`, { replace: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, select, navigate, planId])

  if (isLoading || !plan) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-muted">
        {isLoading ? <Spinner className="h-5 w-5" /> : t('errors.notFound')}
      </div>
    )
  }

  const days = plan.exam_date ? daysUntil(plan.exam_date) : null
  const remaining = plan.progress.minutes_total - plan.progress.minutes_done

  const onDelete = () => {
    if (confirm(t('common.confirmDelete', { name: plan.title }))) del.mutate(plan.id, { onSuccess: () => navigate(`/subjects/${plan.subject_id}`) })
  }

  const tab = (v: View, icon: React.ReactNode, label: string) => (
    <Link
      to={`/plans/${plan.id}/${v}${selectedId ? `?node=${selectedId}` : ''}`}
      replace
      className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors md:px-3', view === v ? 'bg-bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg')}
    >
      {icon}
      {label}
    </Link>
  )

  return (
    <div className="flex h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))] flex-col md:h-dvh">
      <header className="z-20 border-b bg-bg/85 backdrop-blur print:hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 md:px-5">
          <Button variant="ghost" size="icon-sm" asChild className="-ml-1 shrink-0">
            <Link to={`/subjects/${plan.subject_id}`} aria-label={t('common.back')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: plan.subject_color }} />
              <h1 className="truncate text-base leading-tight font-semibold tracking-tight md:text-lg">{plan.title}</h1>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-muted md:text-xs">
              <span className="truncate">{plan.subject_name}</span>
              <span>·</span>
              <span className="tabular-nums">{t('plan.progress', { done: plan.progress.nodes_done, total: plan.progress.nodes_total })}</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden tabular-nums sm:inline">{t('plan.remaining', { time: formatMinutes(remaining) })}</span>
              {plan.progress.ready_count > 0 && (
                <>
                  <span className="hidden sm:inline">·</span>
                  <span className="hidden font-medium sm:inline" style={{ color: plan.subject_color }}>
                    {t('plan.readyCount', { n: plan.progress.ready_count })}
                  </span>
                </>
              )}
            </div>
          </div>
          {plan.exam_date && days !== null && (
            <button onClick={() => setEditOpen(true)} className="hidden sm:block">
              <Badge color={days <= 7 && days >= 0 ? '#ef4444' : plan.subject_color}>
                <CalendarClock className="h-3 w-3" />
                {days >= 0 ? t('dashboard.daysLeft', { n: days }) : formatDate(plan.exam_date)}
              </Badge>
            </button>
          )}
          <div className="hidden items-center rounded-lg bg-bg-sunken p-0.5 md:flex">
            {tab('map', <Waypoints className="h-4 w-4" />, t('plan.map'))}
            {tab('outline', <ListTree className="h-4 w-4" />, t('plan.outline'))}
            {tab('schedule', <CalendarDays className="h-4 w-4" />, t('plan.schedule'))}
            {tab('formulas', <Sigma className="h-4 w-4" />, t('formulas.tab'))}
          </div>
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.more')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownTrigger>
            <DropdownContent>
              <DropdownItem onSelect={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> {t('plan.edit')}
              </DropdownItem>
              <DropdownItem onSelect={() => setReimportOpen(true)}>
                <Upload className="h-4 w-4" /> {t('plan.reimport')}
              </DropdownItem>
              <DropdownSeparator />
              <DropdownLabel>{t('plan.export')}</DropdownLabel>
              <DropdownItem onSelect={() => downloadJson(exportUrl(plan.id, true), `${plan.key}.json`)}>
                <Download className="h-4 w-4" /> {t('plan.exportWithProgress')}
              </DropdownItem>
              <DropdownItem onSelect={() => downloadJson(exportUrl(plan.id, false), `${plan.key}.json`)}>
                <Download className="h-4 w-4" /> {t('plan.exportClean')}
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem danger onSelect={onDelete}>
                <Trash2 className="h-4 w-4" /> {t('plan.delete')}
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
        <ProgressBar value={plan.progress.percent} color={plan.subject_color} height="h-[3px]" className="rounded-none" />
        <div className="scrollbar-none flex items-center gap-1 overflow-x-auto border-t bg-bg-sunken/60 px-2 py-1 md:hidden">
          {tab('map', <Waypoints className="h-4 w-4" />, t('plan.map'))}
          {tab('outline', <ListTree className="h-4 w-4" />, t('plan.outline'))}
          {tab('schedule', <CalendarDays className="h-4 w-4" />, t('plan.schedule'))}
          {tab('formulas', <Sigma className="h-4 w-4" />, t('formulas.tab'))}
        </div>
      </header>

      <div className={cn('relative min-h-0 flex-1', view !== 'map' && 'scrollbar-thin overflow-y-auto')}>
        {view === 'map' ? (
          <Suspense fallback={<Centered><Spinner className="h-5 w-5" /></Centered>}>
            <MindMap plan={plan} selectedId={selectedId} onSelect={select} onSetStatus={onSetStatus} />
          </Suspense>
        ) : view === 'schedule' ? (
          <ScheduleView plan={plan} selectedId={selectedId} onSelect={select} onSetStatus={onSetStatus} onEditPlan={() => setEditOpen(true)} />
        ) : view === 'formulas' ? (
          <FormulaSheet plan={plan} onSelect={select} />
        ) : (
          <OutlineView plan={plan} selectedId={selectedId} onSelect={select} onSetStatus={onSetStatus} />
        )}
      </div>

      <NodePanel plan={plan} nodeId={selectedId} onClose={() => select(null)} onSelect={select} onSetStatus={onSetStatus} />
      <PlanEditDialog open={editOpen} onOpenChange={setEditOpen} plan={plan} />
      <ImportDialog open={reimportOpen} onOpenChange={setReimportOpen} subjectId={plan.subject_id} planId={plan.id} planTitle={plan.title} />
    </div>
  )
}
