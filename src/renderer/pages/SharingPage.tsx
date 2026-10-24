import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import QRCode from 'react-qr-code'
import { useSessionStore, useAppConfig, useQueueStore } from '../stores'
import { PrintQuantityModal } from '../components/PrintQuantityModal'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './SharingPage.module.css'
import { useButtonHints } from '../components/ButtonRail/ButtonRail'
import { getQRUrl } from '../lib/composite'

function SharingPage(): JSX.Element {
    const navigate = useNavigate()
    const { currentSession, endSession } = useSessionStore()
    const { config } = useAppConfig()
    const { activeTicketNumber, activeTicketId, reset: resetQueue } = useQueueStore()

    const [qrUrl, setQrUrl] = useState<string | null>(null)
    const [isGenerating, setIsGenerating] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isPrintModalOpen, setIsPrintModalOpen] = useState(false)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)

    useEffect(() => {
        if (!currentSession) {
            navigate('/')
            return
        }

        generateQR()
    }, [currentSession?.id, currentSession?.cloudSessionId, config.sharingMode, config.cloudPortalUrl, navigate])

    const generateQR = async () => {
        setIsGenerating(true)
        setError(null)
        try {
            // Priority 1: Cloud Mode. The background upload keys the portal by the local session id,
            // so use the same URL as the QR printed on the strip (cloudSessionId is no longer set).
            if (config.sharingMode === 'cloud' && currentSession) {
                const portalUrl = await getQRUrl(config, currentSession.cloudSessionId || currentSession.id)
                setQrUrl(portalUrl)
                localStorage.setItem(`gallery_${currentSession.id}`, portalUrl)
                setIsGenerating(false)
                return
            }

            // Priority 2: Local Mode or Cached URLs
            const cachedUrl = localStorage.getItem(`gallery_${currentSession!.id}`)
            if (cachedUrl && !cachedUrl.includes('sebooth.app/download')) {
                setQrUrl(cachedUrl)
                setIsGenerating(false)
                return
            }

            // Priority 3: Fresh Generation
            if (config.sharingMode === 'local') {
                const ipRes = await (window as any).api.system.getLocalIp()
                if (ipRes && ipRes.success && ipRes.data) {
                    const localIp = ipRes.data
                    const localUrl = `http://${localIp}:5050/gallery/${currentSession!.id}`
                    setQrUrl(localUrl)
                    localStorage.setItem(`gallery_${currentSession!.id}`, localUrl)
                } else {
                    throw new Error('Could not determine local IP')
                }
            } else {
                console.warn('Cloud session ID not found in SharingPage, showing fallback')
                // Final Fallback for Cloud Mode when ID is not yet available
                const dummyUrl = `https://sebooth.app/download/${currentSession!.id}`
                setQrUrl(dummyUrl)
            }
        } catch (err) {
            console.error('Failed to generate QR or get URL:', err)
            setError('Gagal membuat QR Code')
        } finally {
            setIsGenerating(false)
        }
    }

    const handlePrint = () => {
        // startSession defaults printQuantity to 2, so only treat it as "already paid" when payment is on;
        // otherwise always let the customer pick how many (multiples of 2, one sheet = 2 strips).
        const paidQuantity = config.paymentEnabled ? currentSession?.printQuantity : undefined
        if (paidQuantity && paidQuantity > 0) {
            console.log('[SharingPage] Paid quantity found from Payment Gateway:', paidQuantity)
            console.log('[SharingPage] Navigating to /printing directly with printQuantity:', paidQuantity)
            navigate('/printing', { state: { printQuantity: paidQuantity } })
        } else {
            setIsPrintModalOpen(true)
        }
    }

    const handlePrintConfirm = (quantity: number) => {
        console.log('[SharingPage] handlePrintConfirm called with quantity:', quantity)
        console.log('[SharingPage] Navigating to /printing with state:', { printQuantity: quantity })
        // Navigate to the printing page with quantity
        navigate('/printing', { state: { printQuantity: quantity } })
    }

    const sendSessionCompleted = async () => {
        if (config.queueEnabled && config.queueEventId && activeTicketNumber) {
            try {
                const windowApi = (window as any).api
                await windowApi.queue.sendSessionCompleted({
                    event_id: config.queueEventId,
                    ticket_number: activeTicketNumber,
                    session_id: currentSession?.id
                })
                console.log('[SharingPage] session_completed webhook sent')
            } catch (error) {
                console.error('[SharingPage] Failed to send session_completed:', error)
            }
        }
    }

    const handleConfirmBackHome = async () => {
        await sendSessionCompleted()
        endSession()
        if (config.queueEnabled && config.queueEventId) {
            resetQueue()
            navigate('/queue')
        } else {
            navigate('/')
        }
    }

    const handleHome = async () => {
        await sendSessionCompleted()
        endSession()
        if (config.queueEnabled && config.queueEventId) {
            resetQueue()
            navigate('/queue')
        } else {
            navigate('/')
        }
    }

    useButtonHints({
        2: { label: 'Selesai' },
        3: { label: 'Cetak foto', primary: true }
    })

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (isPrintModalOpen || isConfirmModalOpen) return

            if (e.key === '2') {
                e.preventDefault()
                handleHome()
            } else if (e.key === '3') {
                e.preventDefault()
                handlePrint()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isPrintModalOpen, isConfirmModalOpen, handleHome, handlePrint])

    return (
        <div className={styles.container}>
            <motion.h1 
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className={`kiosk-title ${styles.title}`}
            >
                Ambil fotomu
            </motion.h1>
            
            <motion.p 
                initial={{ y: -30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className={styles.subtitle}
            >
                Pindai QR ini pakai kamera HP untuk mengunduh foto, GIF, dan video live.
            </motion.p>

            <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, type: 'spring' }}
                className={styles.qrContainer}
            >
                {isGenerating ? (
                    <div className={styles.loadingQr}>
                        <div className={styles.spinner}></div>
                        <p>Menyiapkan QR...</p>
                    </div>
                ) : error ? (
                    <div className={styles.loadingQr}>
                        <p className={styles.errorText}>{error}</p>
                    </div>
                ) : qrUrl ? (
                    <>
                        <div className={styles.qrCode}>
                            <QRCode value={qrUrl} size={460} level="H" />
                        </div>
                        <p className={styles.scanText}>Arahkan kamera HP ke sini</p>
                    </>
                ) : null}
            </motion.div>

            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmBackHome}
            />

            <PrintQuantityModal
                isOpen={isPrintModalOpen}
                onClose={() => setIsPrintModalOpen(false)}
                onConfirm={handlePrintConfirm}
                initialQuantity={currentSession?.printQuantity || 2}
            />
        </div>
    )
}

export default SharingPage
