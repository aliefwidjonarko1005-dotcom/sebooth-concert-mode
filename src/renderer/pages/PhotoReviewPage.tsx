import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useSessionStore, useFrameStore, useAppConfig } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './PhotoReviewPage.module.css'
import { useSwipe } from '../lib/useSwipe'
import { useElementSize } from '../lib/useElementHeight'
import { useButtonHints, useInputMode } from '../components/ButtonRail/ButtonRail'

function PhotoReviewPage(): JSX.Element | null {
    const navigate = useNavigate()
    const { currentSession, photos, removePhoto, endSession, deadline } = useSessionStore()
    const { frames } = useFrameStore()
    const { config } = useAppConfig()
    const isConcert = !!config.concertMode
    const nextRoute = isConcert ? '/finalize' : '/review'
    // Concert mode shares one countdown with CaptureSession (computed once on mount)
    const [concertSecondsLeft] = useState(() =>
        deadline ? Math.max(1, Math.ceil((deadline - Date.now()) / 1000)) : config.concertSessionSeconds || 240
    )

    const [activeIndex, setActiveIndex] = useState(0)
    const [scale, setScale] = useState(1)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const bottomSize = useElementSize(bottomRef)
    const touch = useInputMode() === 'touch'
    // Both booths show only the active photo (neighbours were cut off at the screen edge)
    const single = touch || config.appOrientation === 'portrait'

    // Redirect if no session or photos
    useEffect(() => {
        if (!currentSession || photos.length === 0) {
            navigate('/capture')
        }
    }, [currentSession, photos, navigate])

    const sessionFrame = frames.find(f => f.id === currentSession?.frameId) || frames[0]

    // Non-duplicate slots only (the actual photos user captured)
    const captureSlots = sessionFrame?.slots.filter(s => !s.duplicateOfSlotId) || []

    // Calculate scale factor for top frame preview
    useEffect(() => {
        const updateScale = () => {
            if (!containerRef.current || !sessionFrame) return
            const containerW = containerRef.current.clientWidth
            const containerH = containerRef.current.clientHeight
            if (!containerW || !containerH) return

            const scaleX = (containerW - 24) / sessionFrame.canvasWidth
            const scaleY = (containerH - 24) / sessionFrame.canvasHeight
            const computedScale = Math.min(scaleX, scaleY, 1)
            setScale(computedScale)
        }

        updateScale()
        window.addEventListener('resize', updateScale)
        return () => window.removeEventListener('resize', updateScale)
    }, [sessionFrame])

    // Button 1: Next Foto Slide
    const handlePrevSlide = useCallback(() => {
        if (captureSlots.length === 0) return
        setActiveIndex(prev => (prev - 1 + captureSlots.length) % captureSlots.length)
    }, [captureSlots.length])

    const handleNextSlide = useCallback(() => {
        if (captureSlots.length === 0) return
        setActiveIndex(prev => (prev + 1) % captureSlots.length)
    }, [captureSlots.length])

    // Button 2: Retake Active Photo
    const handleRetakePhoto = useCallback(() => {
        if (captureSlots.length === 0 || !captureSlots[activeIndex]) return
        if (isConcert && deadline && Date.now() >= deadline) return
        const activeSlot = captureSlots[activeIndex]
        const sourceSlotId = activeSlot.duplicateOfSlotId || activeSlot.id
        removePhoto(sourceSlotId)
        navigate('/capture')
    }, [captureSlots, activeIndex, removePhoto, navigate, isConcert, deadline])

    // Button 3: Continue to next page (/review for post processing)
    const handleContinue = useCallback(() => {
        navigate(nextRoute)
    }, [navigate, nextRoute])

    // Physical Hardware Keyboard Shortcuts (Key 1 = Next, Key 2 = Retake, Key 3 = Continue)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (e.key === '1') {
                e.preventDefault()
                handleNextSlide()
            } else if (e.key === '2') {
                e.preventDefault()
                handleRetakePhoto()
            } else if (e.key === '3') {
                e.preventDefault()
                handleContinue()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleNextSlide, handleRetakePhoto, handleContinue])

    // Timeout handler
    const handleTimeout = useCallback(() => {
        navigate(nextRoute)
    }, [navigate, nextRoute])

    const handleBackHome = () => {
        setIsConfirmModalOpen(true)
    }

    const handleConfirmBackHome = () => {
        endSession()
        navigate('/')
    }

    const retakeLocked = isConcert && !!deadline && Date.now() >= deadline
    const swipe = useSwipe(handlePrevSlide, handleNextSlide, touch && captureSlots.length > 1)

    useButtonHints({
        1: captureSlots.length > 1 ? { label: 'Foto berikutnya', onScreen: true } : null,
        2: retakeLocked ? null : { label: 'Ulangi foto ini' },
        3: { label: isConcert ? 'Lanjut cetak' : 'Lanjut', primary: true }
    })

    if (!currentSession || !sessionFrame) return null

    return (
        <motion.div
            className={styles.container}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <SessionTimer
                duration={isConcert ? concertSecondsLeft : config.postProcessingTimeout || 120}
                onTimeout={handleTimeout}
                enabled={isConcert || config.sessionTimerEnabled}
                label={isConcert ? 'Sisa Waktu' : 'Review Photos'}
            />

            <div className={styles.content}>
                <header className={styles.header}>
                    <div>
                        <h1 className="kiosk-title">
                            Foto <em className="kiosk-num">{activeIndex + 1}</em> <span className="kiosk-num">/ {captureSlots.length}</span>
                        </h1>
                    </div>
                    <button onClick={handleBackHome} className={styles.backBtn}>Batal</button>
                </header>

                {/* Single Unified Container Card */}
                <div className={styles.unifiedCardContainer}>
                    {/* Top Portion: Photo Strip Frame Preview */}
                    <div className={styles.topSection}>
                        <div className={styles.framePreviewContainer} ref={containerRef}>
                            <div
                                className={styles.frameCanvas}
                                style={{
                                    width: `${sessionFrame.canvasWidth}px`,
                                    height: `${sessionFrame.canvasHeight}px`,
                                    transform: `scale(${scale})`,
                                    transformOrigin: 'center center'
                                }}
                            >
                                {/* Render photo slots */}
                                {sessionFrame.slots.map((slot) => {
                                    const sourceSlotId = slot.duplicateOfSlotId || slot.id
                                    const photo = photos.find(p => p.slotId === sourceSlotId)
                                    const activeSlot = captureSlots[activeIndex]
                                    const isSelectedSlot = activeSlot && (activeSlot.id === slot.id || activeSlot.id === slot.duplicateOfSlotId)

                                    return (
                                        <div
                                            key={slot.id}
                                            className={`${styles.slotArea} ${isSelectedSlot ? styles.activeSlotHighlight : ''}`}
                                            style={{
                                                position: 'absolute',
                                                left: `${slot.x}px`,
                                                top: `${slot.y}px`,
                                                width: `${slot.width}px`,
                                                height: `${slot.height}px`,
                                                transform: `rotate(${slot.rotation || 0}deg)`
                                            }}
                                        >
                                            {photo ? (
                                                <img
                                                    src={photo.imagePath}
                                                    alt={`Slot ${slot.id}`}
                                                    className={styles.slotImage}
                                                />
                                            ) : (
                                                <div className={styles.emptySlotPlaceholder}>Kosong</div>
                                            )}
                                        </div>
                                    )
                                })}

                                {/* Frame Overlay */}
                                {sessionFrame.overlayPath && (
                                    <img
                                        src={sessionFrame.overlayPath.startsWith('http') || sessionFrame.overlayPath.startsWith('data:') ? sessionFrame.overlayPath : `file:///${sessionFrame.overlayPath.replace(/\\/g, '/')}`}
                                        alt="Frame Overlay"
                                        className={styles.frameOverlayImage}
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Bottom Portion: Maximized Centered 3D Sliding Carousel for Individual Photos */}
                    <div className={styles.bottomSection} ref={bottomRef}>
                        <motion.div className={styles.carouselContainer} {...swipe}>
                            <div className={styles.carouselCenterTrack}>
                                {captureSlots.map((slot, index) => {
                                    const sourceSlotId = slot.duplicateOfSlotId || slot.id
                                    const photo = photos.find(p => p.slotId === sourceSlotId)
                                    const offset = index - activeIndex
                                    const isCenter = index === activeIndex

                                    // Cards keep the slot's own aspect ratio so nothing important is cropped
                                    const isPortraitMode = config.appOrientation === 'portrait'
                                    const slotAspect = captureSlots[0] ? captureSlots[0].width / captureSlots[0].height : 1.5
                                    // Touch booth: the card fills the measured section; only the active photo shows,
                                    // neighbours wait off to the side (transparent) so a swipe glides them in
                                    const touchCardHeight = bottomSize.height > 0
                                        ? Math.min((bottomSize.height * 0.8) / 1.1, (bottomSize.width * 0.84) / 1.1 / slotAspect)
                                        : 400
                                    const cardHeight = single ? Math.round(touchCardHeight) : isPortraitMode ? 380 : 400
                                    const cardWidth = Math.round(cardHeight * slotAspect)

                                    const cardSpacing = single ? cardWidth * 1.3 : cardWidth * 0.85
                                    const translateX = offset * cardSpacing
                                    const cardScale = isCenter ? 1.1 : single ? 0.88 : Math.max(0.55, 0.8 - Math.abs(offset) * 0.2)
                                    const cardOpacity = isCenter ? 1 : single ? 0 : Math.max(0.35, 1 - Math.abs(offset) * 0.4)
                                    const zIndex = 100 - Math.abs(offset)

                                    if (Math.abs(offset) > 3) return null

                                    return (
                                        <motion.div
                                            key={slot.id}
                                            className={`${styles.carouselCard} ${isCenter ? styles.centerCard : styles.sideCard}`}
                                            onClick={touch ? undefined : () => setActiveIndex(index)}
                                            style={{
                                                width: `${cardWidth}px`,
                                                height: `${cardHeight}px`,
                                                marginLeft: `-${cardWidth / 2}px`,
                                                marginTop: `-${cardHeight / 2}px`
                                            }}
                                            animate={{
                                                x: translateX,
                                                scale: cardScale,
                                                opacity: cardOpacity,
                                                zIndex
                                            }}
                                            transition={{
                                                type: 'spring',
                                                stiffness: 300,
                                                damping: 26
                                            }}
                                        >
                                            <div className={styles.cardImageWrapper}>
                                                {photo ? (
                                                    <img
                                                        src={photo.imagePath}
                                                        alt={`Foto ${index + 1}`}
                                                        className={styles.cardImage}
                                                    />
                                                ) : (
                                                    <div className={styles.cardPlaceholder}>Belum ada foto</div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </motion.div>
                        {single && captureSlots.length > 1 && (
                            <div className={styles.touchDots} aria-hidden="true">
                                {captureSlots.map((slot, i) => (
                                    <span key={slot.id} className={i === activeIndex ? styles.touchDotActive : styles.touchDot} />
                                ))}
                            </div>
                        )}
                    </div>
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

export default PhotoReviewPage
