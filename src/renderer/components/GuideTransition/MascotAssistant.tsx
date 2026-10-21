import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MiniCam } from '../CaptureArt/CaptureArt'
import { MASCOT_EVENT, type MascotAction, type MascotEventDetail } from '../../lib/mascotEvents'
import styles from './MascotAssistant.module.css'

/**
 * Optional helper (Admin → Maskot Asisten, touch/landscape booth only).
 * Adaptive: each page is a short list of steps; pages report what the customer does (lib/mascotEvents),
 * the mascot reacts to that action and its next tip skips the steps already done.
 * Tap the mascot for the next open step; it also speaks after the page-change act and after a quiet spell.
 * Lines only mention controls that exist on that page.
 */

interface Step {
    line: string
    doneBy?: MascotAction[] // any of these actions completes the step
}

const STEPS: Record<string, Step[]> = {
    '/tutorial': [
        { line: 'Baca langkahnya, lalu ketuk tombol oranye' },
        { line: 'Kalau diam, halaman ini lanjut sendiri' }
    ],
    '/frames': [
        { line: 'Geser kartunya untuk lihat frame lain', doneBy: ['swipe', 'focus'] },
        { line: 'Ketuk frame di tengah untuk memilih' }
    ],
    '/payment': [
        { line: 'Atur jumlah cetak dulu sebelum bayar' },
        { line: 'Ikuti petunjuk pembayaran di layar' }
    ],
    '/capture': [
        { line: 'Ketuk tombol di bawah foto untuk mulai', doneBy: ['countdown'] },
        { line: 'Lihat ke kamera, ada hitung mundur', doneBy: ['shot'] },
        { line: 'Siapkan gaya terbaikmu!' }
    ],
    '/photo-review': [
        { line: 'Geser untuk lihat foto lainnya', doneBy: ['swipe'] },
        { line: 'Kurang pas? Ketuk Ulangi foto ini' },
        { line: 'Sudah oke? Ketuk Lanjut' }
    ],
    '/review': [
        { line: 'Geser kartu untuk coba filter lain', doneBy: ['filter', 'swipe'] },
        { line: 'Mirror membalik hasil kiri-kanan', doneBy: ['mirror'] },
        { line: 'Sudah cocok? Ketuk Lanjutkan' }
    ],
    '/output': [
        { line: 'Geser untuk lihat GIF dan Live Photo', doneBy: ['media', 'swipe'] },
        { line: 'Boleh difoto pakai HP-mu!' },
        { line: 'Ketuk Lanjutkan untuk ambil QR' }
    ],
    '/sharing': [
        { line: 'Scan QR pakai kamera HP' },
        { line: 'Mau dicetak? Ketuk Cetak foto' }
    ],
    '/finalize': [
        { line: 'Cek sekali lagi sebelum dicetak' },
        { line: 'Ketuk tombol putih untuk cetak' }
    ],
    '/printing': [
        { line: 'Ambil cetakanmu di loket, ya' },
        { line: 'Simpan kode ambilnya' }
    ]
}

/** What the mascot says right after an action (null = stay quiet). `count` = times this action happened on this page. */
function react(path: string, type: MascotAction, data: Record<string, string>, count: number): string | null {
    switch (path) {
        case '/frames':
            if (type === 'swipe' || type === 'focus') {
                return count >= 3 ? 'Banyak pilihan, ya! Ketuk yang paling kamu suka' : 'Nah, gitu! Ketuk frame di tengah kalau sudah cocok'
            }
            return null
        case '/photo-review':
            return type === 'swipe' ? 'Ini foto lainnya. Kurang pas? Ketuk Ulangi foto ini' : null
        case '/review':
            if (type === 'filter') return `Filter ${data.name}! ${count >= 3 ? 'Sudah ketemu yang pas?' : 'Cocok? Ketuk Lanjutkan'}`
            if (type === 'mirror') return data.on === 'on' ? 'Mirror nyala, hasilnya dibalik kiri-kanan' : 'Mirror mati, hasilnya normal lagi'
            return null
        case '/output':
            return type === 'media' ? `Ini ${data.title}. Boleh difoto pakai HP-mu!` : null
        case '/capture':
            if (type === 'countdown') return 'Siap-siap... senyum!'
            if (type === 'shot') return count >= 2 ? 'Cekrek! Makin keren' : 'Cekrek! Mantap'
            return null
        default:
            return null
    }
}

