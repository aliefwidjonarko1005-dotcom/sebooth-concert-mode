import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MiniCam } from '../CaptureArt/CaptureArt'
import styles from './GuideTransition.module.css'

/**
 * The mascot as the booth's guide (touch / landscape booth only): on every page change it plays a
 * short act that "opens" the next page, with a one-line speech bubble about what to do there.
 *   curtain : stage curtains are closed, the mascot pops up and pulls them apart
 *   flash   : the mascot takes a picture; the white flash fades into the camera page
 *   print   : a giant photo strip covers the page and is pushed out the top by the mascot
 * Non-blocking for touch (pointer-events none), 2.3 s (touch) / 1.6 s (buttons, keys held meanwhile), skipped for reduced motion and on admin/loket/gallery/home.
 */

type Act = 'curtain' | 'flash' | 'print'

const SCRIPT: Record<string, { act: Act; line: string }> = {
    '/tutorial': { act: 'curtain', line: 'Halo! Aku pandu, ya' },
    '/frames': { act: 'curtain', line: 'Pilih frame favoritmu!' },
    '/payment': { act: 'curtain', line: 'Bayar dulu, yuk' },
    '/capture': { act: 'flash', line: 'Siap? Senyum!' },
    '/photo-review': { act: 'print', line: 'Cek fotomu dulu' },
    '/review': { act: 'curtain', line: 'Waktunya pilih filter' },
    '/output': { act: 'print', line: 'Taraa, hasilnya!' },
    '/sharing': { act: 'curtain', line: 'Scan buat simpan' },
    '/finalize': { act: 'print', line: 'Siap dicetak?' },
    '/printing': { act: 'print', line: 'Lagi dicetak...' }
}


export function GuideTransition({ enabled, pace = 2.3, holdKeys = false }: { enabled: boolean; pace?: number; holdKeys?: boolean }): JSX.Element | null {
    const location = useLocation()
    const reduce = useReducedMotion()
    const prevPath = useRef(location.pathname)
    const [run, setRun] = useState<{ key: number; act: Act; line: string } | null>(null)

    useEffect(() => {
        const from = prevPath.current
        const to = location.pathname
        prevPath.current = to
        if (!enabled || reduce || from === to) return
        // A route without a scene (e.g. /printing bouncing straight to /) ends the running act
        const scene = SCRIPT[to]
        setRun(scene ? { key: Date.now(), ...scene } : null)
    }, [location.pathname, enabled, reduce])

    // The end timer belongs to the act, not to the route: a quick second navigation must not cancel it,
    // or the act (and the button hold below) stays on screen until a reload
    useEffect(() => {
        if (!run) return
        const t = setTimeout(() => setRun(null), pace * 1000 + 50)
        return () => clearTimeout(t)
    }, [run, pace])

    // Button booth: while the act covers the new page, physical 1/2/3 must not act on it unseen
    useEffect(() => {
        if (!run || !holdKeys) return
        const swallow = (e: KeyboardEvent) => {
            if (e.key !== '1' && e.key !== '2' && e.key !== '3') return
            e.preventDefault()
            e.stopImmediatePropagation()
        }
        window.addEventListener('keydown', swallow, true)
        return () => window.removeEventListener('keydown', swallow, true)
    }, [run, holdKeys])

    return (
        <AnimatePresence>
            {run && (
                <PaceContext.Provider key={run.key} value={pace}>
                <div className={styles.stage} aria-hidden="true">
                    {run.act === 'curtain' && <Curtains />}
                    {run.act === 'flash' && <Flash />}
                    {run.act === 'print' && <PrintCover />}
                    <Guide act={run.act} line={run.line} />
                </div>
                </PaceContext.Provider>
            )}
        </AnimatePresence>
    )
}

/*
 * One shared timeline, in seconds, so every act lands on the mascot's beat:
 *   0.00–0.60  the guide pops up (small overshoot) and settles
 *   0.35–0.60  the bubble opens; it stays readable until ~1.70
 *   0.95–1.45  the act: tug / snap / push (the guide squashes on 1.05)
 *   0.95–1.85  the curtains part / the flash fades / the print feeds out
 *   1.85–2.30  the guide ducks out
 */
const T = 2.3
const at = (...secs: number[]): number[] => secs.map((s) => s / T)
const SOFT = [0.45, 0, 0.2, 1] as const // gentle in, long settle

// Seconds the whole act lasts. Keyframe times are fractions of the base timeline (at()), so a shorter
// pace plays the same beats faster (portrait button booth: people press quickly).
const PaceContext = createContext(T)

