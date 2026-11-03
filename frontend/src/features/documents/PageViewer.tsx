import { ChevronLeft, ChevronRight, Crop, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useRef, useState, type PointerEvent } from 'react'

import { pageImageUrl } from '@/api/documents'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/misc'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export interface Overlay {
  id: string
  bbox: number[]
  label?: string
  active?: boolean
}

interface Props {
  documentId: number
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  overlays: Overlay[]
  /** Called with a normalised bbox when the user finishes drawing a rectangle. */
  onDraw?: (bbox: number[]) => void
  drawEnabled: boolean
  onToggleDraw: () => void
  onOverlayClick?: (id: string) => void
}

export function PageViewer({ documentId, page, pageCount, onPageChange, overlays, onDraw, drawEnabled, onToggleDraw, onOverlayClick }: Props) {
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const imgWrap = useRef<HTMLDivElement>(null)

  const norm = useCallback((e: PointerEvent) => {
    const rect = imgWrap.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) }
  }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!drawEnabled || !imgWrap.current) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const p = norm(e)
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const p = norm(e)
    setDrag({ ...drag, x1: p.x, y1: p.y })
  }
  const onPointerUp = () => {
    if (!drag) return
    const bbox = [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)]
    setDrag(null)
    if (bbox[2] - bbox[0] > 0.02 && bbox[3] - bbox[1] > 0.02) onDraw?.(bbox)
  }

  const rectStyle = (b: number[]) => ({ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b bg-bg-elevated/80 px-2 py-1.5">
        <Button size="icon-sm" variant="ghost" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[90px] text-center text-xs text-fg-muted tabular-nums">{t('review.page', { n: page, total: pageCount })}</span>
        <Button size="icon-sm" variant="ghost" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-line" />
        <Tooltip content={t('review.zoomOut')}>
          <Button size="icon-sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={t('review.zoomIn')}>
          <Button size="icon-sm" variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </Tooltip>
        <span className="mx-1 h-5 w-px bg-line" />
        <Tooltip content={t('review.addFigure')}>
          <Button size="sm" variant={drawEnabled ? 'primary' : 'outline'} onClick={onToggleDraw}>
            <Crop className="h-3.5 w-3.5" /> {t('review.figures')}
          </Button>
        </Tooltip>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-bg-sunken p-3">
        <div
          ref={imgWrap}
          className={cn('relative mx-auto bg-white shadow-card select-none', drawEnabled && 'cursor-crosshair')}
          style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? 900 : undefined, touchAction: drawEnabled ? 'none' : 'auto' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          <img src={pageImageUrl(documentId, page, 2)} alt={t('review.page', { n: page, total: pageCount })} className="block h-auto w-full" draggable={false} />
          {overlays.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); onOverlayClick?.(o.id) }}
              className={cn('absolute rounded-sm border-2 transition-colors', o.active ? 'border-accent bg-accent/10' : 'border-amber-500/70 bg-amber-400/10 hover:bg-amber-400/20')}
              style={{ ...rectStyle(o.bbox), pointerEvents: drawEnabled ? 'none' : 'auto' }}
              aria-label={o.label}
            >
              {o.label && <span className="absolute -top-5 left-0 rounded bg-fg px-1 text-[10px] whitespace-nowrap text-bg">{o.label}</span>}
            </button>
          ))}
          {drag && (
            <div className="pointer-events-none absolute border-2 border-dashed border-accent bg-accent/10" style={rectStyle([Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)])} />
          )}
        </div>
        {drawEnabled && <p className="mt-2 text-center text-xs text-fg-muted">{drag ? t('review.drawing') : t('review.addFigure')}</p>}
      </div>
    </div>
  )
}
