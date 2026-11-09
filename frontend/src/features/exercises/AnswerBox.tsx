import { Lock, PenLine } from 'lucide-react'
import { forwardRef, useState } from 'react'

import { Markdown } from '@/components/Markdown'
import { Textarea } from '@/components/ui/input'
import { Kbd } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  onChange: (v: string) => void
  /** Once the solution is shown the answer is frozen and rendered next to it. */
  locked: boolean
  /** Ctrl/Cmd+Enter inside the box. */
  onReveal?: () => void
  showKey?: boolean
  className?: string
}

/**
 * Scratch answer written *before* the solution is revealed. Forces retrieval instead of
 * "I would have gotten that": after the reveal it is read-only and shown for comparison.
 */
export const AnswerBox = forwardRef<HTMLTextAreaElement, Props>(function AnswerBox({ value, onChange, locked, onReveal, showKey, className }, ref) {
  const [preview, setPreview] = useState(false)
  const empty = !value.trim()
  return (
    <section className={cn('rounded-xl border', locked ? 'border-line bg-bg-sunken/30' : 'border-accent/40 bg-accent/[0.04]', className)}>
      <header className="flex items-center gap-2 px-3 pt-2.5 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">
        {locked ? <Lock className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5 text-accent" />}
        {t('exercise.yourAnswer')}
        {showKey && !locked && <Kbd>A</Kbd>}
        <span className="ml-auto flex items-center gap-2 font-normal normal-case">
          {locked ? (
            <span className="text-fg-subtle">{t('exercise.answerLocked')}</span>
          ) : (
            <>
              {!empty && (
                <button type="button" onClick={() => setPreview((p) => !p)} className="text-fg-muted hover:text-fg">
                  {preview ? t('node.write') : t('node.preview')}
                </button>
              )}
              {onReveal && <span className="hidden text-fg-subtle sm:inline">{t('exercise.revealHint')}</span>}
            </>
          )}
        </span>
      </header>
      <div className="px-3 pt-1.5 pb-3">
        {locked ? (
          empty ? (
            <p className="text-sm text-fg-subtle italic">{t('exercise.answerEmpty')}</p>
          ) : (
            <Markdown>{value}</Markdown>
          )
        ) : preview ? (
          <div className="min-h-[72px] rounded-md border bg-bg-elevated/60 px-3 py-2" onDoubleClick={() => setPreview(false)}>
            <Markdown>{value}</Markdown>
          </div>
        ) : (
          <Textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (onReveal && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                onReveal()
              } else if (e.key === 'Escape') {
                e.currentTarget.blur()
              }
            }}
            placeholder={t('exercise.answerPlaceholder')}
            rows={3}
            className="min-h-[72px] bg-bg-elevated/60 font-mono text-[13px] leading-relaxed"
            spellCheck={false}
          />
        )}
      </div>
    </section>
  )
})
