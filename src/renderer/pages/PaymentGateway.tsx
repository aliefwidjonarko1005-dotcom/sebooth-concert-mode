import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import QRCode from 'react-qr-code'
import { useFrameStore, useAppConfig, useSessionStore } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './PaymentGateway.module.css'
import { useButtonHints } from '../components/ButtonRail/ButtonRail'

interface PaymentState {
    status: 'idle' | 'pending' | 'success' | 'failed' | 'expired'
    orderId: string | null
    qrisUrl: string | null
    qrString: string | null
    transactionId: string | null
    expiredDatetime: string | null
}

function PaymentGateway(): JSX.Element {
    const navigate = useNavigate()
    const { activeFrame } = useFrameStore()
    const { config } = useAppConfig()
    const { startSession, endSession } = useSessionStore()

    const [additionalPrints, setAdditionalPrints] = useState(0)
    const [payment, setPayment] = useState<PaymentState>({
        status: 'idle',
        orderId: null,
        qrisUrl: null,
        qrString: null,
        transactionId: null,
        expiredDatetime: null
    })
    const [isCreatingOrder, setIsCreatingOrder] = useState(false)
    const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)

    const [paymentTimeLeft, setPaymentTimeLeft] = useState<number>(300)

    // Expiration countdown timer effect
    useEffect(() => {
        if (payment.status !== 'pending') return

        let targetTime: number
        if (payment.expiredDatetime) {
            targetTime = new Date(payment.expiredDatetime).getTime()
        } else {
            targetTime = Date.now() + (config.paymentTimeout || 300) * 1000
        }

        const updateTimer = () => {
            const diff = Math.max(0, Math.floor((targetTime - Date.now()) / 1000))
            setPaymentTimeLeft(diff)
            if (diff <= 0) {
                setPayment(prev => ({ ...prev, status: 'expired' }))
            }
        }

        updateTimer()
        const timerInterval = setInterval(updateTimer, 1000)

        return () => clearInterval(timerInterval)
    }, [payment.status, payment.expiredDatetime, config.paymentTimeout])

    // Format MM:SS
    const formatTimeLeft = (totalSec: number): string => {
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0')
        const s = (totalSec % 60).toString().padStart(2, '0')
        return `${m}:${s}`
    }

    // Flipbook package replaces the strip session (no additional prints)
    const [flipbookChosen, setFlipbookChosen] = useState(false)
    const isFlipbook = !!config.flipbookEnabled && flipbookChosen

    // Calculate total price
    const totalPrice = isFlipbook
        ? (config.flipbookPrice ?? 50000)
        : config.sessionPrice + (additionalPrints * config.additionalPrintPrice)

    // Handle print quantity change (multiples of 2)
    const handlePrintChange = (delta: number): void => {
        setAdditionalPrints(prev => Math.max(0, prev + delta))
    }

    const startPaidSession = (): void => {
        if (activeFrame) startSession(activeFrame.id, 2 + (isFlipbook ? 0 : additionalPrints), isFlipbook)
    }

    // Create QRIS order
    const createOrder = async (): Promise<void> => {
        const isDoku = config.paymentGateway === 'doku'
        // Gateway keys are checked in main (or held by the server with Booth Guard); errors surface below

        setIsCreatingOrder(true)
        const orderId = `SEBOOTH-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

        try {
            if (isDoku) {
                // Call electron main IPC to create Doku session securely & download QR
                const res = await (window as any).api.payment.dokuCreateSession({
                    orderId: orderId,
                    amount: totalPrice
                })

                if (res.success && res.data) {
                    setPayment({
                        status: 'pending',
                        orderId: orderId,
                        qrisUrl: res.data.qrisUrl || res.data.paymentUrl,
                        qrString: res.data.qrString || null,
                        transactionId: null,
                        expiredDatetime: res.data.expiredDatetime || null
                    })
                    startPolling(orderId)
                } else {
                    throw new Error(res.error || 'Gagal membuat sesi pembayaran DOKU')
                }
            } else {
                // Create Midtrans transaction (main process holds the server key)
                const res = await (window as any).api.payment.midtransCharge({ orderId, amount: totalPrice })
                if (!res.success) throw new Error(res.error || 'Gagal membuat transaksi Midtrans')
                const data = res.data

                if (data.actions && data.actions[0]) {
                    const qrisAction = data.actions.find((a: { name: string }) => a.name === 'generate-qr-code')
                    setPayment({
                        status: 'pending',
                        orderId: orderId,
                        qrisUrl: qrisAction?.url || data.actions[0].url,
                        qrString: data.qr_string || null,
                        transactionId: data.transaction_id,
                        expiredDatetime: data.expiry_time || null
                    })

                    // Start polling for payment status
                    startPolling(orderId)
                } else if (data.status_code === '201' || data.status_code === '200') {
                    setPayment({
                        status: 'pending',
                        orderId: orderId,
                        qrisUrl: data.qr_string ? null : (data.actions?.[0]?.url || null),
                        qrString: data.qr_string || null,
                        transactionId: data.transaction_id,
                        expiredDatetime: data.expiry_time || null
                    })
                    startPolling(orderId)
                } else {
                    throw new Error(data.status_message || 'Failed to create order')
                }
            }
        } catch (err) {
            console.error('Payment error:', err)
            setPayment(prev => ({ ...prev, status: 'failed' }))
            alert('Gagal membuat pembayaran: ' + (err as Error).message)
        } finally {
            setIsCreatingOrder(false)
        }
    }

    // Poll for payment status
    const startPolling = (orderId: string): void => {
        if (pollInterval) clearInterval(pollInterval)
        const isDoku = config.paymentGateway === 'doku'

        const interval = setInterval(async () => {
            try {
                if (isDoku) {
                    const res = await (window as any).api.payment.dokuCheckStatus({
                        invoiceNumber: orderId
                    })

                    if (res.success && res.data) {
                        const status = res.data.status // PENDING, SUCCESS, FAILED
                        if (status === 'SUCCESS') {
                            clearInterval(interval)
                            setPollInterval(null)
                            setPayment(prev => ({ ...prev, status: 'success' }))

                            // Start session and navigate to capture with paid print quantity
                            setTimeout(() => {
                                startPaidSession()
                                navigate('/capture')
                            }, 2000)
                        } else if (status === 'FAILED') {
                            clearInterval(interval)
                            setPollInterval(null)
                            setPayment(prev => ({ ...prev, status: 'failed' }))
                        }
                    }
                } else {
                    const res = await (window as any).api.payment.midtransStatus({ orderId })
                    if (!res.success) throw new Error(res.error)
                    const data = res.data

                    if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
                        clearInterval(interval)
                        setPollInterval(null)
                        setPayment(prev => ({ ...prev, status: 'success' }))

                        // Start session and navigate to capture with paid print quantity
                        setTimeout(() => {
                            startPaidSession()
                            navigate('/capture')
                        }, 2000)
                    } else if (data.transaction_status === 'expire' || data.transaction_status === 'cancel') {
                        clearInterval(interval)
                        setPollInterval(null)
                        setPayment(prev => ({ ...prev, status: 'expired' }))
                    }
                }
            } catch (err) {
                console.error('Status check error:', err)
            }
        }, 4000) // Poll every 4 seconds

        setPollInterval(interval)
    }

    useEffect(() => {
        return () => {
            if (pollInterval) clearInterval(pollInterval)
        }
    }, [pollInterval])

    // Handle timeout
    const handleTimeout = useCallback((): void => {
        if (pollInterval) clearInterval(pollInterval)
        navigate('/')
    }, [pollInterval, navigate])

    // Handle back
    const handleBack = (): void => {
        if (pollInterval) clearInterval(pollInterval)
        navigate('/frames')
    }

    const handleBackHome = (): void => {
        if (pollInterval) clearInterval(pollInterval)
        setIsConfirmModalOpen(true)
    }

    const handleConfirmBackHome = (): void => {
        endSession()
        navigate('/')
    }

    // Handle skip (for testing)
    const handleSkip = (): void => {
        startPaidSession()
        navigate('/capture')
    }

    // Keyboard navigation

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (e.key === '1') {
                e.preventDefault()
                if (payment.status !== 'idle') return
                // With the flipbook package on, button 1 switches package; 2 cycles extra prints (0→6→0)
                if (config.flipbookEnabled) setFlipbookChosen(v => !v)
                else if (additionalPrints > 0) handlePrintChange(-2)
            } else if (e.key === '2') {
                e.preventDefault()
                if (payment.status !== 'idle' || isFlipbook) return
                if (config.flipbookEnabled && additionalPrints >= 6) setAdditionalPrints(0)
                else handlePrintChange(2)
            } else if (e.key === '3') {
                e.preventDefault()
                if (payment.status === 'idle') {
                    createOrder()
                } else if (payment.status === 'expired' || payment.status === 'failed') {
                    setPayment({ status: 'idle', orderId: null, qrisUrl: null, qrString: null, transactionId: null, expiredDatetime: null })
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [additionalPrints, payment.status, createOrder, config.flipbookEnabled, isFlipbook])

    // Rail labels for the physical buttons (the handler above already maps 1/2/3); touch has its own buttons
    useButtonHints(
        payment.status === 'idle' ? {
            1: config.flipbookEnabled
                ? { label: isFlipbook ? 'Paket strip' : 'Paket flipbook', onScreen: true }
                : additionalPrints > 0 ? { label: 'Kurangi cetak', onScreen: true } : null,
            2: isFlipbook ? null : { label: 'Tambah cetak', onScreen: true },
            3: { label: 'Bayar', primary: true, onScreen: true }
        } : payment.status === 'expired' || payment.status === 'failed' ? {
            3: { label: 'Coba lagi', primary: true, onScreen: true }
        } : {}
    )


    if (!activeFrame) {
        return (
            <div className={styles.container}>
                <div className={styles.noFrame}>
                    <h2 className="kiosk-title">Belum pilih frame</h2>
                    <button onClick={() => navigate('/frames')}>Pilih frame</button>
                </div>
            </div>
        )
    }

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <SessionTimer
                duration={config.paymentTimeout}
                onTimeout={handleTimeout}
                enabled={config.sessionTimerEnabled}
                label="Bayar"
            />

            <div className={styles.content}>
                <header className={styles.header}>
                    <button onClick={handleBack} className={styles.backBtn}>
                        Kembali
                    </button>
                    <h1>Pembayaran</h1>
                </header>

                <div className={`${styles.mainContent} ${payment.status === 'idle' && !isCreatingOrder ? styles.idleState : ''} ${payment.status === 'pending' || isCreatingOrder ? styles.qrActive : ''}`}>
                    {/* Left - Price Summary */}
                    <div className={`${styles.priceSection} ${payment.status === 'pending' || isCreatingOrder ? styles.hiddenOnQr : ''}`}>
                        <div className={styles.orderSummaryHeader}>
                            <h2>Ringkasan pesanan</h2>
                            {config.flipbookEnabled && (
                                <div className={styles.packageSwitch}>
                                    <button className={!isFlipbook ? styles.packageActive : ''} onClick={() => setFlipbookChosen(false)}>Strip foto</button>
                                    <button className={isFlipbook ? styles.packageActive : ''} onClick={() => setFlipbookChosen(true)}>Flipbook</button>
                                </div>
                            )}
                            {isFlipbook ? (
                                <div className={styles.priceItem}>
                                    <span>Flipbook ({(config.flipbookSheets ?? 6) * 4} halaman)</span>
                                    <span>Rp {(config.flipbookPrice ?? 50000).toLocaleString('id-ID')}</span>
                                </div>
                            ) : (
                                <div className={styles.priceItem}>
                                    <span>Sesi foto (1 cetak 4R)</span>
                                    <span>Rp {config.sessionPrice.toLocaleString('id-ID')}</span>
                                </div>
                            )}
                        </div>

                        {!isFlipbook && <div className={styles.additionalPrintSection}>
                            <div className={styles.printSelector}>
                                <span className={styles.printSelectorTitle}>Cetak tambahan (per 2 lembar)</span>
                                <div className={styles.quantityControls}>
                                    <button
                                        onClick={() => handlePrintChange(-2)}
                                        disabled={additionalPrints === 0}
                                    >
                                        −
                                    </button>
                                    <span>{additionalPrints}</span>
                                    <button onClick={() => handlePrintChange(2)}>+</button>
                                </div>
                            </div>

                            {additionalPrints > 0 && (
                                <div className={styles.priceItem}>
                                    <span>Cetak tambahan ({additionalPrints}x)</span>
                                    <span>Rp {(additionalPrints * config.additionalPrintPrice).toLocaleString('id-ID')}</span>
                                </div>
                            )}
                        </div>}

                        <div className={styles.orderSummaryFooter}>
                            <div className={styles.priceDivider}></div>

                            <div className={styles.totalPrice}>
                                <span>Total</span>
                                <span>Rp {totalPrice.toLocaleString('id-ID')}</span>
                            </div>

                            {payment.status === 'idle' && (
                                <button
                                    className={styles.payButton}
                                    onClick={createOrder}
                                    disabled={isCreatingOrder}
                                >
                                    {isCreatingOrder ? 'Menyiapkan QRIS...' : 'Bayar Sekarang'}
                                </button>
                            )}
                        </div>
                    </div>

                    {(isCreatingOrder || payment.status !== 'idle') && (
                        <div className={styles.qrSection}>
                            {isCreatingOrder && (
                                <div className={styles.loadingDisplay}>
                                    <div className={styles.spinnerLarge}></div>
                                    <h3>Mendownload Kode QRIS...</h3>
                                    <p>Mohon tunggu sebentar, sistem sedang menyiapkan kode pembayaran Anda.</p>
                                </div>
                            )}

                            {!isCreatingOrder && payment.status === 'idle' && null}

                            {!isCreatingOrder && payment.status === 'pending' && (payment.qrString || payment.qrisUrl) && (
                                <div className={styles.qrDisplay}>
                                    {/* Countdown Timer Badge */}
                                    <div className={styles.timerBadge}>
                                        <span className={styles.timerIcon}></span>
                                        <div className={styles.timerInfo}>
                                            <span className={styles.timerLabel}>Sisa Waktu Pembayaran</span>
                                            <span className={styles.timerValue}>{formatTimeLeft(paymentTimeLeft)}</span>
                                        </div>
                                    </div>

                                    <div className={styles.qrCodeContainer}>
                                        {payment.qrString ? (
                                            <div className={styles.qrWrapper}>
                                                <QRCode value={payment.qrString} size={340} />
                                            </div>
                                        ) : payment.qrisUrl && (payment.qrisUrl.startsWith('data:image') || payment.qrisUrl.startsWith('http')) ? (
                                            <div className={styles.qrWrapper}>
                                                <img src={payment.qrisUrl} alt="Kode QRIS" className={styles.qrImage} />
                                            </div>
                                        ) : (
                                            <div className={styles.qrWrapper}>
                                                <QRCode value={payment.qrisUrl || ''} size={340} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {payment.status === 'success' && (
                                <div className={styles.successDisplay}>
                                    <span className={styles.successIcon}></span>
                                    <h3>Pembayaran Berhasil!</h3>
                                    <p>Mengalihkan ke sesi foto...</p>
                                </div>
                            )}

                            {payment.status === 'expired' && (
                                <div className={styles.errorDisplay}>
                                    <span></span>
                                    <h3>Waktu Pembayaran Habis</h3>
                                    <button onClick={() => setPayment({ status: 'idle', orderId: null, qrisUrl: null, qrString: null, transactionId: null, expiredDatetime: null })}>
                                        Coba Lagi
                                    </button>
                                </div>
                            )}

                            {payment.status === 'failed' && (
                                <div className={styles.errorDisplay}>
                                    <span>❌</span>
                                    <h3>Pembayaran Gagal</h3>
                                    <button onClick={() => setPayment({ status: 'idle', orderId: null, qrisUrl: null, qrString: null, transactionId: null, expiredDatetime: null })}>
                                        Coba Lagi
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

            </div>

            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmBackHome}
            />
        </motion.div>
    )
}

export default PaymentGateway
