import { ArrowLeft, Check, Layers, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { useDueCards, useReviewCard, type FlashcardDetail } from '@/api/phase4'
import { PageHeader } from '@/components/layout/AppShell'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, Kbd, ProgressBar, Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const RATINGS: { rating: 1 | 2 | 3 | 4; label: () => string; color: string }[] = [
  { rating: 1, label: () => t('cards.again'), color: '#ef4444' },
  { rating: 2, label: () => t('cards.hard'), color: '#f59e0b' },
  { rating: 3, label: () => t('cards.good'), color: '#10b981' },
  { rating: 4, label: () => t('cards.easy'), color: '#0ea5e9' },
]

export function ReviewCardsPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const scope = {
    subject_id: params.get('subject') ? Number(params.get('subject')) : undefined,
    plan_id: params.get('plan') ? Number(params.get('plan')) : undefined,
    node_id: params.get('node') ? Number(params.get('node')) : undefined,
  }
  const { data, isLoading, refetch } = useDueCards(scope)
  const review = useReviewCard()
  const [queue, setQueue] = useState<FlashcardDetail[] | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const shownAt = useRef(Date.now())

  useEffect(() => {
    if (data && queue === null) setQueue(data.cards)
  }, [data, queue])

  const card = queue?.[0] ?? null

  const rate = useCallback(
    (rating: 1 | 2 | 3 | 4) => {
      if (!card || review.isPending) return
      review.mutate({ id: card.id, rating, duration_ms: Date.now() - shownAt.current })
      setQueue((q) => (q ? q.slice(1) : q))
      setReviewed((n) => n + 1)
      setFlipped(false)
      shownAt.current = Date.now()
    },
    [card, review],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, textarea, select')) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key) as 1 | 2 | 3 | 4)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, rate])

  const total = (queue?.length ?? 0) + reviewed

  return (
    <>
      <PageHeader
        title={t('cards.review')}
        subtitle={data ? `${t('cards.due', { n: data.due })} · ${t('cards.new', { n: data.new })} · ${t('cards.total', { n: data.total })}` : undefined}
        back={
          <Button variant="ghost" size="icon-sm" onClick={() => navigate(-1)} aria-label={t('common.back')} className="-ml-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6">
        {isLoading || queue === null ? (
          <div className="flex justify-center py-20 text-fg-muted"><Spinner className="h-5 w-5" /></div>
        ) : !card ? (
          <EmptyState
            icon={reviewed > 0 ? <Check className="h-8 w-8 text-emerald-500" /> : <Layers className="h-8 w-8" />}
            title={reviewed > 0 ? t('cards.done') : t('cards.nothingDue')}
            hint={reviewed > 0 ? t('cards.reviewed', { n: reviewed }) : t('cards.nothingDueHint')}
            action={
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setQueue(null); setReviewed(0); refetch() }}>
                  <RotateCcw className="h-4 w-4" /> {t('common.retry')}
                </Button>
                <Button variant="primary" asChild><Link to="/">{t('nav.home')}</Link></Button>
              </div>
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium tabular-nums">{reviewed + 1} / {total}</span>
              <ProgressBar value={(100 * reviewed) / Math.max(total, 1)} className="flex-1" />
            </div>
            <article
              key={card.id}
              onClick={() => setFlipped(true)}
              className={cn('min-h-[260px] cursor-pointer rounded-2xl border bg-bg-elevated p-6 shadow-card transition-colors animate-rise', flipped && 'cursor-default')}
              style={{ borderTopColor: card.subject_color ?? undefined, borderTopWidth: 3 }}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                {card.node_title && <span>{card.node_title}</span>}
                <Badge>{t(`cards.source.${card.source as 'plan' | 'manual' | 'generated'}`)}</Badge>
                {card.retrievability !== null && card.retrievability !== undefined && <Badge>{t('cards.retrievability', { p: Math.round(card.retrievability * 100) })}</Badge>}
              </div>
              <div className="text-lg"><Markdown>{card.front}</Markdown></div>
              {flipped && (
                <div className="mt-5 border-t pt-5 text-base animate-rise">
                  <Markdown>{card.back}</Markdown>
                </div>
              )}
            </article>
            {!flipped ? (
              <Button variant="primary" size="lg" className="w-full" onClick={() => setFlipped(true)}>
                {t('cards.showAnswer')} <Kbd>Space</Kbd>
              </Button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {RATINGS.map((r) => (
                  <Button key={r.rating} variant="outline" size="lg" onClick={() => rate(r.rating)} className="flex-col gap-0.5 py-6" style={{ borderColor: `color-mix(in oklab, ${r.color} 55%, transparent)` }}>
                    <span className="text-sm font-semibold" style={{ color: r.color }}>{r.label()}</span>
                    <span className="text-[11px] text-fg-subtle tabular-nums">{card.intervals?.[String(r.rating)] ?? ''}</span>
                  </Button>
                ))}
              </div>
            )}
            <p className="text-center text-xs text-fg-subtle">{t('cards.keys')}</p>
          </div>
        )}
      </main>
    </>
  )
}