const FIRST_TIP_DELAY_MS = 2600 // after the GuideTransition act (2.3 s)
const SETTLE_MS = 1200 // pages initialise filter/mirror/etc. on mount; those are not customer actions
const IDLE_NUDGE_MS = 10000
const BUBBLE_VISIBLE_MS = 5500

export function MascotAssistant(): JSX.Element | null {
    const { pathname } = useLocation()
    const steps = STEPS[pathname]
    const [text, setText] = useState('')
    const [open, setOpen] = useState(false)
    const [hop, setHop] = useState(0) // re-key to replay the hop
    const done = useRef<Set<number>>(new Set())
    const counts = useRef<Partial<Record<MascotAction, number>>>({})
    const tapCursor = useRef(0)
    const enteredAt = useRef(Date.now())
    const hideTimer = useRef<ReturnType<typeof setTimeout>>()
    const idleTimer = useRef<ReturnType<typeof setTimeout>>()

    const say = useCallback((line: string) => {
        setText(line)
        setOpen(true)
        setHop((h) => h + 1)
        clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => setOpen(false), BUBBLE_VISIBLE_MS)
    }, [])

    /** Steps not done yet (falls back to the last step once everything is done). */
    const openSteps = useCallback((): Step[] => {
        if (!steps) return []
        const left = steps.filter((_, i) => !done.current.has(i))
        return left.length ? left : [steps[steps.length - 1]]
    }, [steps])

    // New page: forget progress, offer the first open step once the transition act has played
    useEffect(() => {
        setOpen(false)
        done.current = new Set()
        counts.current = {}
        tapCursor.current = 0
        enteredAt.current = Date.now()
        if (!steps) return
        const t = setTimeout(() => say(openSteps()[0].line), FIRST_TIP_DELAY_MS)
        return () => clearTimeout(t)
    }, [pathname, steps, say, openSteps])

    // React to what the customer just did, and tick off the steps it completes
    useEffect(() => {
        if (!steps) return
        const onAction = (e: Event) => {
            if (Date.now() - enteredAt.current < SETTLE_MS) return
            const { type, data = {} } = (e as CustomEvent<MascotEventDetail>).detail
            counts.current[type] = (counts.current[type] || 0) + 1
            steps.forEach((s, i) => { if (s.doneBy?.includes(type)) done.current.add(i) })
            tapCursor.current = 0
            const line = react(pathname, type, data, counts.current[type]!)
            if (line) say(line)
        }
        window.addEventListener(MASCOT_EVENT, onAction)
        return () => window.removeEventListener(MASCOT_EVENT, onAction)
    }, [pathname, steps, say])

    // Quiet for a while → point at the next open step (re-armed by any touch or key)
    useEffect(() => {
        if (!steps) return
        const arm = () => {
            clearTimeout(idleTimer.current)
            idleTimer.current = setTimeout(() => {
                say(openSteps()[0].line)
                arm()
            }, IDLE_NUDGE_MS)
        }
        arm()
        window.addEventListener('pointerdown', arm)
        window.addEventListener('keydown', arm)
        window.addEventListener(MASCOT_EVENT, arm)
        return () => {
            clearTimeout(idleTimer.current)
            window.removeEventListener('pointerdown', arm)
            window.removeEventListener('keydown', arm)
            window.removeEventListener(MASCOT_EVENT, arm)
        }
    }, [pathname, steps, say, openSteps])

    useEffect(() => () => clearTimeout(hideTimer.current), [])

    if (!steps) return null

    // Tap: walk through the steps still open
    const onTap = () => {
        const left = openSteps()
        say(left[tapCursor.current % left.length].line)
        tapCursor.current++
    }

    return (
        <div className={styles.dock}>
            <AnimatePresence>
                {open && (
                    <motion.div
                        key={text}
                        className={styles.bubble}
                        role="status"
                        initial={{ opacity: 0, scale: 0.7, x: 16 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.85, x: 8 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                    >
                        {text}
                    </motion.div>
                )}
            </AnimatePresence>
            <motion.button
                key={hop}
                type="button"
                className={styles.mascot}
                aria-label="Bantuan maskot"
                onTap={onTap}
                initial={{ y: 0, rotate: 0 }}
                animate={hop ? { y: [0, -22, 0, -6, 0], rotate: [0, -8, 6, -2, 0] } : {}}
                transition={{ duration: 0.7, ease: 'easeOut' }}
            >
                <MiniCam />
                <span className={styles.help} aria-hidden="true">?</span>
            </motion.button>
        </div>
    )
}
