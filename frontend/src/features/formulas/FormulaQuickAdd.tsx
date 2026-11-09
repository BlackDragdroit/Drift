import { Plus, Sigma } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { useCreateFormula, type FormulaCandidate } from '@/api/formulas'
import type { Exercise } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'

import { emptyDraft, FormulaEditor, HarvestPanel, type FormulaDraft } from './FormulaEditor'

/**
 * "Add to formula sheet" from an exercise: the topic select lists the exercise's linked topics
 * (each knows its plan), and Claude can propose formulas found in the exercise's solution.
 */
export function FormulaQuickAdd({ exercise, open, onOpenChange }: { exercise: Exercise; open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateFormula()
  const [draft, setDraft] = useState<FormulaDraft>(emptyDraft(exercise.nodes[0]?.id ?? null))
  const [done, setDone] = useState(0)
  useEffect(() => {
    if (open) {
      setDraft(emptyDraft(exercise.nodes[0]?.id ?? null))
      setDone(0)
    }
  }, [open, exercise.id, exercise.nodes])

  const topics = exercise.nodes.map((n) => ({ id: n.id, title: n.title }))
  const planId = exercise.nodes.find((n) => n.id === draft.node_id)?.plan_id ?? exercise.nodes[0]?.plan_id

  const submit = () => {
    if (!draft.content.trim() || draft.node_id === null) return
    create.mutate(
      { node_id: draft.node_id, exercise_id: exercise.id, title: draft.title, content: draft.content, note: draft.note, source: 'exercise' },
      { onSuccess: () => { setDone((n) => n + 1); setDraft((d) => ({ ...d, title: '', content: '', note: '' })) } },
    )
  }
  const addCandidates = async (items: FormulaCandidate[]) => {
    const nodeId = draft.node_id ?? exercise.nodes[0]?.id
    if (nodeId === undefined || nodeId === null) return
    for (const c of items) await create.mutateAsync({ node_id: nodeId, exercise_id: exercise.id, title: c.title, content: c.content, note: c.note, source: 'generated' })
    setDone((n) => n + items.length)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('formulas.addTo')} description={exercise.title} className="max-w-2xl">
        {exercise.nodes.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('formulas.needsTopic')}</p>
        ) : (
          <div className="space-y-4">
            <FormulaEditor value={draft} onChange={setDraft} topics={topics} allowNoTopic={false} autoFocus />
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={submit} disabled={create.isPending || !draft.content.trim() || draft.node_id === null}>
                {create.isPending ? <Spinner /> : <Plus className="h-3.5 w-3.5" />} {t('formulas.add')}
              </Button>
            </div>
            <div className="border-t pt-3">
              <HarvestPanel source={{ exercise_id: exercise.id }} label={t('formulas.harvestFromExercise')} onAdd={addCandidates} />
            </div>
            {done > 0 && planId && (
              <p className="flex items-center gap-2 text-xs text-fg-muted animate-rise">
                <Sigma className="h-3.5 w-3.5 text-emerald-500" /> {t('formulas.added')}
                <Link to={`/plans/${planId}/formulas`} className="text-accent hover:underline">{t('formulas.openSheet')}</Link>
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
