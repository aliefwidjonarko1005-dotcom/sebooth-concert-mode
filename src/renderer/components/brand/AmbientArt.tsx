import { useEffect, useRef } from 'react'
import type { AmbientArtSettings, AmbientStyle } from '@shared/types'

export type { AmbientArtSettings, AmbientStyle }

/**
 * Abstract 2D gradient animation drawn on a canvas. Used as the homepage backdrop and,
 * when the live camera background is on, as a translucent overlay above the camera feed.
 * Cheap on purpose: renders at reduced resolution and ~30 fps so it never competes with capture.
 */

export const DEFAULT_AMBIENT_ART: AmbientArtSettings = {
    enabled: true,
    style: 'aurora',
    colors: ['#ff4500', '#fe6b00', '#5b8cff'],
    opacity: 0.85,
    liveOpacity: 0.35,
    speed: 1
}

export const AMBIENT_PALETTES: { name: string; colors: [string, string, string] }[] = [
    { name: 'Sebooth', colors: ['#ff4500', '#fe6b00', '#5b8cff'] },
    { name: 'Senja', colors: ['#ff4500', '#ff2d78', '#ffb800'] },
    { name: 'Laut', colors: ['#00c2ff', '#5b8cff', '#00e0b0'] },
    { name: 'Malam', colors: ['#00113a', '#1d43c4', '#ff4500'] },
    { name: 'Putih', colors: ['#ffffff', '#c7d4ff', '#ffd9c7'] }
]

const RENDER_SCALE = 0.6
const FRAME_MS = 1000 / 30

const withAlpha = (hex: string, a: number): string => {
    const h = hex.replace('#', '')
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Deterministic pseudo-random so shapes keep their layout across re-renders
const rand = (seed: number): number => {
    const x = Math.sin(seed * 9301 + 49297) * 233280
    return x - Math.floor(x)
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, c: [string, string, string]) => void

const drawAurora: Draw = (ctx, w, h, t, c) => {
    const m = Math.min(w, h)
    for (let i = 0; i < 6; i++) {
        const color = c[i % 3]
        const x = w * (0.5 + 0.38 * Math.sin(t * (0.11 + i * 0.023) + i * 1.7))
        const y = h * (0.5 + 0.36 * Math.cos(t * (0.09 + i * 0.019) + i * 2.3))
        const r = m * (0.38 + 0.12 * Math.sin(t * 0.2 + i))
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, withAlpha(color, 0.75))
        g.addColorStop(0.55, withAlpha(color, 0.25))
        g.addColorStop(1, withAlpha(color, 0))
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
    }
}

const SHAPE_COUNT = 16

const drawShapes: Draw = (ctx, w, h, t, c) => {
    const m = Math.min(w, h)
    for (let i = 0; i < SHAPE_COUNT; i++) {
        const size = m * (0.05 + rand(i) * 0.11)
        const drift = (rand(i + 50) * 0.04 + 0.015) * t
        const x = w * ((rand(i + 10) + 0.03 * Math.sin(t * 0.3 + i)) % 1)
        // float upward and wrap around the top edge
        const y = (((rand(i + 20) - drift) % 1) + 1) % 1 * (h + size * 2) - size
        const rot = t * (rand(i + 30) - 0.5) * 0.6 + i
        const a = c[i % 3]
        const b = c[(i + 1) % 3]
        const g = ctx.createLinearGradient(-size, -size, size, size)
        g.addColorStop(0, withAlpha(a, 0.95))
        g.addColorStop(1, withAlpha(b, 0.95))

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rot)
        ctx.fillStyle = g
        ctx.strokeStyle = g
        ctx.lineCap = 'round'
        switch (i % 6) {
            case 0: // ring
                ctx.lineWidth = size * 0.28
                ctx.beginPath()
                ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2)
                ctx.stroke()
                break
            case 1: // half moon
                ctx.beginPath()
                ctx.arc(0, 0, size, 0, Math.PI)
                ctx.closePath()
                ctx.fill()
                break
            case 2: // squiggle
                ctx.lineWidth = size * 0.22
                ctx.beginPath()
                for (let k = 0; k <= 24; k++) {
                    const px = -size * 1.4 + (k / 24) * size * 2.8
                    const py = Math.sin(k / 24 * Math.PI * 3 + t) * size * 0.35
                    if (k === 0) ctx.moveTo(px, py)
                    else ctx.lineTo(px, py)
                }
                ctx.stroke()
                break
            case 3: // plus
                ctx.lineWidth = size * 0.3
                ctx.beginPath()
                ctx.moveTo(-size * 0.6, 0); ctx.lineTo(size * 0.6, 0)
                ctx.moveTo(0, -size * 0.6); ctx.lineTo(0, size * 0.6)
                ctx.stroke()
                break
            case 4: // rounded blob square
                ctx.beginPath()
                ctx.roundRect(-size * 0.7, -size * 0.7, size * 1.4, size * 1.4, size * 0.45)
                ctx.fill()
                break
            default: // dot
                ctx.beginPath()
                ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2)
                ctx.fill()
        }
        ctx.restore()
    }
}

