import { useEffect, useState, type FormEvent } from 'react'

import { useUpdatePlan } from '@/api/hooks'
import type { PlanDetail } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'

export function PlanEditDialog({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (v: boolean) => void; plan: PlanDetail }) {
  const update = useUpdatePlan(plan.id)
  const [title, setTitle] = useState(plan.title)
  const [description, setDescription] = useState(plan.description)
  const [examDate, setExamDate] = useState(plan.exam_date ?? '')
  const [examName, setExamName] = useState(plan.exam_name ?? '')
  const [capacity, setCapacity] = useState(String(plan.daily_capacity_minutes))

  useEffect(() => {
    if (open) {
      setTitle(plan.title)
      setDescription(plan.description)
      setExamDate(plan.exam_date ?? '')
      setExamName(plan.exam_name ?? '')
      setCapacity(String(plan.daily_capacity_minutes))
    }
  }, [open, plan])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    update.mutate(
      {
        title: title.trim(),
        description,
        exam_date: examDate || null,
        exam_name: examName.trim() || null,
        clear_exam: !examDate,
        daily_capacity_minutes: Math.min(960, Math.max(15, parseInt(capacity || '120', 10) || 120)),
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('plan.edit')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" type="submit" form="plan-edit-form" disabled={update.isPending || !title.trim()}>
              {update.isPending ? <Spinner /> : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="plan-edit-form" onSubmit={submit} className="space-y-4">
          <Field label={t('plan.title')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </Field>
          <Field label={t('subject.description')}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('plan.exam')}>
              <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </Field>
            <Field label={t('plan.examName')}>
              <Input value={examName} onChange={(e) => setExamName(e.target.value)} placeholder="Klausur" />
            </Field>
          </div>
          <Field label={t('plan.capacity')} hint={t('common.minutes')}>
            <Input type="number" min={15} max={960} step={15} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  )
}
