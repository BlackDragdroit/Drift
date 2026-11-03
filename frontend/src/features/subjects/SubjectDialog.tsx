import { useEffect, useState, type FormEvent } from 'react'

import { useCreateSubject, useUpdateSubject } from '@/api/hooks'
import type { Subject } from '@/api/types'
import { SubjectIcon, SUBJECT_ICONS } from '@/features/subjects/SubjectIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#84cc16', '#64748b', '#a855f7']

export function SubjectDialog({ open, onOpenChange, subject, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; subject?: Subject; onCreated?: (s: Subject) => void }) {
  const create = useCreateSubject()
  const update = useUpdateSubject(subject?.id ?? -1)
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [icon, setIcon] = useState<string>(SUBJECT_ICONS[0])
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (open) {
      setName(subject?.name ?? '')
      setColor(subject?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)])
      setIcon(subject?.icon ?? SUBJECT_ICONS[0])
      setDescription(subject?.description ?? '')
    }
  }, [open, subject])

  const pending = create.isPending || update.isPending
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = { name: name.trim(), color, icon, description }
    if (subject) update.mutate(body, { onSuccess: () => onOpenChange(false) })
    else
      create.mutate(body, {
        onSuccess: (s) => {
          onOpenChange(false)
          onCreated?.(s)
        },
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={subject ? t('subject.editTitle') : t('subject.createTitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" type="submit" form="subject-form" disabled={pending || !name.trim()}>
              {pending ? <Spinner /> : subject ? t('common.save') : t('common.create')}
            </Button>
          </>
        }
      >
        <form id="subject-form" onSubmit={submit} className="space-y-4">
          <Field label={t('subject.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={120} placeholder="Signals & Systems" />
          </Field>
          <Field label={t('subject.color')}>
            <div className="flex flex-wrap items-center gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn('h-7 w-7 rounded-full transition-transform hover:scale-110', color === c && 'ring-2 ring-fg ring-offset-2 ring-offset-bg-elevated')}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0" aria-label="Custom color" />
            </div>
          </Field>
          <Field label={t('subject.icon')}>
            <div className="flex flex-wrap gap-1.5">
              {SUBJECT_ICONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setIcon(name)}
                  className={cn('flex h-9 w-9 items-center justify-center rounded-md border text-fg-muted hover:bg-bg-sunken', icon === name && 'border-accent bg-bg-sunken text-fg')}
                  style={icon === name ? { color } : undefined}
                  aria-label={name}
                >
                  <SubjectIcon name={name} className="h-4.5 w-4.5" />
                </button>
              ))}
            </div>
          </Field>
          <Field label={`${t('subject.description')} (${t('common.optional')})`}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  )
}
