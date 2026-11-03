import { ArrowLeft, ChevronLeft, ChevronRight, ListTree, Waypoints } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useNode, usePlan, useSetStatus } from '@/api/hooks'
import type { Status } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { treeOrder } from '@/features/plans/graph'
import { PanelBody } from '@/features/plans/NodePanel'
import { t } from '@/i18n'

/** Full-page view of a single topic: for actually working on it rather than browsing the map. */
export function TopicPage() {
  const params = useParams()
  const planId = Number(params.planId)
  const nodeId = Number(params.nodeId)
  const navigate = useNavigate()
  const { data: plan, isLoading } = usePlan(planId)
  const { data: node } = useNode(Number.isFinite(nodeId) ? nodeId : null)
  const setStatus = useSetStatus(planId)

  const order = useMemo(() => (plan ? treeOrder(plan.nodes).map((r) => r.node) : []), [plan])
  const index = order.findIndex((n) => n.id === nodeId)
  const prev = index > 0 ? order[index - 1] : null
  const next = index >= 0 && index + 1 < order.length ? order[index + 1] : null

  const go = useCallback((id: number) => navigate(`/plans/${planId}/topic/${id}`), [navigate, planId])
  const onSetStatus = useCallback((id: number, status: Status) => setStatus.mutate({ nodeId: id, status }), [setStatus])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (e.key === 'Escape') navigate(`/plans/${planId}?node=${nodeId}`)
      if (e.key === '[' && prev) go(prev.id)
      if (e.key === ']' && next) go(next.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, planId, nodeId, prev, next, go])

  if (isLoading || !plan) {
    return <div className="flex flex-1 items-center justify-center text-fg-muted">{isLoading ? <Spinner className="h-5 w-5" /> : t('errors.notFound')}</div>
  }
  const summary = plan.nodes.find((n) => n.id === nodeId)

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-3 py-2.5 md:px-6">
          <Button variant="ghost" size="icon-sm" asChild className="-ml-1 shrink-0" aria-label={t('node.backToPlan')}>
            <Link to={`/plans/${plan.id}?node=${nodeId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-xs text-fg-muted">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: plan.subject_color }} />
              <span className="truncate">{plan.subject_name} · {plan.title}</span>
            </p>
            <p className="truncate text-sm font-medium">{summary?.title ?? node?.title ?? ''}</p>
          </div>
          <span className="hidden text-xs text-fg-subtle tabular-nums sm:inline">{index + 1} / {order.length}</span>
          <Button variant="ghost" size="icon-sm" disabled={!prev} onClick={() => prev && go(prev.id)} aria-label={t('node.prevTopic')} title={`${t('node.prevTopic')} [`}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={!next} onClick={() => next && go(next.id)} aria-label={t('node.nextTopic')} title={`${t('node.nextTopic')} ]`}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to={`/plans/${plan.id}/map?node=${nodeId}`}><Waypoints className="h-4 w-4" /> {t('plan.map')}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
            <Link to={`/plans/${plan.id}/outline?node=${nodeId}`}><ListTree className="h-4 w-4" /> {t('plan.outline')}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-6">
        {!node || !summary ? (
          <div className="flex justify-center py-20 text-fg-muted"><Spinner className="h-5 w-5" /></div>
        ) : (
          <div className="[&_.prose-md]:text-base">
            <PanelBody key={node.id} node={{ ...node, ...summary, note: node.note }} plan={plan} onSelect={go} onSetStatus={onSetStatus} wide />
          </div>
        )}
      </main>
    </div>
  )
}
