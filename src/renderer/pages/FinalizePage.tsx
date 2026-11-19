import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSessionStore, useFrameStore, useAppConfig, useEventSessionStore } from '../stores'
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
    const { activeEvent } = useEventSessionStore()

    const [preview, setPreview] = useState<string | null>(null)
    const printStarted = useRef(false)
    // Add-on: after the mirror choice, a full-page step asks how many strips to print (null = mirror step)
    const defaultQty = config.concertPrintQuantity || 2
    const [qty, setQty] = useState<number | null>(null)

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
                const eventName = activeEvent?.eventName || config.eventName || 'Sebooth Event'
                const createdAt = currentSession.createdAt || Date.now()
                const dataUrl = await buildComposite({
                    frame,
                    photos: sessionPhotos,
                    filter: 'none',
                    mirror: isMirrored,
                    qrUrl: await getQRUrl(config, currentSession.id, { eventName, createdAt })
                })
                if (cancelled) return
                setPreview(dataUrl)
                setCompositePath(dataUrl)
            } catch (err) {
                console.error('[Finalize] Composite failed:', err)
            }
        })()
        return () => { cancelled = true }
    }, [isMirrored, frame, sessionPhotos, currentSession?.id, activeEvent, config])

    // Auto-print timeout calls this without a number: use the last quantity picked (or the default)
    const handlePrint = useCallback((quantity?: number) => {
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
        const eventName = activeEvent?.eventName || config.eventName || 'Sebooth Event'
        const createdAt = currentSession.createdAt || Date.now()

        ;(async () => {
            try {
                const gifFrames = await buildGifFrames(frame, photos, mirror)
                const save = await buildSaveParams({
                    config,
                    sessionId,
                    frame,
                    photos: sessionPhotos,
                    stripDataUrl: strip,
                    mirror,
                    eventName,
                    createdAt
                })
                await window.api.system.finalizeSession({
                    save,
                    gifFrames,
                    upload: config.sharingMode === 'cloud'
                        ? { eventName, frameName: frame.name || '-' }
                        : undefined
                })
            } catch (err) {
                console.error('[Finalize] Background media job failed to start:', err)
            }
        })()

        navigate('/printing', { state: { printQuantity: quantity ?? qty ?? defaultQty } })
    }, [preview, currentSession, frame, photos, sessionPhotos, isMirrored, config, activeEvent, updateConfig, setPickupLabel, navigate, qty, defaultQty])

    // Below 2 the quantity step goes back to the mirror step
    const lessQty = useCallback(() => setQty(q => (q === null || q <= 2 ? null : q - 2)), [])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (e.key !== '1' && e.key !== '2' && e.key !== '3') return
            if (printStarted.current) return
            if (qty !== null) {
                // Quantity step: 1 = fewer (back at 2), 2 = more, 3 = print
                e.preventDefault()
                if (e.key === '1') lessQty()
                else if (e.key === '2') setQty(qty + 2)
                else handlePrint(qty)
            } else if (e.key === '2') {
                e.preventDefault()
                setIsMirrored(!isMirrored)
            } else if (e.key === '3') {
                e.preventDefault()
                if (preview) setQty(defaultQty)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isMirrored, setIsMirrored, preview, qty, defaultQty, lessQty, handlePrint])

    const touch = useInputMode() === 'touch'
    useButtonHints(!preview || photos.length === 0 ? {} : qty !== null ? {
        1: { label: qty <= 2 ? 'Kembali' : 'Kurangi', onScreen: true },
        2: { label: 'Tambah', onScreen: true },
        3: { label: `Cetak ${qty} foto`, primary: true, onScreen: true }
    } : {
        2: { label: 'Ganti mirror', onScreen: true },
        3: { label: 'Lanjut', primary: true, onScreen: true }
    })

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
            <SessionTimer duration={AUTO_PRINT_SECONDS} onTimeout={() => handlePrint()} enabled={!!preview} label="Cetak otomatis" />

            {qty !== null ? (
            <section className={styles.info}>
                <h1 className={`kiosk-title ${styles.title}`}>Mau cetak berapa?</h1>
                <p className={styles.lead}>Satu lembar cetak berisi 2 strip. Semua diambil di loket.</p>

                <div className={styles.qtyRow}>
                    <button type="button" className={styles.qtyBtn} onClick={lessQty} disabled={touch && qty <= 2} aria-label="Kurangi">−</button>
                    <span className={`kiosk-num ${styles.qtyNum}`}>{qty}</span>
                    <button type="button" className={styles.qtyBtn} onClick={() => setQty(qty + 2)} aria-label="Tambah">+</button>
                </div>
                <p className={styles.sheets}>{qty / 2} lembar cetak</p>
                {touch
                    ? <button type="button" className={styles.backLink} onClick={() => setQty(null)}>Kembali</button>
                    : <span className={styles.mirrorHint}>Tekan 1 untuk kurangi, 2 untuk tambah</span>}

                <button className={styles.printCue} onClick={() => handlePrint(qty)}>
                    {touch ? (
                        <span>Ketuk untuk cetak {qty} foto</span>
                    ) : (
                        <>
                            <span>Tekan</span>
                            <span className={styles.key}>3</span>
                            <span>cetak {qty} foto</span>
                        </>
                    )}
                </button>
            </section>
            ) : (
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

                <button className={styles.printCue} onClick={() => setQty(defaultQty)} disabled={!preview}>
                    {touch ? (
                        <span>Ketuk untuk lanjut</span>
                    ) : (
                        <>
                            <span>Tekan</span>
                            <span className={styles.key}>3</span>
                            <span>untuk lanjut</span>
                        </>
                    )}
                </button>
            </section>
            )}

            <div className={styles.previewWrap}>
                {preview
                    ? <img src={preview} alt="Photo strip" className={styles.preview} />
                    : <SeboothLogo variant="mini" className={styles.loader} label="Menyiapkan strip" />}
            </div>
        </motion.div>
    )
}

export default FinalizePage
