import { ArrowDown, ArrowUp, Download, Pencil, Plus, Printer, Sigma, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { formulaExportUrl, useCreateFormula, useDeleteFormula, usePlanFormulas, useReorderFormulas, useUpdateFormula, type Formula, type FormulaCandidate } from '@/api/formulas'
import type { PlanDetail } from '@/api/types'
import { Markdown } from '@/components/Markdown'
import { StatusDot } from '@/components/StatusControl'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, Spinner } from '@/components/ui/misc'
import { treeOrder } from '@/features/plans/graph'
import { t } from '@/i18n'

import { emptyDraft, FormulaContent, FormulaEditor, HarvestResults, useHarvest, type FormulaDraft, type TopicOption } from './FormulaEditor'

interface Props {
  plan: PlanDetail
  onSelect: (id: number | null) => void
}

interface Group {
  nodeId: number | null
  title: string
  status?: PlanDetail['nodes'][number]['progress']['status']
  entries: Formula[]
}

/** The plan's formula sheet: one section per topic in plan order, the unassigned ones last. */
export function FormulaSheet({ plan, onSelect }: Props) {
  const { data: entries, isLoading } = usePlanFormulas(plan.id)
  const create = useCreateFormula()
  const update = useUpdateFormula()
  const del = useDeleteFormula()
  const reorder = useReorderFormulas(plan.id)
  const [adding, setAdding] = useState<number | null | false>(false) // false = closed, else node id (null = general)
  const [draft, setDraft] = useState<FormulaDraft>(emptyDraft())
  const [editingId, setEditingId] = useState<number | null>(null)

  const topics = useMemo<TopicOption[]>(() => treeOrder(plan.nodes).map(({ node, depth }) => ({ id: node.id, title: node.title, depth })), [plan.nodes])

  const groups = useMemo<Group[]>(() => {
    if (!entries) return []
    const byNode = new Map<number | null, Formula[]>()
    for (const e of entries) byNode.set(e.node_id, [...(byNode.get(e.node_id) ?? []), e])
    const out: Group[] = []
    for (const { node } of treeOrder(plan.nodes)) {
      const list = byNode.get(node.id)
      if (list?.length) out.push({ nodeId: node.id, title: node.title, status: node.progress.status, entries: list })
    }
    // entries whose topic no longer exists in this plan (archived) are shown with the general ones
    const general = [...(byNode.get(null) ?? [])]
    for (const [nodeId, list] of byNode) if (nodeId !== null && !plan.nodes.some((n) => n.id === nodeId)) general.push(...list)
    if (general.length) out.push({ nodeId: null, title: t('formulas.general'), entries: general })
    return out
  }, [entries, plan.nodes])

  const openAdd = (nodeId: number | null) => {
    setEditingId(null)
    setDraft(emptyDraft(nodeId))
    setAdding(nodeId)
  }
  const submitAdd = () => {
    if (!draft.content.trim()) return
    create.mutate({ plan_id: plan.id, node_id: draft.node_id, title: draft.title, content: draft.content, note: draft.note }, { onSuccess: () => setAdding(false) })
  }
  const addCandidates = (nodeId: number) => async (items: FormulaCandidate[]) => {
    for (const c of items) await create.mutateAsync({ node_id: nodeId, title: c.title, content: c.content, note: c.note, source: 'generated' })
  }
  const move = (group: Group, index: number, dir: -1 | 1) => {
    const ids = group.entries.map((e) => e.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    reorder.mutate(ids)
  }

  if (isLoading || !entries) {
    return (
      <div className="flex justify-center py-20 text-fg-muted">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  const addForm = (
    <div className="rounded-xl border bg-bg-elevated p-4 shadow-card animate-rise print:hidden">
      <FormulaEditor value={draft} onChange={setDraft} topics={topics} autoFocus />
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" onClick={submitAdd} disabled={create.isPending || !draft.content.trim()}>
          {create.isPending ? <Spinner /> : <Plus className="h-3.5 w-3.5" />} {t('formulas.add')}
        </Button>
      </div>
    </div>
  )

  return (
    <div className="formula-sheet mx-auto w-full max-w-3xl px-3 py-4 md:px-6 print:max-w-none print:px-0 print:py-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Sigma className="h-4 w-4" style={{ color: plan.subject_color }} /> {t('formulas.title')}
          <span className="text-sm font-normal text-fg-muted tabular-nums">{t('formulas.count', { n: entries.length })}</span>
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          {entries.length > 0 && (
            <>
              <Button size="sm" variant="ghost" asChild title={t('formulas.export')}>
                <a href={formulaExportUrl(plan.id)} download>
                  <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t('formulas.export')}</span>
                </a>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.print()} title={t('formulas.print')} className="hidden sm:inline-flex">
                <Printer className="h-3.5 w-3.5" /> {t('formulas.print')}
              </Button>
            </>
          )}
          <Button size="sm" variant="primary" onClick={() => openAdd(null)} disabled={adding !== false}>
            <Plus className="h-3.5 w-3.5" /> {t('formulas.add')}
          </Button>
        </div>
      </div>

      <h1 className="hidden print:block print:mb-4 print:text-2xl print:font-semibold">{plan.title} — {t('formulas.title')}</h1>

      {adding === null && <div className="mb-4">{addForm}</div>}

      {entries.length === 0 && adding === false ? (
        <EmptyState
          icon={<Sigma className="h-8 w-8" />}
          title={t('formulas.empty')}
          hint={t('formulas.emptyHint')}
          action={
            <Button variant="primary" onClick={() => openAdd(null)}>
              <Plus className="h-4 w-4" /> {t('formulas.add')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-6 print:space-y-4">
          {groups.map((g) => (
            <TopicGroup
              key={g.nodeId ?? 'general'}
              group={g}
              plan={plan}
              onSelect={onSelect}
              onAdd={() => openAdd(g.nodeId)}
              addDisabled={adding !== false}
              addForm={adding === g.nodeId && g.nodeId !== null ? addForm : null}
              onAddCandidates={g.nodeId !== null ? addCandidates(g.nodeId) : undefined}
            >
              <ul className="space-y-2">
                {g.entries.map((e, i) =>
                  editingId === e.id ? (
                    <li key={e.id}>
                      <EditEntry
                        entry={e}
                        topics={topics}
                        pending={update.isPending}
                        onCancel={() => setEditingId(null)}
                        onSave={(d) => update.mutate({ id: e.id, title: d.title, content: d.content, note: d.note, node_id: d.node_id }, { onSuccess: () => setEditingId(null) })}
                      />
                    </li>
                  ) : (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      first={i === 0}
                      last={i === g.entries.length - 1}
                      onEdit={() => { setAdding(false); setEditingId(e.id) }}
                      onDelete={() => confirm(t('formulas.deleteConfirm')) && del.mutate({ id: e.id, planId: plan.id })}
                      onMove={(dir) => move(g, i, dir)}
                    />
                  ),
                )}
              </ul>
            </TopicGroup>
          ))}
        </div>
      )}
    </div>
  )
}

function TopicGroup({ group: g, plan, onSelect, onAdd, addDisabled, addForm, onAddCandidates, children }: { group: Group; plan: PlanDetail; onSelect: (id: number | null) => void; onAdd: () => void; addDisabled: boolean; addForm: React.ReactNode; onAddCandidates?: (items: FormulaCandidate[]) => Promise<void>; children: React.ReactNode }) {
  const harvest = useHarvest({ node_id: g.nodeId ?? -1 })
  return (
    <section className="break-inside-avoid">
      <header className="mb-2 flex items-center gap-2 border-b pb-1.5">
        {g.status && <StatusDot status={g.status} />}
        {g.nodeId !== null ? (
          <button onClick={() => onSelect(g.nodeId)} className="truncate text-left text-sm font-semibold hover:underline">{g.title}</button>
        ) : (
          <span className="text-sm font-semibold text-fg-muted">{g.title}</span>
        )}
        <span className="text-[11px] text-fg-subtle tabular-nums">{g.entries.length}</span>
        <span className="ml-auto flex items-center print:hidden">
          {onAddCandidates && (
            <Button size="icon-sm" variant="ghost" onClick={harvest.run} disabled={harvest.pending || !!harvest.data} aria-label={t('formulas.harvestFromTopic')} title={t('formulas.harvestFromTopic')}>
              {harvest.pending ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" style={{ color: plan.subject_color }} />}
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" onClick={onAdd} aria-label={t('formulas.add')} title={t('formulas.add')} disabled={addDisabled}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </span>
      </header>
      {children}
      {addForm && <div className="mt-2">{addForm}</div>}
      {harvest.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{harvest.error.message}</p>}
      {harvest.data && onAddCandidates && (
        <div className="mt-2 print:hidden">
          <HarvestResults data={harvest.data} onAdd={onAddCandidates} onClose={harvest.reset} />
        </div>
      )}
    </section>
  )
}

function EntryRow({ entry, first, last, onEdit, onDelete, onMove }: { entry: Formula; first: boolean; last: boolean; onEdit: () => void; onDelete: () => void; onMove: (dir: -1 | 1) => void }) {
  return (
    <li className="group rounded-lg border bg-bg-elevated px-3 py-2.5 shadow-card print:border-0 print:px-0 print:py-1 print:shadow-none">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 flex-1">
          {entry.title && (
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
              {entry.title}
              {entry.source !== 'manual' && <Badge className="print:hidden">{t(`formulas.source.${entry.source}`)}</Badge>}
            </p>
          )}
          <FormulaContent content={entry.content} />
          {entry.note && <div className="text-xs text-fg-muted italic [&_.katex]:text-[0.95em]"><Markdown inline>{entry.note}</Markdown></div>}
        </div>
        <div className="-mb-1 flex shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 print:hidden sm:mb-0 [@media(hover:none)]:opacity-100">
          <Button size="icon-sm" variant="ghost" onClick={() => onMove(-1)} disabled={first} aria-label={t('formulas.moveUp')} title={t('formulas.moveUp')}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => onMove(1)} disabled={last} aria-label={t('formulas.moveDown')} title={t('formulas.moveDown')}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={t('formulas.edit')} title={t('formulas.edit')}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label={t('formulas.delete')} title={t('formulas.delete')} className="hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  )
}

function EditEntry({ entry, topics, pending, onCancel, onSave }: { entry: Formula; topics: TopicOption[]; pending: boolean; onCancel: () => void; onSave: (d: FormulaDraft) => void }) {
  const [draft, setDraft] = useState<FormulaDraft>({ title: entry.title, content: entry.content, note: entry.note, node_id: entry.node_id })
  return (
    <div className="rounded-xl border bg-bg-elevated p-4 shadow-card animate-rise">
      <FormulaEditor value={draft} onChange={setDraft} topics={topics} autoFocus />
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button size="sm" variant="primary" onClick={() => onSave(draft)} disabled={pending || !draft.content.trim()}>
          {pending ? <Spinner /> : null} {t('common.save')}
        </Button>
      </div>
    </div>
  )
}
