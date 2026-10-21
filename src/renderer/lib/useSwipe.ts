import { animate, useMotionValue, type MotionValue, type PanInfo } from 'framer-motion'
import { emitMascot } from './mascotEvents'

export interface SwipeProps {
    style: { x: MotionValue<number>; touchAction: 'pan-y' }
    onPan: (e: PointerEvent, info: PanInfo) => void
    onPanEnd: (e: PointerEvent, info: PanInfo) => void
}

/**
 * Horizontal swipe for a carousel (touch booth). Spread the result on a motion element that wraps the
 * track: it follows the finger, and on release either fires onPrev/onNext (far or fast enough) or not,
 * then springs back to 0 while the cards spring to their new slots, so the move reads as one glide.
 * Returns {} when disabled, so portrait/button mode keeps its plain track.
 */
export function useSwipe(onPrev: () => void, onNext: () => void, enabled: boolean, threshold = 70): SwipeProps | Record<string, never> {
    const x = useMotionValue(0)
    if (!enabled) return {}
    return {
        style: { x, touchAction: 'pan-y' },
        // Damped follow: the track lags the finger a little, which feels like dragging a real strip
        onPan: (_e, info) => x.set(info.offset.x * 0.6),
        onPanEnd: (_e, info) => {
            const goNext = info.offset.x < -threshold || info.velocity.x < -500
            const goPrev = info.offset.x > threshold || info.velocity.x > 500
            if (goNext) {
                onNext()
                emitMascot('swipe', { dir: 'next' })
            } else if (goPrev) {
                onPrev()
                emitMascot('swipe', { dir: 'prev' })
            }
            animate(x, 0, { type: 'spring', stiffness: 260, damping: 30 })
        }
    }
}
