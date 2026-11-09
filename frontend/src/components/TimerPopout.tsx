import { Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { StudySession } from '@/api/learning'
import { t } from '@/i18n'

import { formatElapsed } from './StudyTimer'

/**
 * "Pop out" the study timer into a window that stays above every other application.
 *
 * - Chrome / Edge (desktop): Document Picture-in-Picture — a small always-on-top window with real
 *   HTML (time, topic, Stop, back-to-tab). The app's stylesheets and theme class are mirrored.
 * - Safari, Android Chrome: video Picture-in-Picture fed from a canvas that we redraw every
 *   second. Display only; Stop stays in the tab.
 * - Firefox has no programmatic PiP; the button is not shown.
 *
 * The last choice is remembered: a session that ends while popped out pops out again next time
 * (`requestTimerPopout()` is called from the Start button's click so the gesture is still valid).
 */

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>
      window: Window | null
    }
  }
  interface HTMLVideoElement {
    webkitSetPresentationMode?: (mode: 'picture-in-picture' | 'inline') => void
    webkitPresentationMode?: string
  }
}

export type PopoutMode = 'document' | 'video'
const AUTO_KEY = 'timer.popout'
const EVENT = 'drift:timer-popout'

export function popoutSupport(): PopoutMode | null {
  if (typeof window === 'undefined') return null
  if (window.documentPictureInPicture) return 'document'
  const video = document.createElement('video')
  if ((document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') || typeof video.webkitSetPresentationMode === 'function') return 'video'
  return null
}

/** Call inside the click handler that starts a session: re-opens the pop-out if it was last used. */
export function requestTimerPopout() {
  if (localStorage.getItem(AUTO_KEY) === '1' && popoutSupport()) window.dispatchEvent(new Event(EVENT))
}

function mirrorStyles(target: Document) {
  const base = target.createElement('base')
  base.href = `${location.origin}/`
  target.head.append(base)
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) target.head.append(node.cloneNode(true))
  target.documentElement.className = document.documentElement.className
  target.body.style.margin = '0'
  const observer = new MutationObserver(() => {
    target.documentElement.className = document.documentElement.className
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  target.defaultView?.addEventListener('pagehide', () => observer.disconnect(), { once: true })
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function drawFrame(canvas: HTMLCanvasElement, elapsed: number, title: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width: w, height: h } = canvas
  ctx.fillStyle = cssVar('--bg-elevated') || '#171a20'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#10b981'
  ctx.beginPath()
  ctx.arc(34, 38, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = cssVar('--fg-muted') || '#a3a7b0'
  ctx.font = '500 22px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('Drift', 52, 38)
  ctx.fillStyle = cssVar('--fg') || '#e8e8e3'
  ctx.font = '600 92px ui-monospace, Menlo, Consolas, monospace'
  ctx.fillText(formatElapsed(elapsed), 26, h / 2 + 8)
  if (title) {
    ctx.fillStyle = cssVar('--fg-muted') || '#a3a7b0'
    ctx.font = '400 26px ui-sans-serif, system-ui, sans-serif'
    let text = title
    while (text.length > 3 && ctx.measureText(text).width > w - 52) text = `${text.slice(0, -2).trimEnd()}…`
    ctx.fillText(text, 26, h - 34)
  }
}

export function useTimerPopout({ session, elapsed, onStop }: { session: StudySession | null | undefined; elapsed: number; onStop: () => void }) {
  const mode = useMemo(() => popoutSupport(), [])
  const [pipRoot, setPipRoot] = useState<HTMLElement | null>(null)
  const [videoActive, setVideoActive] = useState(false)
  const pipWin = useRef<Window | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const latest = useRef({ session, elapsed, onStop })
  useEffect(() => {
    latest.current = { session, elapsed, onStop }
  })

  const openDocument = useCallback(async () => {
    if (!window.documentPictureInPicture || pipWin.current) return
    // One slim row, like the in-app pill. Chrome adds its own title bar with back-to-tab / close.
    const win = await window.documentPictureInPicture.requestWindow({ width: 268, height: 52 })
    pipWin.current = win
    mirrorStyles(win.document)
    const root = win.document.createElement('div')
    win.document.body.append(root)
    win.addEventListener(
      'pagehide',
      () => {
        pipWin.current = null
        setPipRoot(null)
        // closed by hand while studying -> do not pop out next time; ended with the session -> keep
        if (latest.current.session) localStorage.setItem(AUTO_KEY, '0')
      },
      { once: true },
    )
    setPipRoot(root)
    localStorage.setItem(AUTO_KEY, '1')
  }, [])

  const teardownVideo = useCallback(() => {
    const v = video.current
    if (v) {
      v.pause()
      ;(v.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop())
      v.srcObject = null
      v.remove()
    }
    video.current = null
    setVideoActive(false)
  }, [])

  const openVideo = useCallback(async () => {
    if (video.current) return
    const c = canvas.current ?? (canvas.current = document.createElement('canvas'))
    c.width = 480
    c.height = 240
    drawFrame(c, latest.current.elapsed, latest.current.session?.node_title ?? '')
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.setAttribute('playsinline', '')
    v.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none'
    document.body.append(v)
    video.current = v
    v.srcObject = c.captureStream(2)
    const leave = () => {
      teardownVideo()
      if (latest.current.session) localStorage.setItem(AUTO_KEY, '0')
    }
    v.addEventListener('leavepictureinpicture', leave, { once: true })
    v.addEventListener('webkitpresentationmodechanged', () => {
      if (v.webkitPresentationMode === 'inline') leave()
    })
    try {
      await v.play()
      if (typeof v.requestPictureInPicture === 'function') await v.requestPictureInPicture()
      else v.webkitSetPresentationMode?.('picture-in-picture')
      setVideoActive(true)
      localStorage.setItem(AUTO_KEY, '1')
    } catch {
      teardownVideo()
    }
  }, [teardownVideo])

  const open = useCallback(() => {
    if (mode === 'document') openDocument().catch(() => undefined)
    else if (mode === 'video') openVideo()
  }, [mode, openDocument, openVideo])

  const close = useCallback(() => {
    if (pipWin.current) pipWin.current.close()
    else if (video.current) {
      if (document.pictureInPictureElement === video.current) document.exitPictureInPicture().catch(() => undefined)
      else video.current.webkitSetPresentationMode?.('inline')
      teardownVideo()
    }
  }, [teardownVideo])

  // redraw the video frame every second while popped out
  useEffect(() => {
    if (!videoActive) return
    const id = window.setInterval(() => {
      if (canvas.current) drawFrame(canvas.current, latest.current.elapsed, latest.current.session?.node_title ?? '')
    }, 1000)
    return () => window.clearInterval(id)
  }, [videoActive])

  // the session ended -> the pop-out goes away too
  useEffect(() => {
    if (session) return
    if (pipWin.current) pipWin.current.close()
    if (video.current) close()
  }, [session, close])

  // "start session" buttons ask for the pop-out while the click gesture is still fresh
  useEffect(() => {
    const onRequest = () => open()
    window.addEventListener(EVENT, onRequest)
    return () => window.removeEventListener(EVENT, onRequest)
  }, [open])

  useEffect(() => () => pipWin.current?.close(), [])

  const active = pipRoot !== null || videoActive
  const portal = pipRoot ? createPortal(<PopoutContent elapsed={elapsed} title={session?.node_title ?? ''} onStop={onStop} />, pipRoot) : null

  return { mode, active, open, close, portal }
}

function PopoutContent({ elapsed, title, onStop }: { elapsed: number; title: string; onStop: () => void }) {
  return (
    <div className="flex h-screen items-center gap-2.5 overflow-hidden bg-bg-elevated px-3 text-fg select-none">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="font-mono text-[15px] font-semibold tracking-tight tabular-nums">{formatElapsed(elapsed)}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={title}>{title || t('timer.running')}</span>
      <button
        onClick={onStop}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-sunken text-fg-muted transition-colors hover:bg-red-500/15 hover:text-red-500"
        aria-label={t('timer.stop')}
        title={t('timer.stop')}
      >
        <Square className="h-3 w-3 fill-current" />
      </button>
    </div>
  )
}
