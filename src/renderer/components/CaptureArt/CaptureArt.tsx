import styles from './CaptureArt.module.css'

/**
 * Flat 2D "sticker cartoon" art for the capture page: thick ink outlines, flat fills,
 * hard offset shadows, no gradients. Every object is inline SVG; motion is CSS (transform/opacity only)
 * so it stays cheap next to the live preview and is switched off for prefers-reduced-motion.
 */

const INK = '#00113a'
const SUN = '#ffc928'
const ORANGE = '#ff4500'
const ROYAL = '#1d43c4'
const WHITE = '#ffffff'

/** Star polygon points around (cx, cy) alternating outer/inner radius. */
function burstPoints(points: number, outer: number, inner: number, cx = 100, cy = 100, wobble = 0): string {
    const out: string[] = []
    for (let i = 0; i < points * 2; i++) {
        const angle = (Math.PI * i) / points - Math.PI / 2
        // Deterministic jitter gives the hand-cut comic look
        const jitter = wobble ? (Math.sin(i * 12.9898) * 0.5 + 0.5) * wobble : 0
        const r = i % 2 === 0 ? outer - jitter : inner
        out.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`)
    }
    return out.join(' ')
}

const COUNT_BURST = burstPoints(14, 96, 74, 100, 100, 8)
const SNAP_BURST = burstPoints(18, 98, 70, 100, 100, 14)

/** Cartoon camera whose lens is the Sebooth logo's googly eyes. */
export function MiniCam(): JSX.Element {
    return (
        <svg viewBox="0 0 220 170" aria-hidden="true">
            <rect x="62" y="14" width="62" height="34" rx="10" fill={ORANGE} stroke={INK} strokeWidth="10" />
            <rect x="12" y="38" width="196" height="120" rx="26" fill={WHITE} stroke={INK} strokeWidth="10" />
            <circle cx="80" cy="98" r="34" fill={WHITE} stroke={INK} strokeWidth="10" />
            <circle cx="148" cy="98" r="34" fill={WHITE} stroke={INK} strokeWidth="10" />
            <circle className={styles.pupil} cx="88" cy="102" r="14" fill={INK} />
            <circle className={styles.pupil} cx="156" cy="102" r="14" fill={INK} />
            <circle cx="182" cy="60" r="8" fill={ORANGE} stroke={INK} strokeWidth="6" />
        </svg>
    )
}

/**
 * Shared kiosk stage: flat royal field with one mascot, the Sebooth logo's googly-eyed camera,
 * peeking in from the bottom-left corner. One subject-specific character instead of generic confetti.
 */
export function CartoonBackdrop({ lively = false, mascot = true }: { lively?: boolean; mascot?: boolean }): JSX.Element {
    return (
        <div className={styles.backdrop} aria-hidden="true">
            {lively && <FilmRibbon />}
            {lively && (
                <div className={styles.printer}>
                    <Printer />
                </div>
            )}
            {/* Hidden when the tappable MascotAssistant takes the corner */}
            {mascot && (
                <div className={styles.mascot}>
                    <MiniCam />
                    {lively && <FlashPop />}
                </div>
            )}
        </div>
    )
}

/**
 * Booth-world motion for the touch (landscape) stage, behind content:
 * film advancing along the bottom edge, a mini printer pushing out a strip, the mascot taking a picture.
 */
function FilmRibbon() {
    const frames = Array.from({ length: 28 })
    return (
        <div className={styles.film}>
            <div className={styles.filmTrack}>
                {[0, 1].map((copy) => (
                    <svg key={copy} viewBox="0 0 1400 70" preserveAspectRatio="none" className={styles.filmStrip}>
                        <rect width="1400" height="70" fill={INK} />
                        {frames.map((_, i) => (
                            <g key={i}>
                                <rect x={i * 50 + 12} y="6" width="22" height="9" rx="2" fill={ROYAL} />
                                <rect x={i * 50 + 12} y="55" width="22" height="9" rx="2" fill={ROYAL} />
                            </g>
                        ))}
                        {Array.from({ length: 7 }).map((_, i) => (
                            <rect key={i} x={i * 200 + 18} y="20" width="164" height="30" rx="4"
                                fill={i % 3 === 0 ? ORANGE : i % 3 === 1 ? SUN : WHITE} opacity="0.85" />
                        ))}
                    </svg>
                ))}
            </div>
        </div>
    )
}

function Printer() {
    return (
        <svg viewBox="0 0 200 220" aria-hidden="true">
            {/* the strip slides up out of the slot, then drops back in (CSS) */}
            <g className={styles.printOut}>
                <rect x="62" y="20" width="76" height="120" rx="4" fill={WHITE} stroke={INK} strokeWidth="7" />
                <rect x="72" y="30" width="56" height="30" fill={ROYAL} />
                <rect x="72" y="66" width="56" height="30" fill={ORANGE} />
                <rect x="72" y="102" width="56" height="30" fill={SUN} />
            </g>
            <rect x="20" y="120" width="160" height="86" rx="18" fill={ORANGE} stroke={INK} strokeWidth="8" />
            <rect x="52" y="132" width="96" height="12" rx="6" fill={INK} />
            <circle cx="150" cy="176" r="10" fill={SUN} stroke={INK} strokeWidth="5" className={styles.printerLed} />
            <rect x="40" y="166" width="70" height="10" rx="5" fill={INK} opacity="0.35" />
        </svg>
    )
}

/** Flash burst + sparks on the mascot's top-right corner, every few seconds. */
function FlashPop() {
    return (
        <svg viewBox="0 0 120 120" className={styles.flash} aria-hidden="true">
            <polygon points="60,4 70,46 112,40 76,62 98,104 60,78 22,104 44,62 8,40 50,46" fill={WHITE} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
            <circle cx="60" cy="60" r="12" fill={SUN} />
        </svg>
    )
}

/** Countdown digit inside a spinning orange starburst. Re-key it per number to replay the pop. */
export function CountdownBurst({ value }: { value: number }): JSX.Element {
    return (
        <div className={styles.countBurst}>
            <svg className={styles.countBurstShape} viewBox="0 0 200 200" aria-hidden="true">
                <polygon points={COUNT_BURST} transform="translate(8 10)" fill={INK} />
                <polygon points={COUNT_BURST} fill={ORANGE} stroke={INK} strokeWidth="7" strokeLinejoin="round" />
            </svg>
            <span className={`kiosk-num ${styles.countDigit}`}>{value}</span>
        </div>
    )
}

/** Comic "Cekrek!" burst shown over the white flash while the shutter fires. */
export function SnapBurst(): JSX.Element {
    return (
        <div className={styles.snap} role="status">
            <svg viewBox="0 0 200 200" className={styles.snapShape} aria-hidden="true">
                <polygon points={SNAP_BURST} transform="translate(7 9)" fill={INK} />
                <polygon points={SNAP_BURST} fill={SUN} stroke={INK} strokeWidth="6" strokeLinejoin="round" />
                <polygon points={burstPoints(18, 62, 50, 100, 100, 6)} fill={WHITE} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
            </svg>
            <span className={styles.snapText}>Cekrek!</span>
            <svg viewBox="0 0 300 300" className={styles.snapLines} aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => (
                    <line
                        key={i}
                        x1="150" y1="18" x2="150" y2="52"
                        stroke={i % 2 ? ROYAL : INK} strokeWidth="10" strokeLinecap="round"
                        transform={`rotate(${i * 30} 150 150)`}
                    />
                ))}
            </svg>
        </div>
    )
}

/** Cartoon hourglass (queue idle). The sand tips over on a loop via CSS. */
export function Hourglass({ className }: { className?: string }): JSX.Element {
    return (
        <svg viewBox="0 0 160 200" className={`${styles.hourglass} ${className || ''}`} aria-hidden="true">
            <rect x="20" y="10" width="120" height="22" rx="8" fill={ORANGE} stroke={INK} strokeWidth="8" />
            <rect x="20" y="168" width="120" height="22" rx="8" fill={ORANGE} stroke={INK} strokeWidth="8" />
            <path d="M36 32 H124 C124 72 92 84 92 100 C92 116 124 128 124 168 H36 C36 128 68 116 68 100 C68 84 36 72 36 32 Z"
                fill={WHITE} stroke={INK} strokeWidth="8" strokeLinejoin="round" />
            <path className={styles.sandTop} d="M52 52 H108 C104 72 86 80 80 92 C74 80 56 72 52 52 Z" fill={SUN} />
            <path className={styles.sandBottom} d="M80 112 L106 156 H54 Z" fill={SUN} />
        </svg>
    )
}
