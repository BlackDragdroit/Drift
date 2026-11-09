import { ArrowDownRight, ArrowUpRight, BookOpen, Check, ChevronDown, ClipboardList, Clock, Dumbbell, ExternalLink, Gauge, Layers, Lock, Maximize2, Pencil, Play, Sparkles, Square, Timer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { useNode, useSaveNote } from '@/api/hooks'
import { useActiveSession, useStartSession, useStopSession } from '@/api/learning'
import { useCreateCard, useDeleteCard, useGenerateCards, useNodeCards } from '@/api/phase4'
import type { NodeDetail, PlanDetail, Prerequisite, Status } from '@/api/types'
import { Markdown } from '@/components/Markdown'
import { StatusDot, StatusSegmented } from '@/components/StatusControl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { Badge, Spinner } from '@/components/ui/misc'
import { formatElapsed, useElapsed } from '@/components/StudyTimer'
import { ExerciseDialog } from '@/features/exercises/ExerciseDialog'
import { ExerciseRow } from '@/features/exercises/ExerciseRow'
import { NodeFormulas } from '@/features/formulas/NodeFormulas'
import { t } from '@/i18n'
import { cn, difficultyDots, formatMinutes } from '@/lib/utils'

import { NodeEditDialog } from './NodeEditDialog'

interface Props {
  plan: PlanDetail
  nodeId: number | null
  onClose: () => void
  onSelect: (id: number) => void
  onSetStatus: (id: number, status: Status) => void
}

export function NodePanel({ plan, nodeId, onClose, onSelect, onSetStatus }: Props) {
  const { data: node, isLoading } = useNode(nodeId)
  const summary = plan.nodes.find((n) => n.id === nodeId)
  const title = summary?.title ?? node?.title ?? ''
  return (
    <Dialog open={nodeId !== null} onOpenChange={(v) => !v && onClose()} modal={false}>
      <DialogContent title={title} mode="sheet" hideTitle className="md:top-[57px] md:h-[calc(100%-57px)]">
        {isLoading || !node || !summary ? (
          <div className="flex justify-center py-16 text-fg-muted">
            <Spinner />
          </div>
        ) : (
          <PanelBody key={node.id} node={{ ...node, ...summary, note: node.note }} plan={plan} onSelect={onSelect} onSetStatus={onSetStatus} />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function PanelBody({ node, plan, onSelect, onSetStatus, wide }: { node: NodeDetail; plan: PlanDetail; onSelect: (id: number) => void; onSetStatus: (id: number, status: Status) => void; wide?: boolean }) {
  const [editOpen, setEditOpen] = useState(false)
  const [exerciseId, setExerciseId] = useState<number | null>(null)
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))
  const children = plan.nodes.filter((n) => n.parent_id === node.id).sort((a, b) => a.sort_order - b.sort_order)
  const parent = node.parent_id !== null ? byId.get(node.parent_id) : undefined
  const status = node.progress.status
  const blocked = status === 'not_started' && node.blocked_by.length > 0

  return (
    <div className="space-y-5 pt-1">
      <header>
        <div className="flex items-start gap-3 pr-8">
          <div className="min-w-0 flex-1">
            {parent && (
              <button onClick={() => onSelect(parent.id)} className="mb-1 truncate text-xs text-fg-muted hover:text-fg">
                {parent.title} ›
              </button>
            )}
            <h2 className={cn('leading-tight font-semibold tracking-tight', wide ? 'text-2xl' : 'text-lg')}>{node.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              {node.estimated_minutes > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> {formatMinutes(node.estimated_minutes)}
                </span>
              )}
              {node.difficulty && (
                <span className="inline-flex items-center gap-1">
                  <Gauge className="h-3.5 w-3.5" /> <span className="tracking-tighter">{difficultyDots(node.difficulty)}</span>
                </span>
              )}
              <code className="font-mono text-[11px] text-fg-subtle">{node.key}</code>
            </div>
          </div>
          {!wide && (
            <Button variant="ghost" size="icon-sm" asChild aria-label={t('node.fullscreen')} title={t('node.fullscreen')}>
              <Link to={`/plans/${plan.id}/topic/${node.id}`}>
                <Maximize2 className="h-4 w-4" />
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => setEditOpen(true)} aria-label={t('common.edit')}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3">
          <StatusSegmented value={status} onChange={(s) => onSetStatus(node.id, s)} />
        </div>
        <SessionRow node={node} subjectColor={plan.subject_color} />
        {node.ready && (
          <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: plan.subject_color }}>
            <Sparkles className="h-3.5 w-3.5" /> {t('node.readyHint')}
          </p>
        )}
        {blocked && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
            <Lock className="h-3.5 w-3.5" /> {t('node.blockedHint')}
          </p>
        )}
      </header>

      {node.description && (
        <Section title={t('node.description')}>
          <Markdown>{node.description}</Markdown>
        </Section>
      )}

      {node.objectives.length > 0 && (
        <Section title={t('node.objectives')}>
          <ul className="space-y-1.5">
            {node.objectives.map((o, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
                <Markdown inline>{o}</Markdown>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(node.prerequisites.length > 0 || node.dependents.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {node.prerequisites.length > 0 && (
            <Section title={t('node.prerequisites')} icon={<ArrowUpRight className="h-3.5 w-3.5" />}>
              <LinkList items={node.prerequisites} plan={plan} onSelect={onSelect} />
            </Section>
          )}
          {node.dependents.length > 0 && (
            <Section title={t('node.unlocks')} icon={<ArrowDownRight className="h-3.5 w-3.5" />}>
              <LinkList items={node.dependents} plan={plan} onSelect={onSelect} />
            </Section>
          )}
        </div>
      )}

      {children.length > 0 && (
        <Section title={t('node.children')} meta={t('node.childrenDone', { done: node.descendants_done, total: node.descendants_total })}>
          <ul className="space-y-1">
            {children.map((c) => (
              <li key={c.id}>
                <button onClick={() => onSelect(c.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-sunken">
                  <StatusDot status={c.progress.status} />
                  <span className="truncate">{c.title}</span>
                  {c.estimated_minutes > 0 && <span className="ml-auto text-[11px] text-fg-subtle tabular-nums">{formatMinutes(c.estimated_minutes)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {node.resources.length > 0 && (
        <Section title={t('node.resources')}>
          <ul className="space-y-1.5">
            {(node.resources as { title: string; url?: string; type?: string; note?: string }[]).map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
                <div className="min-w-0">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline">
                      {r.title} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span>{r.title}</span>
                  )}
                  {(r.note || r.type) && (
                    <p className="text-xs text-fg-muted">
                      {r.type && r.type !== 'other' && <span className="capitalize">{r.type}</span>}
                      {r.type && r.type !== 'other' && r.note && ' · '}
                      {r.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('node.exercises')} icon={<ClipboardList className="h-3.5 w-3.5" />} meta={String(node.exercises.length)}>
        {node.exercises.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('node.noExercises')}</p>
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {node.exercises.map((e) => (
                <ExerciseRow key={e.id} exercise={e} onOpen={() => setExerciseId(e.id)} />
              ))}
            </ul>
            <Button size="sm" variant="outline" className="mt-2" asChild>
              <Link to={`/practice?subject=${plan.subject_id}&node=${node.id}&autostart=1`}>
                <Dumbbell className="h-3.5 w-3.5" /> {t('practice.title')} {t('timer.forNode')}
              </Link>
            </Button>
          </>
        )}
      </Section>

      <CardsSection node={node} plan={plan} />

      <NodeFormulas node={node} plan={plan} />

      {node.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {node.keywords.map((k) => (
            <Badge key={k}>{k}</Badge>
          ))}
        </div>
      )}

      <NotesEditor planId={plan.id} nodeId={node.id} initial={node.note.content} tall={wide} />

      <NodeEditDialog open={editOpen} onOpenChange={setEditOpen} planId={plan.id} node={node} />
      <ExerciseDialog exerciseId={exerciseId} onClose={() => setExerciseId(null)} />
    </div>
  )
}

function SessionRow({ node, subjectColor }: { node: NodeDetail; subjectColor: string }) {
  const { data: active } = useActiveSession()
  const start = useStartSession()
  const stop = useStopSession()
  const mine = active?.node_id === node.id ? active : null
  const elapsed = useElapsed(mine?.started_at)
  const actual = node.actual_minutes + (mine ? Math.floor(elapsed / 60) : 0)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      {mine ? (
        <Button size="sm" variant="secondary" onClick={() => stop.mutate({ id: mine.id })} disabled={stop.isPending} className="gap-1.5">
          <Square className="h-3 w-3 fill-current text-emerald-500" /> {t('timer.stop')} <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => start.mutate({ node_id: node.id })} disabled={start.isPending} className="gap-1.5">
          <Play className="h-3 w-3" style={{ color: subjectColor }} /> {t('timer.start')}
        </Button>
      )}
      {(actual > 0 || node.estimated_minutes > 0) && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Timer className="h-3.5 w-3.5" />
          {actual > 0 && t('timer.actual', { time: formatMinutes(actual) })}
          {actual > 0 && node.estimated_minutes > 0 && ' · '}
          {node.estimated_minutes > 0 && t('timer.estimated', { time: formatMinutes(node.estimated_minutes) })}
        </span>
      )}
    </div>
  )
}

function Section({ title, icon, meta, children }: { title: string; icon?: React.ReactNode; meta?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        {icon}
        {title}
        {meta && <span className="ml-auto font-normal normal-case tabular-nums">{meta}</span>}
      </h3>
      {children}
    </section>
  )
}

function LinkList({ items, plan, onSelect }: { items: Prerequisite[]; plan: PlanDetail; onSelect: (id: number) => void }) {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]))
  return (
    <ul className="space-y-1">
      {items.map((p) => {
        const target = byId.get(p.node_id)
        if (!target) return null
        return (
          <li key={`${p.node_id}-${p.kind}`}>
            <button onClick={() => onSelect(target.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-bg-sunken">
              <StatusDot status={target.progress.status} />
              <span className={cn('truncate', p.kind === 'recommended' && 'text-fg-muted')}>{target.title}</span>
              {p.kind === 'recommended' && <span className="ml-auto text-[10px] text-fg-subtle italic">{t('plan.recommendedEdge').toLowerCase()}</span>}
            </button>
            {p.note && (
              <div className="pl-6 text-xs text-fg-subtle [&_.prose-md]:text-xs [&_.prose-md]:text-fg-subtle">
                <Markdown inline>{p.note}</Markdown>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function CardsSection({ node, plan }: { node: NodeDetail; plan: PlanDetail }) {
  const { data: cards = [] } = useNodeCards(node.id)
  const create = useCreateCard()
  const del = useDeleteCard()
  const generate = useGenerateCards()
  const [adding, setAdding] = useState(false)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const dueCount = cards.filter((c) => !c.due || new Date(c.due.endsWith('Z') ? c.due : `${c.due}Z`) <= new Date()).length
  const submit = () => {
    if (!front.trim() || !back.trim()) return
    create.mutate({ node_id: node.id, front: front.trim(), back: back.trim() }, { onSuccess: () => { setFront(''); setBack(''); setAdding(false) } })
  }
  return (
    <Section title={t('node.flashcards')} icon={<Layers className="h-3.5 w-3.5" />} meta={cards.length ? `${cards.length} · ${t('cards.due', { n: dueCount })}` : undefined}>
      {cards.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {cards.map((c) => (
            <FlashcardRow key={c.id} front={c.front} back={c.back} source={c.source} onDelete={() => del.mutate({ id: c.id, nodeId: node.id })} />
          ))}
        </ul>
      )}
      {adding ? (
        <div className="space-y-1.5 rounded-lg border p-2">
          <Textarea value={front} onChange={(e) => setFront(e.target.value)} placeholder={t('cards.front')} rows={2} className="min-h-0 text-xs" autoFocus />
          <Textarea value={back} onChange={(e) => setBack(e.target.value)} placeholder={t('cards.back')} rows={2} className="min-h-0 text-xs" />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
            <Button size="sm" variant="primary" onClick={submit} disabled={create.isPending || !front.trim() || !back.trim()}>{t('common.save')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {dueCount > 0 && (
            <Button size="sm" variant="primary" asChild>
              <Link to={`/review?node=${node.id}`}><Layers className="h-3.5 w-3.5" /> {t('cards.reviewNode')}</Link>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>{t('cards.add')}</Button>
          <Button
            size="sm"
            variant="outline"
            disabled={generate.isPending}
            onClick={() => generate.mutate({ nodeId: node.id, count: 5 }, { onSuccess: (r) => setMessage(t('cards.generated', { n: r.created })), onError: (e) => setMessage(e.message) })}
          >
            {generate.isPending ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" style={{ color: plan.subject_color }} />} {generate.isPending ? t('cards.generating') : t('cards.generate')}
          </Button>
        </div>
      )}
      {message && <p className="mt-1.5 text-xs text-fg-muted">{message}</p>}
    </Section>
  )
}

function FlashcardRow({ front, back, source, onDelete }: { front: string; back: string; source?: string; onDelete?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg border">
      <button className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(!open)}>
        <div className="min-w-0 flex-1">
          <Markdown inline>{front}</Markdown>
        </div>
        {source && source !== 'plan' && <Badge className="shrink-0">{t(`cards.source.${source as 'manual' | 'generated'}`)}</Badge>}
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t bg-bg-sunken/50 px-3 py-2 text-sm">
          <Markdown>{back}</Markdown>
          {onDelete && (
            <button onClick={onDelete} className="mt-1 text-[11px] text-fg-subtle hover:text-red-600">{t('cards.delete')}</button>
          )}
        </div>
      )}
    </li>
  )
}

function NotesEditor({ planId, nodeId, initial, tall }: { planId: number; nodeId: number; initial: string; tall?: boolean }) {
  const save = useSaveNote(planId)
  const [value, setValue] = useState(initial)
  const [mode, setMode] = useState<'write' | 'preview'>(initial.trim() ? 'preview' : 'write')
  const [dirty, setDirty] = useState(false)
  const timer = useRef<number | null>(null)
  const latest = useRef(value)
  latest.current = value

  const flush = () => {
    if (!dirty) return
    save.mutate({ nodeId, content: latest.current }, { onSuccess: () => setDirty(false) })
  }

  useEffect(() => {
    if (!dirty) return
    timer.current = window.setTimeout(flush, 1000)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, dirty])

  // flush on unmount
  useEffect(() => () => {
    if (latest.current !== initial) save.mutate({ nodeId, content: latest.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        {t('node.notes')}
        <span className="ml-auto flex items-center gap-2 font-normal normal-case">
          {save.isPending ? <Spinner className="h-3 w-3" /> : dirty ? <span>{t('common.unsaved')}</span> : value.trim() ? <span className="text-fg-subtle">{t('common.saved')}</span> : null}
          <span className="inline-flex rounded-md border p-0.5">
            {(['write', 'preview'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={cn('rounded px-2 py-0.5 text-[11px]', mode === m ? 'bg-bg-sunken text-fg' : 'text-fg-muted')}>
                {t(`node.${m}`)}
              </button>
            ))}
          </span>
        </span>
      </h3>
      {mode === 'write' ? (
        <Textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setDirty(true)
          }}
          onBlur={flush}
          placeholder={t('node.notesPlaceholder')}
          className={cn('font-mono text-xs leading-relaxed', tall ? 'min-h-[360px] text-[13px]' : 'min-h-[140px]')}
        />
      ) : (
        <div className="min-h-[60px] rounded-md border bg-bg-sunken/40 px-3 py-2" onDoubleClick={() => setMode('write')}>
          {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-fg-subtle">{t('node.notesPlaceholder')}</p>}
        </div>
      )}
    </section>
  )
}
