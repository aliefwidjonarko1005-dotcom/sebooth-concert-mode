import { useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFrameStore, useAppConfig, useSessionStore } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './FrameSelection.module.css'
import { emitMascot } from '../lib/mascotEvents'
import { useButtonHints, useInputMode } from '../components/ButtonRail/ButtonRail'
import { useSwipe } from '../lib/useSwipe'
import { useElementSize } from '../lib/useElementHeight'

function FrameSelection(): JSX.Element {
    const navigate = useNavigate()
    const { frames, setActiveFrame } = useFrameStore()
    const { config } = useAppConfig()
    const { endSession } = useSessionStore()
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const [focusedIndex, setFocusedIndex] = useState(0)

    // Clear any existing session when entering frame selection
    useEffect(() => {
        endSession()
    }, [endSession])

    // Filter active frames if configured, otherwise show all
    const displayFrames = config.activeFrameIds.length > 0
        ? frames.filter(f => config.activeFrameIds.includes(f.id))
        : frames

    // Keep focusedIndex in bounds when frames list changes
    useEffect(() => {
        if (displayFrames.length > 0 && focusedIndex >= displayFrames.length) {
            setFocusedIndex(0)
        }
    }, [displayFrames.length, focusedIndex])

    const handleSelectFrame = (frameId: string): void => {
        setActiveFrame(frameId)
        if (config.paymentEnabled && !config.concertMode) {
            navigate('/payment')
        } else {
            navigate('/capture')
        }
    }

    const handleNext = () => {
        if (displayFrames.length === 0) return
        setFocusedIndex(prev => (prev + 1) % displayFrames.length)
    }

    const handlePrev = () => {
        if (displayFrames.length === 0) return
        setFocusedIndex(prev => (prev - 1 + displayFrames.length) % displayFrames.length)
    }

    const handleBack = (): void => {
        setIsConfirmModalOpen(true)
    }

    const handleConfirmBack = (): void => {
        endSession()
        navigate('/')
    }

    const handleTimeout = (): void => {
        navigate('/')
    }

    // Physical buttons: 1 = previous frame, 2 = next frame, 3 = select (3 is always "go forward")
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (displayFrames.length === 0) return

            if (e.key === '1' || e.key === 'ArrowLeft') {
                e.preventDefault()
                handlePrev()
            } else if (e.key === '2' || e.key === 'ArrowRight') {
                e.preventDefault()
                handleNext()
            } else if (e.key === '3' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                const selected = displayFrames[focusedIndex]
                if (selected) {
                    handleSelectFrame(selected.id)
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [displayFrames, focusedIndex])

    const many = displayFrames.length > 1
    const touch = useInputMode() === 'touch'
    const contentRef = useRef<HTMLElement>(null)
    const contentSize = useElementSize(contentRef)
    const swipe = useSwipe(handlePrev, handleNext, touch && many)
    useButtonHints(displayFrames.length === 0 ? {} : {
        1: many ? { label: 'Frame sebelumnya', onScreen: true } : null,
        2: many ? { label: 'Frame berikutnya', onScreen: true } : null,
        3: { label: 'Pilih frame ini', primary: true, onScreen: touch }
    })

    const isPortrait = config.appOrientation === 'portrait'

    // Touch booth (landscape): size the card from the measured stage so the focused one always fits,
    // swipe to browse, tap the centre card to pick. Portrait keeps its fixed, tested layout.
    const FOCUS_SCALE_TOUCH = 1.12
    const sample = displayFrames[focusedIndex] || displayFrames[0]
    let touchCardWidth = 300
    if (touch && sample && contentSize.height > 0) {
        const maxCardH = (contentSize.height - 56) / FOCUS_SCALE_TOUCH
        const previewH = maxCardH - 28 - 84 // card padding + name/count block
        touchCardWidth = Math.max(160, Math.min(380, previewH * (sample.canvasWidth / sample.canvasHeight) + 28))
    }
    const cardSpacing = isPortrait ? 500 : touch ? touchCardWidth * 1.3 : 540

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            {/* Session Timer Overlay */}
            <SessionTimer
                duration={config.frameSelectionTimeout}
                onTimeout={handleTimeout}
                enabled={config.sessionTimerEnabled}
                label="Pilih frame"
            />

            <header className={styles.header}>
                <div>
                    <h1 className="kiosk-title">Pilih <em>frame</em> kamu</h1>
                </div>
                <button onClick={handleBack} className={styles.backButton}>Batal</button>
            </header>

            {/* Touch booth: how to browse/pick, right above the cards */}
            {touch && displayFrames.length > 0 && (
                <p className={styles.touchGuide}>
                    <svg viewBox="0 0 48 48" className={styles.doubleTap} aria-hidden="true">
                        <circle className={styles.tapRing} cx="24" cy="24" r="10" fill="none" stroke="#ffffff" strokeWidth="4" />
                        <circle cx="24" cy="24" r="7" fill="#ffffff" stroke="#00113a" strokeWidth="3" />
                    </svg>
                    {many ? 'Geser untuk lihat frame lain, ketuk frame untuk memilih' : 'Ketuk frame untuk memilih'}
                </p>
            )}

            <main className={styles.content} ref={contentRef}>
                {displayFrames.length === 0 ? (
                    <div className={styles.emptyState}>
                        <h2>Belum Ada Frame</h2>
                        <p>Silakan tambahkan frame di Admin Dashboard terlebih dahulu.</p>
                        <button onClick={() => navigate('/admin')} className={styles.adminButton}>
                            Ke Dashboard Admin
                        </button>
                    </div>
                ) : (
                    <div className={styles.carouselWrapper}>
                        {/* Horizontal Carousel Track */}
                        <motion.div className={styles.carouselTrack} {...swipe}>
                            {displayFrames.map((frame, index) => {
                                const offset = index - focusedIndex
                                const isFocused = index === focusedIndex

                                // Calculate scale, opacity, x position based on distance from center
                                const scale = isFocused ? (touch ? FOCUS_SCALE_TOUCH : 1.38) : Math.max(0.60, 0.78 - Math.abs(offset) * 0.2)
                                const opacity = isFocused ? 1 : Math.max(0, 0.65 - (Math.abs(offset) - 1) * 0.3)
                                const zIndex = isFocused ? 20 : 10 - Math.abs(offset)
                                const translateX = offset * cardSpacing

                                // Don't render items that are too far away offscreen
                                if (Math.abs(offset) > 3) return null

                                return (
                                    <motion.div
                                        key={frame.id}
                                        className={`${styles.carouselCard} ${isFocused ? styles.focusedCard : ''}`}
                                        style={touch ? { width: touchCardWidth } : undefined}
                                        onClick={touch ? undefined : () => {
                                            if (isFocused) {
                                                handleSelectFrame(frame.id)
                                            } else {
                                                setFocusedIndex(index)
                                            }
                                        }}
                                        // onTap is not fired after a pan, so a swipe never selects
                                        onTap={touch ? () => {
                                            if (isFocused) handleSelectFrame(frame.id)
                                            else {
                                                setFocusedIndex(index)
                                                emitMascot('focus')
                                            }
                                        } : undefined}
                                        animate={{
                                            x: translateX,
                                            scale,
                                            opacity,
                                            zIndex
                                        }}
                                        transition={{
                                            type: 'spring',
                                            stiffness: 300,
                                            damping: 26
                                        }}
                                    >
                                        {/* Number matches the printed frame samples shown in the queue */}
                                        <div className={styles.frameNumberBadge}>{index + 1}</div>
                                        <div
                                            className={styles.framePreview}
                                            style={{ aspectRatio: `${frame.canvasWidth} / ${frame.canvasHeight}` }}
                                        >
                                            {/* Colored slot indicators */}
                                            {frame.slots.map((slot) => {
                                                const slotColors = ['#ff4500', '#1d43c4', '#00113a', '#fe6b00', '#1f9d68', '#f5a400']
                                                const nonDuplicateSlots = frame.slots.filter(s => !s.duplicateOfSlotId)
                                                let displayNumber: number
                                                let colorIndex: number

                                                if (slot.duplicateOfSlotId) {
                                                    const sourceSlot = frame.slots.find(s => s.id === slot.duplicateOfSlotId)
                                                    displayNumber = sourceSlot ? nonDuplicateSlots.findIndex(s => s.id === sourceSlot.id) + 1 : 0
                                                } else {
                                                    displayNumber = nonDuplicateSlots.findIndex(s => s.id === slot.id) + 1
                                                }
                                                colorIndex = Math.max(0, displayNumber - 1)
                                                const color = slotColors[colorIndex % slotColors.length]

                                                return (
                                                    <div
                                                        key={slot.id}
                                                        className={styles.slotIndicator}
                                                        style={{
                                                            left: `${(slot.x / frame.canvasWidth) * 100}%`,
                                                            top: `${(slot.y / frame.canvasHeight) * 100}%`,
                                                            width: `${(slot.width / frame.canvasWidth) * 100}%`,
                                                            height: `${(slot.height / frame.canvasHeight) * 100}%`,
                                                            transform: `rotate(${slot.rotation}deg)`,
                                                            backgroundColor: color,
                                                            opacity: 0.7
                                                        }}
                                                    >
                                                        <span className={styles.slotNumber}>{displayNumber}</span>
                                                    </div>
                                                )
                                            })}
                                            {/* Frame overlay on top */}
                                            <img
                                                src={`file://${frame.overlayPath}`}
                                                alt={frame.name}
                                                className={styles.frameOverlayImage}
                                            />
                                        </div>
                                        <div className={styles.frameInfo}>
                                            <h3>{frame.name}</h3>
                                            <span>{frame.slots.filter(s => !s.duplicateOfSlotId).length} foto</span>
                                        </div>
                                    </motion.div>
                                )
                            })}
                        </motion.div>
                    </div>
                )}
            </main>

            {/* Position dots: where the focused frame sits in the list */}
            {many && (
                <div className={styles.dots} aria-hidden="true">
                    {displayFrames.map((f, i) => (
                        <span key={f.id} className={i === focusedIndex ? styles.dotActive : styles.dot} />
                    ))}
                </div>
            )}


            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={handleConfirmBack}
            />
        </motion.div>
    )
}

export default FrameSelection
