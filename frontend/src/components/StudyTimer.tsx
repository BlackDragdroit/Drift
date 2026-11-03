import { Square, Timer } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useActiveSession, useStopSession } from '@/api/learning'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

import { Button } from './ui/button'

export function useElapsed(startedAt: string | null | undefined) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!startedAt) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [startedAt])
  if (!startedAt) return 0
  return Math.max(0, Math.floor((now - new Date(startedAt.endsWith('Z') ? startedAt : `${startedAt}Z`).getTime()) / 1000))
}

export function formatElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

/** Floating pill shown while a study session is running. */
export function StudyTimerPill() {
  const { data: session } = useActiveSession()
  const stop = useStopSession()
  const elapsed = useElapsed(session?.started_at)
  if (!session) return null
  return (
    <div className={cn('fixed right-3 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-2 rounded-full border bg-bg-elevated/95 py-1.5 pr-1.5 pl-3 shadow-pop backdrop-blur md:bottom-4', 'animate-rise')}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <Timer className="h-3.5 w-3.5 text-fg-muted" />
      <span className="font-mono text-sm tabular-nums">{formatElapsed(elapsed)}</span>
      {session.node_title && <span className="hidden max-w-[180px] truncate text-xs text-fg-muted sm:inline">{session.node_title}</span>}
      <Button size="sm" variant="secondary" className="h-7 rounded-full px-2.5" onClick={() => stop.mutate({ id: session.id })} disabled={stop.isPending}>
        <Square className="h-3 w-3 fill-current" /> {t('timer.stop')}
      </Button>
    </div>
  )
}
