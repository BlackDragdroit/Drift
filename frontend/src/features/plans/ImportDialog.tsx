import { AlertTriangle, CheckCircle2, FileUp, Sparkles, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { ApiError } from '@/api/client'
import { useImportPlan, usePreviewImport, useSubjects } from '@/api/hooks'
import type { ImportPreview, Issue, NodeDiff } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Checkbox, Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

import { GenerationPromptDialog } from './GenerationPromptDialog'

const NEW = '__new__'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  subjectId?: number
  /** When set, the import updates this plan ("Update from file"). */
  planId?: number
  planTitle?: string
}

export function ImportDialog({ open, onOpenChange, subjectId, planId, planTitle }: Props) {
  const { data: subjects } = useSubjects()
  const preview = usePreviewImport()
  const importPlan = useImportPlan()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [content, setContent] = useState('')
  const [target, setTarget] = useState<string>(subjectId ? String(subjectId) : '')
  const [newName, setNewName] = useState('')
  const [removedPolicy, setRemovedPolicy] = useState<'archive' | 'delete'>('archive')
  const [importProgress, setImportProgress] = useState(true)
  const [importNotes, setImportNotes] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [result, setResult] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setContent('')
      setResult(null)
      setError(null)
      setTarget(subjectId ? String(subjectId) : '')
      setNewName('')
      setRemovedPolicy('archive')
    }
  }, [open, subjectId])

  // Debounced server-side validation + diff preview
  useEffect(() => {
    if (!open || !content.trim()) {
      setResult(null)
      return
    }
    const handle = setTimeout(() => {
      const sid = target && target !== NEW ? Number(target) : undefined
      preview.mutate(
        { content, format: 'auto', subject_id: planId ? undefined : sid, plan_id: planId },
        { onSuccess: (r) => { setResult(r); setError(null) }, onError: (e) => setError(e.message) },
      )
    }, 500)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, target, planId, open])

  // Default to the subject named in the file when nothing is selected yet
  useEffect(() => {
    if (!subjectId && !planId && result?.ok && !target && subjects) {
      const match = subjects.find((s) => s.name.toLowerCase() === result.subject_name?.toLowerCase())
      if (match) setTarget(String(match.id))
      else if (result.subject_name) {
        setTarget(NEW)
        setNewName(result.subject_name)
      }
    }
  }, [result, subjects, subjectId, planId, target])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setContent(await file.text())
  }

  const canImport = !!result?.ok && !importPlan.isPending && (planId || (target && (target !== NEW || newName.trim())))

  const doImport = () => {
    importPlan.mutate(
      {
        content,
        format: 'auto',
        subject_id: planId ? undefined : target && target !== NEW ? Number(target) : undefined,
        new_subject_name: target === NEW ? newName.trim() : undefined,
        plan_id: planId,
        removed_nodes: removedPolicy,
        import_progress: !!result?.has_progress_block && importProgress,
        import_notes: !!result?.has_notes_block && importNotes,
        overwrite_existing_progress: overwrite,
      },
      {
        onSuccess: (r) => {
          onOpenChange(false)
          navigate(`/plans/${r.plan_id}`)
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
      },
    )
  }

  const errors = useMemo(() => result?.issues.filter((i) => i.severity === 'error') ?? [], [result])
  const warnings = useMemo(() => result?.issues.filter((i) => i.severity === 'warning') ?? [], [result])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={planId ? `${t('plan.reimport')}: ${planTitle ?? ''}` : t('import.title')}
        description={t('import.subtitle')}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromptOpen(true)} className="mr-auto">
              <Sparkles className="h-4 w-4" /> {t('import.generationPrompt')}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!canImport} onClick={doImport}>
              {importPlan.isPending ? <Spinner /> : planId || result?.mode === 'merge' ? t('import.update') : t('import.import')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="relative">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('import.paste')}
              className="min-h-[180px] font-mono text-xs leading-relaxed"
              spellCheck={false}
              onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }}
              onDragOver={(e) => e.preventDefault()}
            />
            <div className="absolute top-2 right-2 flex items-center gap-1.5">
              {preview.isPending && <Spinner className="text-fg-subtle" />}
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp className="h-3.5 w-3.5" /> {t('import.file')}
              </Button>
              <input ref={fileRef} type="file" accept=".json,.md,.txt,application/json,text/markdown" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
          </div>

          {!planId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('import.target')}>
                <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">—</option>
                  {subjects?.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  <option value={NEW}>{t('import.newSubject')}</option>
                </Select>
              </Field>
              {target === NEW && (
                <Field label={t('import.newSubjectName')}>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Signals & Systems" />
                </Field>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {result && <PreviewPanel result={result} errors={errors} warnings={warnings} />}

          {result?.ok && (
            <div className="space-y-2.5 rounded-lg border bg-bg-sunken/50 p-3">
              {(result.counts?.removed ?? 0) > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-fg-muted">{t('import.removedPolicy')}:</span>
                  <Select value={removedPolicy} onChange={(e) => setRemovedPolicy(e.target.value as 'archive' | 'delete')} className="w-auto">
                    <option value="archive">{t('import.archive')}</option>
                    <option value="delete">{t('import.deleteRemoved')}</option>
                  </Select>
                </div>
              )}
              {result.has_progress_block && (
                <>
                  <Checkbox checked={importProgress} onCheckedChange={setImportProgress} label={t('import.includesProgress')} />
                  {importProgress && result.mode === 'merge' && (
                    <Checkbox checked={overwrite} onCheckedChange={setOverwrite} label={t('import.overwriteProgress')} />
                  )}
                </>
              )}
              {result.has_notes_block && <Checkbox checked={importNotes} onCheckedChange={setImportNotes} label={t('import.includesNotes')} />}
              {result.mode === 'merge' && <p className="text-xs text-fg-subtle">{t('import.mergeHint')}</p>}
            </div>
          )}
        </div>
      </DialogContent>
      <GenerationPromptDialog open={promptOpen} onOpenChange={setPromptOpen} />
    </Dialog>
  )
}

