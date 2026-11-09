import { Plus, Sigma } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { useCreateFormula, usePlanFormulas } from '@/api/formulas'
import type { NodeDetail, PlanDetail } from '@/api/types'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'

import { emptyDraft, FormulaContent, FormulaEditor, type FormulaDraft } from './FormulaEditor'

/** Compact "Formulas" section for the topic panel / full-screen topic page. */
export function NodeFormulas({ node, plan }: { node: NodeDetail; plan: PlanDetail }) {
  const { data: all = [] } = usePlanFormulas(plan.id)
  const create = useCreateFormula()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<FormulaDraft>(emptyDraft(node.id))
  const mine = all.filter((f) => f.node_id === node.id)

  const submit = () => {
    if (!draft.content.trim()) return
    create.mutate({ node_id: node.id, title: draft.title, content: draft.content, note: draft.note }, { onSuccess: () => { setAdding(false); setDraft(emptyDraft(node.id)) } })
  }

  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        <Sigma className="h-3.5 w-3.5" />
        {t('formulas.title')}
        {all.length > 0 && (
          <Link to={`/plans/${plan.id}/formulas`} className="ml-auto font-normal normal-case text-accent hover:underline">
            {t('formulas.inSheet', { n: all.length })}
          </Link>
        )}
      </h3>
      {mine.length > 0 && (
        <ul className="mb-2 divide-y rounded-lg border">
          {mine.map((f) => (
            <li key={f.id} className="px-3 py-2">
              {f.title && <p className="text-xs font-medium">{f.title}</p>}
              <FormulaContent content={f.content} className="text-sm" />
              {f.note && <div className="text-[11px] text-fg-muted italic"><Markdown inline>{f.note}</Markdown></div>}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="rounded-lg border p-2.5">
          <FormulaEditor value={draft} onChange={setDraft} topics={[{ id: node.id, title: node.title }]} allowNoTopic={false} autoFocus compact />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
            <Button size="sm" variant="primary" onClick={submit} disabled={create.isPending || !draft.content.trim()}>
              {create.isPending ? <Spinner /> : null} {t('common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> {t('formulas.add')}
        </Button>
      )}
    </section>
  )
}
