import { AlertCircle, CheckCircle2, ExternalLink, FileText, Loader2, MoreHorizontal, Play, ScanLine, Sparkles, Trash2, Upload, XCircle } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router'

import { isActiveJob, useCancelJob, useDeleteDocument, useDocuments, useStartExtraction, useUploadDocument } from '@/api/documents'
import type { Document, Job, PlanSummary } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { Badge, Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger, ProgressBar, Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'

export function DocumentsSection({ subjectId, plans }: { subjectId: number; plans: PlanSummary[] }) {
  const { data: documents } = useDocuments(subjectId)
  const upload = useUploadDocument(subjectId)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync(file)
      } catch (e) {
        setError(e instanceof Error ? e.message : t('common.error'))
      }
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    onFiles(e.dataTransfer.files)
  }

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {t('documents.title')}
          {documents && documents.length > 0 && <span className="rounded-full bg-bg-sunken px-1.5 py-0.5 text-[11px] text-fg-muted tabular-nums">{documents.length}</span>}
        </h2>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Spinner /> : <Upload className="h-4 w-4" />} {upload.isPending ? t('documents.uploading') : t('documents.upload')}
        </Button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </div>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn('rounded-xl transition-colors', dragging && 'ring-2 ring-accent ring-offset-2 ring-offset-bg')}
      >
        {!documents || documents.length === 0 ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center hover:bg-bg-sunken/50"
          >
            <FileText className="h-7 w-7 text-fg-subtle" />
            <p className="font-medium">{t('documents.noDocuments')}</p>
            <p className="max-w-md text-sm text-fg-muted">{t('documents.noDocumentsHint')}</p>
            <span className="mt-1 text-xs text-fg-subtle">{t('documents.dropHint')}</span>
          </button>
        ) : (
          <ul className="divide-y rounded-xl border bg-bg-elevated shadow-card">
            {documents.map((d) => (
              <DocumentRow key={d.id} doc={d} subjectId={subjectId} plans={plans} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function DocumentRow({ doc, subjectId, plans }: { doc: Document; subjectId: number; plans: PlanSummary[] }) {
  const del = useDeleteDocument(subjectId)
  const cancel = useCancelJob()
  const [startOpen, setStartOpen] = useState(false)
  const job = doc.latest_job
  const active = isActiveJob(job)

  return (
    <li className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-sunken text-fg-muted">
          {doc.has_text_layer ? <FileText className="h-4.5 w-4.5" /> : <ScanLine className="h-4.5 w-4.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{doc.title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            <span>{t('documents.pages', { n: doc.page_count })}</span>
            {!doc.has_text_layer && <Badge color="#f59e0b">{t('documents.scanned')}</Badge>}
            <span>·</span>
            <span>{formatDate(doc.created_at)}</span>
            {doc.exercise_count > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> {t('documents.done', { n: doc.exercise_count })}
                </span>
              </>
            )}
          </p>
          {job && <JobStatusLine job={job} />}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pl-12 sm:pl-0">
        {job?.status === 'review' && (
          <Button size="sm" variant="primary" asChild>
            <Link to={`/jobs/${job.id}/review`}>
              <Sparkles className="h-3.5 w-3.5" /> {t('documents.reviewEmpty')}
            </Link>
          </Button>
        )}
        {active ? (
          <Button size="sm" variant="outline" onClick={() => job && cancel.mutate(job.id)}>
            <XCircle className="h-3.5 w-3.5" /> {t('documents.cancel')}
          </Button>
        ) : (
          <Button size="sm" variant={job?.status === 'review' ? 'ghost' : 'outline'} onClick={() => setStartOpen(true)}>
            <Play className="h-3.5 w-3.5" /> {job && job.status !== 'review' ? t('documents.retry') : t('documents.extract')}
          </Button>
        )}
        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('common.more')}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownTrigger>
          <DropdownContent>
            <DropdownItem asChild>
              <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> {t('documents.openPdf')}
              </a>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem danger onSelect={() => confirm(t('documents.deleteConfirm', { name: doc.title })) && del.mutate(doc.id)}>
              <Trash2 className="h-4 w-4" /> {t('documents.delete')}
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
      <StartExtractionDialog open={startOpen} onOpenChange={setStartOpen} doc={doc} subjectId={subjectId} plans={plans} />
    </li>
  )
}

export function JobStatusLine({ job }: { job: Job }) {
  const pct = job.chunks_total ? (100 * job.chunks_done) / job.chunks_total : 0
  if (job.status === 'pending' || job.status === 'running') {
    return (
      <div className="mt-1.5 max-w-md">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          <span>{job.status === 'pending' ? t('documents.queued') : t('documents.progress', { pages: job.current_pages ?? '…', done: job.chunks_done, total: job.chunks_total })}</span>
        </div>
        <ProgressBar value={job.status === 'running' ? Math.max(pct, 4) : 0} className="mt-1.5" />
      </div>
    )
  }
  if (job.status === 'failed') {
    return (
      <p className="mt-1 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="line-clamp-2">{job.error ?? t('documents.failed')}</span>
      </p>
    )
  }
  const usage = job.input_tokens + job.output_tokens > 0 && (
    <span className="text-fg-subtle">
      · {t('documents.tokens', { in: job.input_tokens.toLocaleString(), out: job.output_tokens.toLocaleString() })}
      {job.estimated_cost_usd !== null && job.estimated_cost_usd !== undefined && ` ${t('documents.cost', { cost: job.estimated_cost_usd.toFixed(3) })}`}
    </span>
  )
  if (job.status === 'review') {
    return (
      <p className="mt-1 text-xs text-accent">
        {t('documents.readyForReview')} {usage}
      </p>
    )
  }
  if (job.status === 'cancelled') return <p className="mt-1 text-xs text-fg-subtle">{t('documents.cancelled')}</p>
  return <p className="mt-1 text-xs text-fg-subtle">{t('documents.done', { n: job.created_exercise_ids.length })} {usage}</p>
}

function StartExtractionDialog({ open, onOpenChange, doc, subjectId, plans }: { open: boolean; onOpenChange: (v: boolean) => void; doc: Document; subjectId: number; plans: PlanSummary[] }) {
  const start = useStartExtraction(subjectId)
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState(String(doc.page_count))
  const [planId, setPlanId] = useState<string>(plans.length === 1 ? String(plans[0].id) : '')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    start.mutate(
      { documentId: doc.id, body: { page_from: Number(from) || 1, page_to: Number(to) || doc.page_count, plan_id: planId ? Number(planId) : null } },
      { onSuccess: () => onOpenChange(false), onError: (e) => setError(e.message) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('documents.startTitle')}
        description={doc.title}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submit} disabled={start.isPending}>
              {start.isPending ? <Spinner /> : <Play className="h-4 w-4" />} {t('documents.start')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('documents.pageRange')} hint={t('documents.pages', { n: doc.page_count })}>
            <div className="flex items-center gap-2">
              <Input type="number" min={1} max={doc.page_count} value={from} onChange={(e) => setFrom(e.target.value)} className="w-24" />
              <span className="text-fg-subtle">–</span>
              <Input type="number" min={1} max={doc.page_count} value={to} onChange={(e) => setTo(e.target.value)} className="w-24" />
            </div>
          </Field>
          <Field label={t('documents.plan')}>
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">{t('documents.anyPlan')}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </Select>
          </Field>
          {!doc.has_text_layer && <p className="text-xs text-fg-muted">{t('documents.scanned')}: pages are sent as images.</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
