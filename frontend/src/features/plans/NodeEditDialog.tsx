import { useEffect, useState, type FormEvent } from 'react'

import { useUpdateNode } from '@/api/hooks'
import type { PlanNode } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'

export function NodeEditDialog({ open, onOpenChange, planId, node }: { open: boolean; onOpenChange: (v: boolean) => void; planId: number; node: PlanNode }) {
  const update = useUpdateNode(planId)
  const [title, setTitle] = useState(node.title)
  const [description, setDescription] = useState(node.description)
  const [objectives, setObjectives] = useState(node.objectives.join('\n'))
  const [minutes, setMinutes] = useState(String(node.estimated_minutes))
  const [difficulty, setDifficulty] = useState(node.difficulty ? String(node.difficulty) : '')

  useEffect(() => {
    if (open) {
      setTitle(node.title)
      setDescription(node.description)
      setObjectives(node.objectives.join('\n'))
      setMinutes(String(node.estimated_minutes))
      setDifficulty(node.difficulty ? String(node.difficulty) : '')
    }
  }, [open, node])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    update.mutate(
      {
        nodeId: node.id,
        body: {
          title: title.trim(),
          description,
          objectives: objectives.split('\n').map((s) => s.trim()).filter(Boolean),
          estimated_minutes: Math.max(0, parseInt(minutes || '0', 10) || 0),
          difficulty: difficulty ? Number(difficulty) : null,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('node.editTitle')}
        className="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" type="submit" form="node-edit-form" disabled={update.isPending || !title.trim()}>
              {update.isPending ? <Spinner /> : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="node-edit-form" onSubmit={submit} className="space-y-4">
          <Field label={t('plan.title')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </Field>
          <Field label={t('node.description')} hint="Markdown + $LaTeX$">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className="font-mono text-xs" />
          </Field>
          <Field label={t('node.objectives')} hint="One per line">
            <Textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} rows={4} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('node.estimatedMinutes')}>
              <Input type="number" min={0} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
            <Field label={t('node.difficulty')}>
              <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>{'●'.repeat(d)}</option>
                ))}
              </Select>
            </Field>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
