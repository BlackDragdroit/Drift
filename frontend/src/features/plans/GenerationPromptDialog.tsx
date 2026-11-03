import { Check, Copy, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

import { fetchGenerationPrompt } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Spinner } from '@/components/ui/misc'
import { t } from '@/i18n'
import { copyToClipboard } from '@/lib/utils'

export function GenerationPromptDialog({ open, onOpenChange, defaultTopic = '' }: { open: boolean; onOpenChange: (v: boolean) => void; defaultTopic?: string }) {
  const [topic, setTopic] = useState(defaultTopic)
  const [context, setContext] = useState('')
  const [language, setLanguage] = useState('en')
  const [examDate, setExamDate] = useState('')
  const [nodeCount, setNodeCount] = useState('15-30')
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (open) setTopic(defaultTopic)
  }, [open, defaultTopic])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const handle = setTimeout(() => {
      fetchGenerationPrompt({ topic: topic || '<TOPIC>', context, language, exam_date: examDate || null, node_count: nodeCount })
        .then(setPrompt)
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(handle)
  }, [open, topic, context, language, examDate, nodeCount])

  const copy = async () => {
    if (await copyToClipboard(prompt)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('prompt.title')}
        description={t('prompt.subtitle')}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" asChild className="mr-auto">
              <a href="/api/plans/schema.json" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> {t('prompt.schema')}
              </a>
            </Button>
            <Button variant="primary" onClick={copy} disabled={!prompt || loading}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t('common.copied') : t('prompt.copy')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('prompt.topic')} className="sm:col-span-2">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t('prompt.topicPlaceholder')} autoFocus />
            </Field>
            <Field label={`${t('prompt.context')} (${t('common.optional')})`} className="sm:col-span-2">
              <Textarea value={context} onChange={(e) => setContext(e.target.value)} placeholder={t('prompt.contextPlaceholder')} rows={2} />
            </Field>
            <Field label={t('prompt.language')}>
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="de">Deutsch</option>
              </Select>
            </Field>
            <Field label={`${t('prompt.examDate')} (${t('common.optional')})`}>
              <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </Field>
            <Field label={t('prompt.nodeCount')}>
              <Select value={nodeCount} onChange={(e) => setNodeCount(e.target.value)}>
                <option value="8-15">8–15 (compact)</option>
                <option value="15-30">15–30 (standard)</option>
                <option value="30-60">30–60 (whole course)</option>
              </Select>
            </Field>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium tracking-wide text-fg-muted uppercase">{t('prompt.preview')}</span>
              {loading && <Spinner className="text-fg-subtle" />}
            </div>
            <pre className="scrollbar-thin max-h-72 overflow-auto rounded-lg border bg-bg-sunken p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-muted">{prompt}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
