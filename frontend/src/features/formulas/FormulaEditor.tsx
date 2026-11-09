import { Sparkles } from 'lucide-react'
import { useState } from 'react'

import { useHarvestFormulas, type FormulaCandidate } from '@/api/formulas'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Checkbox, Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export interface TopicOption {
  id: number
  title: string
  depth?: number
}

export interface FormulaDraft {
  title: string
  content: string
  note: string
  node_id: number | null
}

export const emptyDraft = (nodeId: number | null = null): FormulaDraft => ({ title: '', content: '', note: '', node_id: nodeId })

/**
 * `$$ … $$` typed on one line is inline math for remark-math (small integrals, no limits).
 * A formula sheet wants display math, so a lone `$$…$$` is put on its own lines.
 */
export function asDisplayMath(content: string): string {
  const m = content.trim().match(/^\$\$([\s\S]+?)\$\$$/)
  return m && !m[1].includes('$$') ? `$$\n${m[1].trim()}\n$$` : content
}

/** The formula itself, display-sized, horizontally scrollable when wide. */
export function FormulaContent({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('overflow-x-auto [&_.katex-display]:my-1.5', className)}>
      <Markdown>{asDisplayMath(content)}</Markdown>
    </div>
  )
}

/** Title / formula (with live KaTeX preview) / note / topic. Pure controlled form, no persistence. */
export function FormulaEditor({ value, onChange, topics, allowNoTopic = true, autoFocus, compact }: { value: FormulaDraft; onChange: (v: FormulaDraft) => void; topics: TopicOption[]; allowNoTopic?: boolean; autoFocus?: boolean; compact?: boolean }) {
  const set = <K extends keyof FormulaDraft>(k: K, v: FormulaDraft[K]) => onChange({ ...value, [k]: v })
  return (
    <div className={cn('grid gap-3', !compact && 'sm:grid-cols-[1fr_1fr]')}>
      <Field label={t('formulas.titleField')}>
        <Input value={value.title} onChange={(e) => set('title', e.target.value)} placeholder={t('formulas.titlePlaceholder')} autoFocus={autoFocus} maxLength={200} />
      </Field>
      <Field label={t('formulas.topic')}>
        <Select value={value.node_id ?? ''} onChange={(e) => set('node_id', e.target.value ? Number(e.target.value) : null)}>
          {allowNoTopic && <option value="">{t('formulas.unassigned')}</option>}
          {topics.map((n) => (
            <option key={n.id} value={n.id}>
              {'\u00a0'.repeat((n.depth ?? 0) * 2)}{n.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('formulas.content')} className={cn(!compact && 'sm:col-span-2')}>
        <Textarea
          value={value.content}
          onChange={(e) => set('content', e.target.value)}
          placeholder={t('formulas.contentPlaceholder')}
          rows={3}
          className="min-h-0 font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
        {value.content.trim() && <FormulaContent content={value.content} className="mt-1.5 rounded-md border bg-bg-sunken/40 px-3 py-1" />}
      </Field>
      <Field label={t('formulas.note')} className={cn(!compact && 'sm:col-span-2')}>
        <Input value={value.note} onChange={(e) => set('note', e.target.value)} placeholder={t('formulas.notePlaceholder')} />
      </Field>
    </div>
  )
}

/** State for "extract formulas with Claude" from one exercise or one topic. */
export function useHarvest(source: { exercise_id: number } | { node_id: number }) {
  const harvest = useHarvestFormulas()
  const run = () => harvest.mutate(source)
  return { run, pending: harvest.isPending, data: harvest.data ?? null, error: harvest.error, reset: harvest.reset }
}

/** Candidates with checkboxes; nothing is saved until `onAdd(selected)` is called by the parent. */
export function HarvestResults({ data, onAdd, onClose }: { data: NonNullable<ReturnType<typeof useHarvest>['data']>; onAdd: (items: FormulaCandidate[]) => Promise<unknown> | void; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(data.candidates.map((_, i) => i)))
  const [adding, setAdding] = useState(false)
  const add = async () => {
    setAdding(true)
    try {
      await onAdd(data.candidates.filter((_, i) => picked.has(i)))
      onClose()
    } finally {
      setAdding(false)
    }
  }
  return (
    <div className="rounded-lg border bg-bg-sunken/30 p-3 animate-rise">
      <p className="mb-2 text-xs font-medium text-fg-muted">{data.candidates.length ? t('formulas.candidates') : t('formulas.noCandidates')}</p>
      <ul className="space-y-2">
        {data.candidates.map((c, i) => (
          <li key={i} className="rounded-md border bg-bg-elevated p-2.5">
            <Checkbox
              checked={picked.has(i)}
              onCheckedChange={(v) => setPicked((prev) => { const next = new Set(prev); if (v) next.add(i); else next.delete(i); return next })}
              label={<span className="text-sm font-medium">{c.title}</span>}
            />
            <FormulaContent content={c.content} className="pl-6" />
            {c.note && <div className="pl-6 text-xs text-fg-muted italic"><Markdown inline>{c.note}</Markdown></div>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-subtle tabular-nums">{t('documents.tokens', { in: data.input_tokens, out: data.output_tokens })}</span>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          {data.candidates.length > 0 && (
            <Button size="sm" variant="primary" onClick={add} disabled={adding || picked.size === 0}>
              {adding ? <Spinner /> : null} {t('formulas.addSelected', { n: picked.size })}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Trigger button + results, for places where both sit together (quick-add dialog). */
export function HarvestPanel({ source, label, onAdd, subjectColor }: { source: { exercise_id: number } | { node_id: number }; label: string; onAdd: (items: FormulaCandidate[]) => Promise<unknown> | void; subjectColor?: string }) {
  const h = useHarvest(source)
  return (
    <div className="space-y-2">
      {!h.data && (
        <Button size="sm" variant="outline" onClick={h.run} disabled={h.pending}>
          {h.pending ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" style={{ color: subjectColor }} />}
          {h.pending ? t('formulas.harvesting') : label}
        </Button>
      )}
      {h.error && <p className="text-xs text-red-600 dark:text-red-400">{h.error.message}</p>}
      {h.data && <HarvestResults data={h.data} onAdd={onAdd} onClose={h.reset} />}
    </div>
  )
}