const drawWaves: Draw = (ctx, w, h, t, c) => {
    for (let layer = 0; layer < 4; layer++) {
        const color = c[layer % 3]
        const base = h * (0.62 + layer * 0.09)
        const amp = h * (0.05 + 0.02 * layer)
        const freq = (1.2 + layer * 0.35) * Math.PI * 2 / w
        const phase = t * (0.35 + layer * 0.12) * (layer % 2 ? -1 : 1)
        const g = ctx.createLinearGradient(0, base - amp, 0, h)
        g.addColorStop(0, withAlpha(color, 0.85))
        g.addColorStop(1, withAlpha(color, 0.05))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(0, h)
        for (let x = 0; x <= w; x += 8) {
            ctx.lineTo(x, base + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 0.5 + phase * 1.7) * amp * 0.4)
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fill()
    }
}

const DRAWERS: Record<AmbientStyle, Draw> = { aurora: drawAurora, shapes: drawShapes, waves: drawWaves }

interface AmbientArtProps {
    settings: AmbientArtSettings
    /** Over the live camera: uses liveOpacity and a screen blend so faces stay visible */
    overCamera?: boolean
    className?: string
    style?: React.CSSProperties
}

export function AmbientArt({ settings, overCamera = false, className, style }: AmbientArtProps): JSX.Element | null {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const settingsRef = useRef(settings)
    settingsRef.current = settings

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const resize = () => {
            const rect = canvas.getBoundingClientRect()
            canvas.width = Math.max(1, Math.round(rect.width * RENDER_SCALE))
            canvas.height = Math.max(1, Math.round(rect.height * RENDER_SCALE))
        }
        resize()
        const ro = new ResizeObserver(resize)
        ro.observe(canvas)

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        let raf = 0
        let last = 0
        let t = 0
        const loop = (now: number) => {
            raf = requestAnimationFrame(loop)
            if (now - last < FRAME_MS) return
            const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
            last = now
            const s = settingsRef.current
            if (!reduced) t += dt * s.speed
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            DRAWERS[s.style]?.(ctx, canvas.width, canvas.height, t, s.colors)
        }
        raf = requestAnimationFrame(loop)
        return () => {
            cancelAnimationFrame(raf)
            ro.disconnect()
        }
    }, [settings.enabled])

    if (!settings.enabled) return null

    return (
        <canvas
            ref={canvasRef}
            aria-hidden="true"
            className={className}
            style={{
                width: '100%',
                height: '100%',
                display: 'block',
                pointerEvents: 'none',
                opacity: overCamera ? settings.liveOpacity : settings.opacity,
                mixBlendMode: overCamera ? 'screen' : 'normal',
                ...style
            }}
        />
    )
}