function PreviewPanel({ result, errors, warnings }: { result: ImportPreview; errors: Issue[]; warnings: Issue[] }) {
  const [showAll, setShowAll] = useState(false)
  const counts = result.counts
  const changedNodes = result.nodes.filter((n) => n.change !== 'unchanged')
  return (
    <div className="space-y-3">
      <div className={cn('flex items-start gap-2.5 rounded-lg border p-3 text-sm', result.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
        {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
        <div className="min-w-0 flex-1">
          {result.ok ? (
            <>
              <p className="font-medium">
                {result.mode === 'merge'
                  ? t('import.willMerge', { title: result.plan_title ?? '' })
                  : t('import.willCreate', { title: result.plan_title ?? '', n: counts?.added ?? 0 })}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {result.mode === 'merge' && counts && (
                  <>
                    <Badge color="#10b981">+{counts.added} {t('import.added')}</Badge>
                    <Badge color="#f59e0b">~{counts.changed} {t('import.changed')}</Badge>
                    <Badge>{counts.unchanged} {t('import.unchanged')}</Badge>
                    {counts.removed > 0 && <Badge color="#ef4444">−{counts.removed} {t('import.removed')}</Badge>}
                  </>
                )}
                {result.exercises > 0 && <Badge>{t('import.exercises', { n: result.exercises })}</Badge>}
                {result.flashcards > 0 && <Badge>{t('import.flashcards', { n: result.flashcards })}</Badge>}
                {result.detected_format && <Badge>{t('import.detected', { fmt: result.detected_format })}</Badge>}
              </div>
            </>
          ) : (
            <>
              <p className="font-medium">{t('import.issues')} ({errors.length})</p>
              <ul className="mt-2 space-y-1.5 text-[13px]">
                {errors.map((i, idx) => (
                  <li key={idx} className="flex gap-2">
                    <code className="shrink-0 rounded bg-bg-sunken px-1 font-mono text-[11px] text-fg-muted">{i.path}</code>
                    <span>{i.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {warnings.length > 0 && <IssueList issues={warnings} kind="warning" />}

      {result.ok && result.mode === 'merge' && changedNodes.length > 0 && (
        <div className="rounded-lg border">
          <ul className="scrollbar-thin max-h-48 divide-y overflow-y-auto text-sm">
            {(showAll ? changedNodes : changedNodes.slice(0, 8)).map((n) => (
              <DiffRow key={`${n.change}-${n.key}`} node={n} />
            ))}
          </ul>
          {changedNodes.length > 8 && !showAll && (
            <button className="w-full border-t py-1.5 text-xs text-fg-muted hover:text-fg" onClick={() => setShowAll(true)}>
              +{changedNodes.length - 8}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function DiffRow({ node }: { node: NodeDiff }) {
  const color = node.change === 'added' ? '#10b981' : node.change === 'removed' ? '#ef4444' : '#f59e0b'
  const sign = node.change === 'added' ? '+' : node.change === 'removed' ? '−' : '~'
  return (
    <li className="flex items-center gap-2 px-3 py-1.5">
      <span className="w-3 text-center font-mono font-bold" style={{ color }}>{sign}</span>
      <span className="min-w-0 flex-1 truncate">
        {node.title} <span className="font-mono text-[11px] text-fg-subtle">{node.key}</span>
      </span>
      <span className="hidden truncate text-[11px] text-fg-subtle sm:inline">{node.fields.join(', ')}</span>
      {node.has_progress && <Badge color="#0ea5e9">{t('import.hasProgress')}</Badge>}
      {node.has_note && <Badge color="#8b5cf6">{t('import.hasNote')}</Badge>}
    </li>
  )
}

function IssueList({ issues, kind }: { issues: Issue[]; kind: 'error' | 'warning' }) {
  const [open, setOpen] = useState(kind === 'error')
  const Icon = kind === 'error' ? XCircle : AlertTriangle
  const color = kind === 'error' ? 'text-red-500' : 'text-amber-500'
  return (
    <div className="rounded-lg border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
        <Icon className={cn('h-4 w-4', color)} />
        {kind === 'error' ? t('import.issues') : t('import.warnings')} ({issues.length})
        <span className="ml-auto text-xs text-fg-subtle">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="scrollbar-thin max-h-56 space-y-1.5 overflow-y-auto border-t px-3 py-2 text-[13px]">
          {issues.map((i, idx) => (
            <li key={idx} className="flex gap-2">
              <code className="shrink-0 rounded bg-bg-sunken px-1 font-mono text-[11px] text-fg-muted">{i.path}</code>
              <span>{i.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
