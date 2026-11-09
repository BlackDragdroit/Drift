import { GripVertical, Minimize2, PictureInPicture2, Square, Timer } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'

import { useActiveSession, useStopSession } from '@/api/learning'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

import { useTimerPopout } from './TimerPopout'
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

type Pos = { x: number; y: number }
const POS_KEY = 'timer.pos'
const COLLAPSED_KEY = 'timer.collapsed'
const MARGIN = 8

function readPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    return raw ? (JSON.parse(raw) as Pos) : null
  } catch {
    return null
  }
}

function clamp(pos: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 200
  const h = el?.offsetHeight ?? 40
  return {
    x: Math.min(Math.max(MARGIN, pos.x), window.innerWidth - w - MARGIN),
    y: Math.min(Math.max(MARGIN, pos.y), window.innerHeight - h - MARGIN),
  }
}

/** Floating, draggable study-timer widget. Position and collapsed state persist per device. */
export function StudyTimerPill() {
  const { data: session } = useActiveSession()
  const stop = useStopSession()
  const elapsed = useElapsed(session?.started_at)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(() => readPos())
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1')
  const drag = useRef<{ dx: number; dy: number; moved: boolean; start: Pos } | null>(null)
  const onStop = useCallback(() => session && stop.mutate({ id: session.id }), [session, stop])
  const popout = useTimerPopout({ session, elapsed, onStop })

  // Default corner: bottom-right (above the mobile nav), measured after first paint.
  useEffect(() => {
    if (!session || pos || !ref.current) return
    const el = ref.current
    const mobile = window.innerWidth < 768
    setPos(clamp({ x: window.innerWidth - el.offsetWidth - 12, y: window.innerHeight - el.offsetHeight - (mobile ? 72 : 16) }, el))
  }, [session, pos])

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p, ref.current) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const persist = (p: Pos) => localStorage.setItem(POS_KEY, JSON.stringify(p))
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      return !c
    })
    // keep the widget inside the viewport after it changes size
    requestAnimationFrame(() => setPos((p) => (p ? clamp(p, ref.current) : p)))
  }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!pos || (e.target as HTMLElement).closest('button')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false, start: pos }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const next = clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, ref.current)
    if (Math.abs(next.x - drag.current.start.x) > 3 || Math.abs(next.y - drag.current.start.y) > 3) drag.current.moved = true
    setPos(next)
  }
  const onPointerUp = () => {
    if (!drag.current) return
    const { moved } = drag.current
    drag.current = null
    if (pos) persist(clamp(pos, ref.current))
    if (!moved && collapsed) toggleCollapsed()
  }

  if (!session) return null
  // Document PiP shows the whole pill in its own always-on-top window; the in-page one steps aside.
  if (popout.mode === 'document' && popout.active) return popout.portal

  return (
    <div
      ref={ref}
      role="status"
      aria-label={t('timer.running')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={cn(
        'fixed z-[60] flex items-center gap-2 rounded-full border bg-bg-elevated/95 shadow-pop backdrop-blur select-none',
        'cursor-grab active:cursor-grabbing touch-none',
        collapsed ? 'py-1.5 pr-3 pl-2.5' : 'py-1.5 pr-1.5 pl-2',
        pos ? 'animate-fade-in' : 'invisible',
      )}
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}
      title={collapsed ? t('timer.studyingNode', { title: session.node_title ?? '' }) : undefined}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      {collapsed ? (
        <span className="font-mono text-xs tabular-nums">{formatElapsed(elapsed)}</span>
      ) : (
        <>
          <GripVertical className="h-3.5 w-3.5 text-fg-subtle" />
          <Timer className="h-3.5 w-3.5 text-fg-muted" />
          <span className="font-mono text-sm tabular-nums">{formatElapsed(elapsed)}</span>
          {session.node_title && <span className="hidden max-w-[180px] truncate text-xs text-fg-muted sm:inline">{session.node_title}</span>}
          <Button size="sm" variant="secondary" className="h-7 rounded-full px-2.5" onClick={onStop} disabled={stop.isPending}>
            <Square className="h-3 w-3 fill-current" /> {t('timer.stop')}
          </Button>
          {popout.mode && (
            <button
              onClick={() => (popout.active ? popout.close() : popout.open())}
              className={cn('rounded-full p-1.5 hover:bg-bg-sunken hover:text-fg', popout.active ? 'text-accent' : 'text-fg-subtle')}
              aria-label={popout.active ? t('timer.popin') : t('timer.popout')}
              title={popout.active ? t('timer.popin') : popout.mode === 'video' ? `${t('timer.popout')} — ${t('timer.popoutVideoHint')}` : t('timer.popout')}
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={toggleCollapsed} className="rounded-full p-1.5 text-fg-subtle hover:bg-bg-sunken hover:text-fg" aria-label={t('timer.collapse')} title={t('timer.collapse')}>
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
