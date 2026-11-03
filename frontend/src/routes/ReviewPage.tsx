import { AlertCircle, ArrowLeft, Check, Info, Loader2, Plus, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { cropFigure, saveDraft, useCommitJob, useJob, useSubjectNodes } from '@/api/documents'
import type { ExerciseDraft } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { JobStatusLine } from '@/features/documents/DocumentsSection'
import { DraftEditor } from '@/features/documents/DraftEditor'
import { emptyDraft, isEmptyDraft, mergeWithNext, move, splitBeforePart, splitStatementAt } from '@/features/documents/draftOps'
import { PageViewer, type Overlay } from '@/features/documents/PageViewer'
import { t } from '@/i18n'
import { useIsMobile } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'

export function ReviewPage() {
  const jobId = Number(useParams().jobId)
  const { data: job, isLoading } = useJob(jobId)
  const { data: nodes = [] } = useSubjectNodes(job?.document.subject_id)
  const commit = useCommitJob()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  const [drafts, setDrafts] = useState<ExerciseDraft[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [drawing, setDrawing] = useState(false)
  const [activeFigure, setActiveFigure] = useState<string | null>(null)
  const [tab, setTab] = useState<'page' | 'exercises'>('exercises')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const dirty = useRef(false)
  const timer = useRef<number | null>(null)

  // Load the draft once the job is in review
  useEffect(() => {
    if (job?.status === 'review' && job.draft && drafts === null) {
      setDrafts(job.draft)
      if (job.draft[0]) {
        setSelectedId(job.draft[0].id)
        setPage(job.draft[0].page_from)
      }
    }
  }, [job, drafts])

  // Debounced autosave of the draft
  const update = useCallback((next: ExerciseDraft[] | ((d: ExerciseDraft[]) => ExerciseDraft[])) => {
    setDrafts((prev) => {
      const value = typeof next === 'function' ? next(prev ?? []) : next
      dirty.current = true
      return value
    })
  }, [])
  useEffect(() => {
    if (!drafts || !dirty.current || job?.status !== 'review') return
    setSaveState('saving')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      dirty.current = false
      saveDraft(jobId, drafts).then(() => setSaveState('saved')).catch(() => setSaveState('error'))
    }, 900)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [drafts, jobId, job?.status])

  const selected = useMemo(() => drafts?.find((d) => d.id === selectedId) ?? null, [drafts, selectedId])

  const select = (id: string) => {
    setSelectedId(id)
    const d = drafts?.find((x) => x.id === id)
    if (d) setPage(d.page_from)
  }

  const overlays: Overlay[] = useMemo(() => {
    if (!drafts) return []
    const out: Overlay[] = []
    for (const d of drafts) {
      for (const f of d.figures) {
        if (f.page === page) out.push({ id: f.id, bbox: f.bbox, label: d.number ? `${d.number}` : d.title.slice(0, 12), active: d.id === selectedId || f.id === activeFigure })
      }
    }
    return out
  }, [drafts, page, selectedId, activeFigure])

  const onDraw = async (bbox: number[]) => {
    if (!selected) return
    try {
      const fig = await cropFigure(jobId, page, bbox)
      update((ds) => ds.map((d) => (d.id === selected.id ? { ...d, figures: [...d.figures, fig], page_from: Math.min(d.page_from, page), page_to: Math.max(d.page_to, page) } : d)))
      setActiveFigure(fig.id)
    } catch (e) {
      alert(e instanceof Error ? e.message : t('common.error'))
    }
  }

  const onCommit = () => {
    if (!drafts) return
    const payload = drafts.filter((d) => !isEmptyDraft(d))
    commit.mutate({ jobId, exercises: payload }, { onSuccess: (r) => navigate(`/subjects/${job!.document.subject_id}`, { state: { toast: t('review.saved', { n: r.exercise_ids.length }) } }) })
  }

  if (isLoading || !job) {
    return <div className="flex flex-1 items-center justify-center text-fg-muted">{isLoading ? <Spinner className="h-5 w-5" /> : t('errors.notFound')}</div>
  }

  const doc = job.document
  const nonEmpty = drafts?.filter((d) => !isEmptyDraft(d)).length ?? 0
  const showPage = !isMobile || tab === 'page'
  const showList = !isMobile || tab === 'exercises'

  return (
    <div className="flex h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))] flex-col md:h-dvh">
      <header className="z-20 border-b bg-bg/85 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2 md:px-4">
          <Button variant="ghost" size="icon-sm" asChild className="-ml-1 shrink-0">
            <Link to={`/subjects/${doc.subject_id}`} aria-label={t('common.back')}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base leading-tight font-semibold tracking-tight">{t('review.title')}</h1>
            <p className="truncate text-xs text-fg-muted">{t('review.subtitle', { n: drafts?.length ?? 0, doc: doc.title })}</p>
          </div>
          <span className="hidden items-center gap-1 text-[11px] text-fg-subtle sm:inline-flex">
            {saveState === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" /> {t('review.draftSaving')}</>}
            {saveState === 'saved' && <><Check className="h-3 w-3" /> {t('review.draftSaved')}</>}
            {saveState === 'error' && <><AlertCircle className="h-3 w-3 text-red-500" /> {t('common.error')}</>}
          </span>
          {job.status === 'review' && (
            <Button variant="primary" size="sm" onClick={onCommit} disabled={commit.isPending || nonEmpty === 0}>
              {commit.isPending ? <Spinner /> : <Save className="h-4 w-4" />} {t('review.save', { n: nonEmpty })}
            </Button>
          )}
        </div>
        {isMobile && (
          <div className="flex border-t">
            {(['exercises', 'page'] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={cn('flex-1 py-1.5 text-sm font-medium', tab === k ? 'border-b-2 border-accent text-fg' : 'text-fg-muted')}>
                {k === 'page' ? t('review.pageTab') : t('review.exercises')}
              </button>
            ))}
          </div>
        )}
      </header>

      {job.status !== 'review' ? (
        <div className="mx-auto w-full max-w-lg flex-1 p-6">
          <JobStatusLine job={job} />
          {(job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') && <p className="mt-3 text-sm text-fg-muted">{t('review.noDraft')}</p>}
          {job.status === 'done' && (
            <Button className="mt-4" variant="outline" asChild>
              <Link to={`/subjects/${doc.subject_id}`}>{t('common.back')}</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {showPage && (
            <div className={cn('min-h-0 border-r', isMobile ? 'w-full' : 'w-1/2 xl:w-[55%]')}>
              <PageViewer
                documentId={doc.id}
                page={page}
                pageCount={doc.page_count}
                onPageChange={setPage}
                overlays={overlays}
                onDraw={onDraw}
                drawEnabled={drawing && !!selected}
                onToggleDraw={() => setDrawing(!drawing)}
                onOverlayClick={(id) => {
                  const owner = drafts?.find((d) => d.figures.some((f) => f.id === id))
                  if (owner) { setSelectedId(owner.id); setActiveFigure(id); document.getElementById(`draft-${owner.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
                }}
              />
            </div>
          )}
          {showList && (
            <div className={cn('scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-bg', isMobile ? 'w-full' : '')}>
              <div className="mx-auto max-w-2xl space-y-3 p-3 md:p-4">
                {job.notes.length > 0 && (
                  <div className="flex gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-xs">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
                    <div>
                      <p className="mb-0.5 font-medium">{t('review.notes')}</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">{job.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                    </div>
                  </div>
                )}
                {drafts?.map((d, i) => (
                  <DraftEditor
                    key={d.id}
                    draft={d}
                    index={i}
                    total={drafts.length}
                    selected={d.id === selectedId}
                    nodes={nodes}
                    onChange={(nd) => update((ds) => ds.map((x) => (x.id === nd.id ? nd : x)))}
                    onSelect={() => select(d.id)}
                    onMergeNext={() => update((ds) => mergeWithNext(ds, i))}
                    onSplitBeforePart={(pi) => update((ds) => splitBeforePart(ds, i, pi))}
                    onSplitAtCursor={(offset) => update((ds) => splitStatementAt(ds, i, offset))}
                    onMove={(dir) => update((ds) => move(ds, i, dir))}
                    onDelete={() => update((ds) => ds.filter((x) => x.id !== d.id))}
                    onShowFigure={(pg, fid) => { setPage(pg); setActiveFigure(fid); if (isMobile) setTab('page') }}
                    onRemoveFigure={(fid) => update((ds) => ds.map((x) => (x.id === d.id ? { ...x, figures: x.figures.filter((f) => f.id !== fid) } : x)))}
                  />
                ))}
                <Button variant="outline" className="w-full border-dashed" onClick={() => { const nd = emptyDraft(page); update((ds) => [...ds, nd]); setSelectedId(nd.id) }}>
                  <Plus className="h-4 w-4" /> {t('review.add')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