function CurtainPanel({ side }: { side: 'left' | 'right' }) {
    const pace = useContext(PaceContext)
    const out = side === 'left' ? '-104%' : '104%'
    const tug = side === 'left' ? '4%' : '-4%'
    return (
        <motion.div
            className={`${styles.curtain} ${side === 'left' ? styles.curtainLeft : styles.curtainRight}`}
            initial={{ x: 0 }}
            // Held shut while the guide grabs the seam, a small tug inward, then drawn open
            animate={{ x: ['0%', '0%', tug, out, out] }}
            transition={{ duration: pace, times: at(0, 0.95, 1.12, 1.85, T), ease: ['linear', 'easeOut', SOFT, 'linear'] }}
        >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles.folds}>
                {[10, 30, 50, 70, 90].map((x) => (
                    <rect key={x} x={x - 4} y="0" width="8" height="100" fill="rgba(0,17,58,0.18)" />
                ))}
            </svg>
        </motion.div>
    )
}

function Curtains() {
    const pace = useContext(PaceContext)
    return (
        <>
            <CurtainPanel side="left" />
            <CurtainPanel side="right" />
            {/* Valance: the scalloped top stays a beat longer, then lifts away */}
            <motion.div
                className={styles.valance}
                initial={{ y: 0 }}
                animate={{ y: ['0%', '0%', '-120%', '-120%'] }}
                transition={{ duration: pace, times: at(0, 1.5, 2.0, T), ease: ['linear', 'easeIn', 'linear'] }}
            >
                <svg viewBox="0 0 1200 96" preserveAspectRatio="none" className={styles.valanceSvg}>
                    <path
                        d={`M0 0 H1200 V60 ${Array.from({ length: 12 }, (_, i) => `Q${1150 - i * 100} 100 ${1100 - i * 100} 60`).join(' ')} Z`}
                        fill="var(--brand-ink)"
                    />
                </svg>
            </motion.div>
        </>
    )
}

function Flash() {
    const pace = useContext(PaceContext)
    return (
        <>
            {/* Stage hides the cut until the snap */}
            <motion.div
                className={styles.printBackdrop}
                initial={{ opacity: 1 }}
                animate={{ opacity: [1, 1, 0, 0] }}
                transition={{ duration: pace, times: at(0, 1.02, 1.04, T) }}
            />
            {/* The snap: white pops on the squash and fades slowly into the camera page */}
            <motion.div
                className={styles.flash}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0, 1, 0, 0] }}
                transition={{ duration: pace, times: at(0, 0.98, 1.06, 1.9, T), ease: ['linear', 'easeOut', SOFT, 'linear'] }}
            />
        </>
    )
}

function PrintCover() {
    const pace = useContext(PaceContext)
    return (
        <>
            {/* Stage behind the print: hides the page, then fades as the paper feeds out */}
            <motion.div
                className={styles.printBackdrop}
                initial={{ opacity: 1 }}
                animate={{ opacity: [1, 1, 0, 0] }}
                transition={{ duration: pace, times: at(0, 1.15, 1.8, T), ease: ['linear', SOFT, 'linear'] }}
            />
            <motion.div
                className={styles.print}
                initial={{ y: '0%', rotate: 0 }}
                // Paper feeds up and out of the top when the guide pushes
                animate={{ y: ['0%', '0%', '-118%', '-118%'], rotate: [0, 0, -4, -4] }}
                transition={{ duration: pace, times: at(0, 0.98, 1.8, T), ease: ['linear', SOFT, 'linear'] }}
            >
                <div className={styles.printFrame} style={{ background: 'var(--brand-royal)' }} />
                <div className={styles.printFrame} style={{ background: 'var(--brand-orange)' }} />
                <div className={styles.printFrame} style={{ background: 'var(--brand-sun)' }} />
            </motion.div>
        </>
    )
}

function Guide({ act, line }: { act: Act; line: string }) {
    const pace = useContext(PaceContext)
    // The beat: squash at 1.05 s (the pull / snap / push), stretch back, settle
    const beat = at(0, 0.95, 1.05, 1.25, 1.45, T)
    return (
        <motion.div
            className={styles.guide}
            initial={{ y: '140%' }}
            animate={{
                y: ['140%', '-6%', '0%', '0%', '160%'],
                scaleY: act === 'flash' ? [1, 1, 0.84, 1.07, 1, 1] : [1, 1, 0.88, 1.06, 1, 1],
                rotate: act === 'curtain' ? [0, 0, -7, 5, 0, 0] : [0, 0, 0, 0, 0, 0]
            }}
            transition={{
                y: { duration: pace, times: at(0, 0.45, 0.62, 1.85, T), ease: ['easeOut', 'easeInOut', 'linear', 'easeIn'] },
                scaleY: { duration: pace, times: beat, ease: 'easeInOut' },
                rotate: { duration: pace, times: beat, ease: 'easeInOut' }
            }}
        >
            <motion.div
                className={styles.bubble}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.6, 0.6, 1, 1, 0.92] }}
                transition={{ duration: pace, times: at(0, 0.35, 0.58, 1.7, 1.95), ease: 'easeOut' }}
            >
                {line}
            </motion.div>
            <div className={styles.cam}>
                <MiniCam />
            </div>
        </motion.div>
    )
}
