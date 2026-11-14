import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSessionStore, useAppConfig } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { SeboothLogo } from '../components/brand/SeboothLogo'
import { useButtonHints, useInputMode } from '../components/ButtonRail/ButtonRail'
import styles from './FinalizePage.module.css'

const AUTO_PRINT_SECONDS = 20

/**
 * Flipbook package: plays the burst back as a flip preview, then prints every sheet in order.
 * Frames come from CaptureSession via router state. Key 3 = print (auto after AUTO_PRINT_SECONDS).
 */
function FlipbookPage(): JSX.Element | null {
    const navigate = useNavigate()
    const location = useLocation()
    const frames: string[] = location.state?.frames || []
    const { endSession } = useSessionStore()
    const { config } = useAppConfig()

    const [sheets, setSheets] = useState<string[]>([])
    const [previews, setPreviews] = useState<string[]>([])
    const [index, setIndex] = useState(0)
    const [status, setStatus] = useState<'building' | 'ready' | 'printing' | 'done'>('building')
    const [error, setError] = useState<string | null>(null)
    const printStarted = useRef(false)

    const goHome = useCallback((delayMs: number) => {
        setTimeout(() => {
            endSession()
            navigate(config.queueEnabled && config.queueEventId ? '/queue' : '/')
        }, delayMs)
    }, [endSession, navigate, config.queueEnabled, config.queueEventId])

    useEffect(() => {
        if (!frames.length) {
            navigate('/')
            return
        }
        let cancelled = false
        ;(async () => {
            const outDir = frames[0].replace(/[\\/][^\\/]+$/, '') + '/flipbook'
            const res = await window.api.image.flipbookSheets({ photoPaths: frames, sheets: config.flipbookSheets ?? 6, outDir })
            if (cancelled) return
            if (!res.success || !res.data) {
                setError(`Gagal menyusun flipbook: ${res.error || 'unknown'}`)
                goHome(8000)
                return
            }
            const urls: string[] = []
            for (const p of res.data.previews) {
                const b64 = await window.api.system.readFileAsBase64(p)
                if (b64.success && b64.data) urls.push(`data:image/jpeg;base64,${b64.data}`)
            }
            if (cancelled) return
            setSheets(res.data.sheets)
            setPreviews(urls)
            setStatus('ready')
        })()
        return () => { cancelled = true }
    }, [])

    // Play pages at real-time speed: the whole burst duration per loop
    useEffect(() => {
        if (previews.length < 2) return
        const ms = Math.max(60, ((config.flipbookDurationSec ?? 4) * 1000) / previews.length)
        const t = setInterval(() => setIndex(i => (i + 1) % previews.length), ms)
        return () => clearInterval(t)
    }, [previews.length, config.flipbookDurationSec])

    const handlePrint = useCallback(async () => {
        if (printStarted.current || status !== 'ready') return
        printStarted.current = true
        setStatus('printing')

        if (!config.printerEnabled || !config.printerName) {
            setError(!config.printerEnabled ? 'Pencetakan dimatikan di pengaturan' : 'Printer belum dipilih di pengaturan')
            goHome(5000)
            return
        }
        if (config.printClientEnabled) {
            // shortcut: remote print dedupes per sessionId, so multi-sheet jobs only print locally for now
            setError('Flipbook belum mendukung shared printer. Hubungkan printer langsung ke booth ini.')
            goHome(8000)
            return
        }
        // Queue is FIFO, so sheets come out in the order the cut-and-stack layout expects
        for (const sheet of sheets) {
            const res = await window.api.printer.print(sheet, config.printerName)
            if (!res.success) {
                setError(`Gagal mengirim lembar ke printer: ${res.error || 'unknown'}`)
                goHome(8000)
                return
            }
        }
        setStatus('done')
        goHome(10000)
    }, [status, sheets, config.printerEnabled, config.printerName, config.printClientEnabled, goHome])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (e.key === '3') {
                e.preventDefault()
                handlePrint()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handlePrint])

    const touch = useInputMode() === 'touch'
    useButtonHints(status === 'ready' ? { 3: { label: 'Cetak sekarang', primary: true, onScreen: true } } : {})

    if (!frames.length) return null

    const pages = (config.flipbookSheets ?? 6) * 4
    return (
        <motion.div className={styles.container} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SessionTimer duration={AUTO_PRINT_SECONDS} onTimeout={handlePrint} enabled={status === 'ready'} label="Cetak otomatis" />

            <section className={styles.info}>
                {status === 'done' ? (
                    <>
                        <h1 className={`kiosk-title ${styles.title}`}>Sedang dicetak</h1>
                        <p className={styles.lead}>
                            {sheets.length} lembar ({pages} halaman). Tumpuk semua strip sesuai urutan keluar, potong sekali di tengah,
                            lalu taruh potongan bawah di belakang potongan atas.
                        </p>
                    </>
                ) : (
                    <>
                        <h1 className={`kiosk-title ${styles.title}`}>Flipbook kamu</h1>
                        <p className={styles.lead}>
                            {status === 'building' ? 'Menyusun halaman...' : `${pages} halaman siap dicetak.`}
                        </p>
                        {error && <p className={styles.lead}>{error}</p>}
                        <button className={styles.printCue} onClick={handlePrint} disabled={status !== 'ready'}>
                            {touch ? (
                                <span>Ketuk untuk cetak</span>
                            ) : (
                                <>
                                    <span>Tekan</span>
                                    <span className={styles.key}>3</span>
                                    <span>untuk cetak</span>
                                </>
                            )}
                        </button>
                    </>
                )}
            </section>

            <div className={styles.previewWrap}>
                {previews.length
                    ? <img src={previews[index]} alt="Pratinjau flipbook" className={styles.preview} />
                    : <SeboothLogo variant="mini" className={styles.loader} label="Menyusun flipbook" />}
            </div>
        </motion.div>
    )
}

export default FlipbookPage
