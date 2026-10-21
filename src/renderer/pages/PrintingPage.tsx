import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSessionStore, useAppConfig, useQueueStore } from '../stores'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './PrintingPage.module.css'
import { SeboothLogo } from '../components/brand/SeboothLogo'

function PrintingPage(): JSX.Element {
    const navigate = useNavigate()
    const location = useLocation()
    const { currentSession, endSession, pickupLabel } = useSessionStore()
    const { config } = useAppConfig()
    const { activeTicketNumber, reset: resetQueue } = useQueueStore()
    
    const getHomeRoute = () => (config.queueEnabled && config.queueEventId) ? '/queue' : '/'
    
    const [showPickup, setShowPickup] = useState(false)
    const [printDeferred, setPrintDeferred] = useState(false)

    const sendSessionCompletedAndGoHome = async (printed = true) => {
        // Concert mode: tell the customer where to pick up, then free the booth for the next person.
        // No pickup code when the strip never reached a print queue — the error stays up so staff can step in.
        if (config.concertMode) {
            if (printed) {
                setPrintCompleted(true)
                setShowPickup(true)
            }
            setTimeout(() => {
                endSession()
                navigate('/')
            }, printed ? 6000 : 10000)
            return
        }
        // Send session_completed webhook if in queue mode
        if (config.queueEnabled && config.queueEventId && activeTicketNumber) {
            try {
                await (window as any).api.queue.sendSessionCompleted({
                    event_id: config.queueEventId,
                    ticket_number: activeTicketNumber,
                    session_id: currentSession?.id
                })
                console.log('[PrintingPage] session_completed webhook sent')
            } catch (err) {
                console.error('[PrintingPage] session_completed webhook failed:', err)
            }
            resetQueue()
        }
        endSession()
        navigate(getHomeRoute())
    }
    
    const [error, setError] = useState<string | null>(null)
    const [printCompleted, setPrintCompleted] = useState(false)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const hasStartedPrinting = useRef(false)

    // Get print quantity from navigation state, default to 2
    const printQuantity = location.state?.printQuantity || 2
    
    console.log('[PrintingPage] Navigation state:', location.state)
    console.log('[PrintingPage] Print quantity:', printQuantity)

    useEffect(() => {
        console.log('[PrintingPage] Component mounted')
        console.log('[PrintingPage] currentSession:', currentSession)
        console.log('[PrintingPage] compositePath:', currentSession?.compositePath)
        
        if (!printCompleted && (!currentSession || !currentSession.compositePath)) {
            console.log('[PrintingPage] Missing session or composite path, navigating home')
            navigate('/')
            return
        }

        // Prevent double printing in React Strict Mode
        if (!hasStartedPrinting.current) {
            console.log('[PrintingPage] Starting print process...')
            hasStartedPrinting.current = true
            handlePrint()
        } else {
            console.log('[PrintingPage] Print already started, skipping')
        }
    }, [currentSession?.compositePath, navigate])

    const handlePrint = async () => {
        setError(null)

        console.log('[PrintingPage] Starting print process...')
        console.log('[PrintingPage] window.api available:', !!(window as any).api)
        console.log('[PrintingPage] window.api.printer available:', !!(window as any).api?.printer)
        console.log('[PrintingPage] window.api.printer.printWithOptions available:', typeof (window as any).api?.printer?.printWithOptions)
        
        console.log('[PrintingPage] Config:', config)
        console.log('[PrintingPage] Printer enabled:', config.printerEnabled)
        console.log('[PrintingPage] Printer name:', config.printerName)
        console.log('[PrintingPage] Print Client enabled:', config.printClientEnabled)
        console.log('[PrintingPage] Print Server URL:', config.printServerUrl)

        // Check if printing is enabled
        if (!config.printerEnabled) {
            console.log('[PrintingPage] Printing is disabled, skipping...')
            setError('Pencetakan dimatikan di pengaturan')
            setTimeout(() => {
                sendSessionCompletedAndGoHome(false)
            }, 3000)
            return
        }

        // Check if printer is selected (only needed for local print mode)
        if (!config.printClientEnabled && !config.printerName) {
            console.log('[PrintingPage] No printer selected, skipping...')
            setError('Printer belum dipilih di pengaturan')
            setTimeout(() => {
                sendSessionCompletedAndGoHome(false)
            }, 3000)
            return
        }

        try {
            const compositeDataUrl = currentSession?.compositePath

            if (!compositeDataUrl) {
                setError('Gambar strip tidak ditemukan untuk dicetak')
                setTimeout(() => {
                    sendSessionCompletedAndGoHome(false)
                }, 5000)
                return
            }

            // Use the selected print quantity
            const copies = Math.max(1, Math.round(printQuantity / 2))

            // --- REMOTE PRINT MODE (Print Client) ---
            if (config.printClientEnabled && config.printServerUrl) {
                console.log(`[PrintingPage] REMOTE PRINT MODE — Sending ${copies} copies to Print Server: ${config.printServerUrl}`)

                const result = await (window as any).api.printer.remotePrint({
                    imageData: compositeDataUrl,
                    copies,
                    sessionId: currentSession!.id,
                    label: pickupLabel || undefined
                })

                console.log('[PrintingPage] Remote print result:', result)

                if (!result.success) {
                    setError(result.error || 'Remote print failed — check connection to Print Server')
                    setTimeout(() => {
                        sendSessionCompletedAndGoHome(false)
                    }, 5000)
                } else {
                    setPrintCompleted(true)
                    if (result.data?.queued) setPrintDeferred(true)
                    sendSessionCompletedAndGoHome()
                }
                return
            }

            // --- LOCAL PRINT MODE (Default) ---
            // Find strip in session folder
            let stripPath: string | null = null
            try {
                const findResult = await (window as any).api.system.findSessionStrip(currentSession!.id)
                if (findResult.success && findResult.data) {
                    stripPath = findResult.data
                }
            } catch { /* ignore, use fallback */ }

            // Fallback: use the base64 composite we have in state
            if (!stripPath && currentSession?.compositePath) {
                const saveResult = await (window as any).api.system.saveDataUrl(
                    currentSession.compositePath,
                    `strip_${currentSession.id}.jpg`
                )
                if (saveResult.success && saveResult.data) {
                    stripPath = saveResult.data
                }
            }

            console.log(`[PrintingPage] LOCAL PRINT — Printing ${copies} copies to printer: ${config.printerName}`)
            console.log('[PrintingPage] Using compositePath length:', compositeDataUrl.length)
            
            // This promise resolves when the OS print spooler accepts the job
            console.log('[PrintingPage] Calling window.api.printer.printWithOptions...')
            const result = await (window as any).api.printer.printWithOptions({
                printerName: config.printerName,
                data: compositeDataUrl,
                copies,
                options: {}
            })
            
            console.log('[PrintingPage] Print result:', result)
            
            if (!result.success) {
                setError(result.error || 'Gagal mencetak')
                // If print fails, wait a bit so user can read the error, then go home
                setTimeout(() => {
                    endSession()
                    navigate('/')
                }, 5000)
            } else {
                // Success! Mark as completed and go home
                setPrintCompleted(true)
                sendSessionCompletedAndGoHome()
            }
        } catch (err) {
            setError('Gagal mencetak: ' + (err as Error).message)
            setTimeout(() => {
                sendSessionCompletedAndGoHome(false)
            }, 5000)
        }
    }

    const handleBackHome = () => {
        setIsConfirmModalOpen(true)
    }

    const handleConfirmBackHome = () => {
        sendSessionCompletedAndGoHome(printCompleted)
    }

    return (
        <div className={styles.container}>
            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmBackHome}
            />

            {error && <div className={styles.errorMessage}>{error}{config.concertMode && !printCompleted && ' — Cetakan tidak terkirim, panggil petugas booth.'}</div>}

            {showPickup ? (
                <div className={styles.content}>
                    <h1 className={`kiosk-title ${styles.title}`}>Ambil fotomu<br /><em>di loket</em></h1>
                    {pickupLabel && (
                        <>
                            <p className={styles.subtitle}>Sebutkan kode ini ke petugas loket</p>
                            <div className={styles.pickupCode}>{pickupLabel}</div>
                        </>
                    )}
                    {printDeferred && (
                        <p className={styles.pickupWarning}>Printer loket sedang tidak terhubung. Cetakan dikirim otomatis begitu tersambung.</p>
                    )}
                </div>
            ) : (
                <div className={styles.content}>
                    {/* The wordmark's paper sliding out of the slot doubles as the printing animation */}
                    <SeboothLogo theme="royal" ink="#ffffff" accent="#fe6b00" className={styles.logo} />
                    <h1 className={`kiosk-title ${styles.title}`}>Sedang <em>mencetak</em></h1>
                    <p className={styles.subtitle}>Sebentar ya, strip kamu sedang dikirim ke printer.</p>
                </div>
            )}
        </div>
    )
}

export default PrintingPage
