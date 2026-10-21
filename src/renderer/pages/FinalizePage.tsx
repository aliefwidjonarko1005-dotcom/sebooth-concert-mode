import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSessionStore, useFrameStore, useAppConfig } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { buildComposite, buildGifFrames, buildSaveParams, getQRUrl } from '../lib/composite'
import styles from './FinalizePage.module.css'
import { SeboothLogo } from '../components/brand/SeboothLogo'
import { useButtonHints, useInputMode } from '../components/ButtonRail/ButtonRail'

const AUTO_PRINT_SECONDS = 15

/**
 * Concert mode: final strip preview with mirror toggle, then print.
 * Key 2 = mirror on/off, Key 3 = print. Prints automatically after AUTO_PRINT_SECONDS.
 */
function FinalizePage(): JSX.Element | null {
    const navigate = useNavigate()
    const { currentSession, photos, isMirrored, setIsMirrored, setCompositePath, setPickupLabel, endSession } = useSessionStore()
    const { frames } = useFrameStore()
    const { config, updateConfig } = useAppConfig()

    const [preview, setPreview] = useState<string | null>(null)
    const printStarted = useRef(false)

    const frame = frames.find(f => f.id === currentSession?.frameId) || null

    // Slots left empty when time ran out reuse the last photo taken, so the strip is never blank
    const sessionPhotos = useMemo(() => {
        if (!frame || photos.length === 0) return photos
        const last = photos[photos.length - 1]
        const missing = frame.slots
            .filter(s => !s.duplicateOfSlotId && !photos.some(p => p.slotId === s.id))
            .map(s => ({ ...last, slotId: s.id }))
        return [...photos, ...missing]
    }, [frame, photos])

    useEffect(() => {
        setIsMirrored(!!config.mirrorOutput)
    }, [])

    useEffect(() => {
        if (!currentSession || !frame) {
            navigate('/')
            return
        }
        if (photos.length === 0) {
            const t = setTimeout(() => {
                endSession()
                navigate('/')
            }, 4000)
            return () => clearTimeout(t)
        }
    }, [currentSession, frame, photos.length])

    // Rebuild the strip whenever mirror changes
    useEffect(() => {
        if (!currentSession || !frame || sessionPhotos.length === 0) return
        let cancelled = false
        setPreview(null)
        ;(async () => {
            try {
                const dataUrl = await buildComposite({
                    frame,
                    photos: sessionPhotos,
                    filter: 'none',
                    mirror: isMirrored,
                    qrUrl: await getQRUrl(config, currentSession.id)
                })
                if (cancelled) return
                setPreview(dataUrl)
                setCompositePath(dataUrl)
            } catch (err) {
                console.error('[Finalize] Composite failed:', err)
            }
        })()
        return () => { cancelled = true }
    }, [isMirrored, frame, sessionPhotos, currentSession?.id])

    const handlePrint = useCallback(() => {
        if (printStarted.current || !preview || !currentSession || !frame) return
        printStarted.current = true

        const n = (config.concertCounter || 0) + 1
        const label = `${config.boothCode || 'B1'}-${String(n).padStart(3, '0')}`
        updateConfig({ concertCounter: n })
        setPickupLabel(label)

        // Background: GIF + live video + local save + upload queue. Not awaited — printing never waits on it.
        const sessionId = currentSession.id
        const mirror = isMirrored
        const strip = preview
        ;(async () => {
            try {
                const gifFrames = await buildGifFrames(frame, photos, mirror)
                const save = await buildSaveParams({ config, sessionId, frame, photos: sessionPhotos, stripDataUrl: strip, mirror })
                await window.api.system.finalizeSession({
                    save,
                    gifFrames,
                    upload: config.sharingMode === 'cloud'
                        ? { eventName: config.eventName || 'Sebooth Event', frameName: frame.name || '-' }
                        : undefined
                })
            } catch (err) {
                console.error('[Finalize] Background media job failed to start:', err)
            }
        })()

        navigate('/printing', { state: { printQuantity: config.concertPrintQuantity || 2 } })
    }, [preview, currentSession, frame, photos, sessionPhotos, isMirrored, config, updateConfig, setPickupLabel, navigate])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (e.key === '2') {
                e.preventDefault()
                if (!printStarted.current) setIsMirrored(!isMirrored)
            } else if (e.key === '3') {
                e.preventDefault()
                handlePrint()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isMirrored, setIsMirrored, handlePrint])

    const touch = useInputMode() === 'touch'
    useButtonHints(preview && photos.length > 0 ? {
        2: { label: 'Ganti mirror', onScreen: true },
        3: { label: 'Cetak sekarang', primary: true, onScreen: true }
    } : {})

    if (!currentSession || !frame) return null

    if (photos.length === 0) {
        return (
            <div className={styles.container}>
                <h1 className={`kiosk-title ${styles.title}`}>Tidak ada foto</h1>
            </div>
        )
    }

    return (
        <motion.div className={styles.container} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SessionTimer duration={AUTO_PRINT_SECONDS} onTimeout={handlePrint} enabled={!!preview} label="Cetak otomatis" />

            <section className={styles.info}>
                <h1 className={`kiosk-title ${styles.title}`}>Siap <em>dicetak?</em></h1>
                <p className={styles.lead}>Cek sekali lagi. Strip akan langsung dicetak dan bisa diambil di loket.</p>

                <div className={styles.mirrorRow}>
                    <span className={styles.mirrorLabel}>Mirror</span>
                    {touch ? (
                        <button
                            type="button"
                            className={`${styles.mirrorState} ${styles.mirrorTap} ${isMirrored ? styles.on : ''}`}
                            onClick={() => { if (!printStarted.current) setIsMirrored(!isMirrored) }}
                        >
                            {isMirrored ? 'ON' : 'OFF'}
                        </button>
                    ) : (
                        <>
                            <span className={`${styles.mirrorState} ${isMirrored ? styles.on : ''}`}>{isMirrored ? 'ON' : 'OFF'}</span>
                            <span className={styles.mirrorHint}>Tekan 2 untuk ganti</span>
                        </>
                    )}
                </div>

                <button className={styles.printCue} onClick={handlePrint} disabled={!preview}>
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
            </section>

            <div className={styles.previewWrap}>
                {preview
                    ? <img src={preview} alt="Photo strip" className={styles.preview} />
                    : <SeboothLogo variant="mini" className={styles.loader} label="Menyiapkan strip" />}
            </div>
        </motion.div>
    )
}

export default FinalizePage
