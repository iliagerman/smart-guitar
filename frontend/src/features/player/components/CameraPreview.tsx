import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Video, X } from 'lucide-react'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import { cn } from '@/lib/cn'

interface CameraPreviewProps {
  stream: MediaStream | null
}

const PREVIEW_W = 120
const PREVIEW_H = 90
const FAB_SIZE = 40
const EDGE_PADDING = 8

function clampPosition(
  x: number,
  y: number,
  elW: number,
  elH: number,
): { x: number; y: number } {
  const maxX = window.innerWidth - elW - EDGE_PADDING
  const maxY = window.innerHeight - elH - EDGE_PADDING
  return {
    x: Math.max(EDGE_PADDING, Math.min(x, maxX)),
    y: Math.max(EDGE_PADDING, Math.min(y, maxY)),
  }
}

function defaultPosition(minimized: boolean): { x: number; y: number } {
  const w = minimized ? FAB_SIZE : PREVIEW_W
  const h = minimized ? FAB_SIZE : PREVIEW_H
  return {
    x: window.innerWidth - w - 16,
    y: window.innerHeight - h - 96,
  }
}

/**
 * Draggable floating camera preview shown during video recording.
 * Can be minimized to a small FAB and expanded back.
 * Position and minimized state persist across songs via player-prefs store.
 */
export function CameraPreview({ stream }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const minimized = usePlayerPrefsStore((s) => s.cameraPreviewMinimized)
  const savedPosition = usePlayerPrefsStore((s) => s.cameraPreviewPosition)
  const setPosition = usePlayerPrefsStore((s) => s.setCameraPreviewPosition)
  const setMinimized = usePlayerPrefsStore((s) => s.setCameraPreviewMinimized)

  const initialPos = useMemo(() => {
    if (savedPosition) {
      const w = minimized ? FAB_SIZE : PREVIEW_W
      const h = minimized ? FAB_SIZE : PREVIEW_H
      return clampPosition(savedPosition.x, savedPosition.y, w, h)
    }
    return defaultPosition(minimized)
    // Only compute once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [pos, setPos] = useState(initialPos)
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number; dragged: boolean } | null>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream, minimized])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      dragged: false,
    }
  }, [pos])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragState.current.dragged = true
    }
    const w = minimized ? FAB_SIZE : PREVIEW_W
    const h = minimized ? FAB_SIZE : PREVIEW_H
    const newPos = clampPosition(
      dragState.current.originX + dx,
      dragState.current.originY + dy,
      w,
      h,
    )
    setPos(newPos)
  }, [minimized])

  const handlePointerUp = useCallback(() => {
    if (!dragState.current) return
    if (dragState.current.dragged) {
      setPosition(pos)
    }
    dragState.current = null
  }, [pos, setPosition])

  const handleMinimize = useCallback(() => {
    setMinimized(true)
    const newPos = clampPosition(pos.x, pos.y, FAB_SIZE, FAB_SIZE)
    setPos(newPos)
    setPosition(newPos)
  }, [pos, setMinimized, setPosition])

  const handleExpand = useCallback(() => {
    setMinimized(false)
    const newPos = clampPosition(pos.x, pos.y, PREVIEW_W, PREVIEW_H)
    setPos(newPos)
    setPosition(newPos)
  }, [pos, setMinimized, setPosition])

  if (!stream) return null

  if (minimized) {
    return createPortal(
      <div
        className={cn(
          'fixed z-50 flex items-center justify-center rounded-full',
          'bg-red-600 shadow-lg shadow-red-500/30 cursor-grab active:cursor-grabbing',
          'touch-none select-none',
        )}
        style={{ left: pos.x, top: pos.y, width: FAB_SIZE, height: FAB_SIZE }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        data-testid="camera-preview-fab"
      >
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-400 animate-pulse" />
        <button
          onClick={(e) => {
            if (dragState.current?.dragged) return
            e.stopPropagation()
            handleExpand()
          }}
          className="flex items-center justify-center w-full h-full"
          aria-label="Expand camera preview"
          data-testid="camera-preview-expand-button"
        >
          <Video size={18} className="text-white" />
        </button>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      className={cn(
        'fixed z-50 overflow-hidden rounded-xl border-2 border-red-500',
        'shadow-lg shadow-red-500/20 cursor-grab active:cursor-grabbing',
        'touch-none select-none',
      )}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      data-testid="camera-preview"
    >
      <div className="absolute top-1.5 left-2 flex items-center gap-1.5 z-10">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[10px] font-mono text-white drop-shadow-md">REC</span>
      </div>
      <button
        onClick={(e) => {
          if (dragState.current?.dragged) return
          e.stopPropagation()
          handleMinimize()
        }}
        className={cn(
          'absolute top-1 right-1 z-10 flex items-center justify-center',
          'w-6 h-6 rounded-full bg-black/50 hover:bg-black/70 transition-colors',
        )}
        aria-label="Minimize camera preview"
        data-testid="camera-preview-minimize-button"
      >
        <X size={14} className="text-white" />
      </button>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-[90px] w-[120px] object-cover -scale-x-100"
      />
    </div>,
    document.body,
  )
}
