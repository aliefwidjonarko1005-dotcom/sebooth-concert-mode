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
    const { currentSession, photos, removePhoto, endSession, deadline, updatePhoto } = useSessionStore()
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
    const [isAdjusting, setIsAdjusting] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [imgNaturalSizes, setImgNaturalSizes] = useState<Record<string, { width: number; height: number }>>({})

    const dragStartRef = useRef<{ clientX: number; clientY: number; startPanX: number; startPanY: number } | null>(null)
    const pinchDistRef = useRef<number | null>(null)
    const pinchStartScaleRef = useRef<number>(1)

    const containerRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const bottomSize = useElementSize(bottomRef)
    const touch = useInputMode() === 'touch'
    const single = touch || config.appOrientation === 'portrait'

    // Redirect if no session or photos
    useEffect(() => {
        if (!currentSession || photos.length === 0) {
            navigate('/capture')
        }
    }, [currentSession, photos, navigate])

    // Clean up camera live view if exiting the capture/retake flow
    useEffect(() => {
        return () => {
            const path = window.location.pathname
            const hash = window.location.hash
            const isGoingToCapture = path === '/capture' || hash.startsWith('#/capture')
            if (!isGoingToCapture) {
                console.log('[PhotoReviewPage] Exiting photo capture flow. Stopping DSLR live view...')
                window.api?.camera?.stopLiveView?.().catch(() => {})
            }
        }
    }, [])

    const sessionFrame = frames.find(f => f.id === currentSession?.frameId) || frames[0]

    // Non-duplicate slots only (the actual photos user captured)
    const captureSlots = sessionFrame?.slots.filter(s => !s.duplicateOfSlotId) || []
    const activeSlot = captureSlots[activeIndex]
    const sourceSlotId = activeSlot ? (activeSlot.duplicateOfSlotId || activeSlot.id) : ''
    const activePhoto = photos.find(p => p.slotId === sourceSlotId)
    const currentScale = activePhoto?.scale || 1
    const currentPanX = activePhoto?.panX || 0
    const currentPanY = activePhoto?.panY || 0

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

    // Slide navigation
    const handlePrevSlide = useCallback(() => {
        if (captureSlots.length === 0) return
        setActiveIndex(prev => (prev - 1 + captureSlots.length) % captureSlots.length)
    }, [captureSlots.length])

    const handleNextSlide = useCallback(() => {
        if (captureSlots.length === 0) return
        setActiveIndex(prev => (prev + 1) % captureSlots.length)
    }, [captureSlots.length])

    // Retake Active Photo
    const handleRetakePhoto = useCallback(() => {
        if (captureSlots.length === 0 || !activeSlot) return
        if (isConcert && deadline && Date.now() >= deadline) return
        removePhoto(sourceSlotId)
        navigate('/capture')
    }, [captureSlots, activeSlot, sourceSlotId, removePhoto, navigate, isConcert, deadline])

    // Continue to next page (/review for post processing or /finalize for concert)
    const handleContinue = useCallback(() => {
        navigate(nextRoute)
    }, [navigate, nextRoute])

    // Calculate maximum pan bounds to prevent empty gaps around slot
    const calculateMaxPan = useCallback((scaleVal: number) => {
        if (!activeSlot) return { maxPanX: 100, maxPanY: 100 }
        const natural = imgNaturalSizes[sourceSlotId]
        const imgAspect = natural && natural.width && natural.height
            ? natural.width / natural.height
            : 1.5
        const slotAspect = activeSlot.width / activeSlot.height
        let drawW: number
        let drawH: number
        if (imgAspect > slotAspect) {
            drawH = activeSlot.height
            drawW = activeSlot.height * imgAspect
        } else {
            drawW = activeSlot.width
            drawH = activeSlot.width / imgAspect
        }
        const effectiveW = drawW * scaleVal
        const effectiveH = drawH * scaleVal
        const maxPanX = Math.max(0, (effectiveW - activeSlot.width) / 2)
        const maxPanY = Math.max(0, (effectiveH - activeSlot.height) / 2)
        return { maxPanX, maxPanY }
    }, [activeSlot, sourceSlotId, imgNaturalSizes])

    // Zoom adjustment handler
    const handleZoomChange = useCallback((newScale: number) => {
        if (!sourceSlotId || !activeSlot) return
        const clampedScale = Math.min(2.5, Math.max(1, Math.round(newScale * 100) / 100))
        const { maxPanX, maxPanY } = calculateMaxPan(clampedScale)
        const clampedPanX = Math.min(maxPanX, Math.max(-maxPanX, currentPanX))
        const clampedPanY = Math.min(maxPanY, Math.max(-maxPanY, currentPanY))
        updatePhoto(sourceSlotId, {
            scale: clampedScale,
            panX: clampedPanX,
            panY: clampedPanY
        })
    }, [sourceSlotId, activeSlot, calculateMaxPan, currentPanX, currentPanY, updatePhoto])

    // Reset adjustments
    const handleReset = useCallback(() => {
        if (!sourceSlotId) return
        updatePhoto(sourceSlotId, {
            scale: 1,
            panX: 0,
            panY: 0
        })
    }, [sourceSlotId, updatePhoto])

    // Physical Hardware Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if (isAdjusting) {
                if (e.key === '1') {
                    e.preventDefault()
                    handleReset()
                } else if (e.key === '2') {
                    e.preventDefault()
                    const nextScale = currentScale >= 2.2 ? 1.0 : currentScale + 0.25
                    handleZoomChange(nextScale)
                } else if (e.key === '3' || e.key === 'Escape' || e.key === 'Enter') {
                    e.preventDefault()
                    setIsAdjusting(false)
                }
                return
            }

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
    }, [isAdjusting, currentScale, handleReset, handleZoomChange, handleNextSlide, handleRetakePhoto, handleContinue])

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
    // Swipe is disabled during photo adjustment so panning won't trigger slide change
    const swipe = useSwipe(handlePrevSlide, handleNextSlide, touch && captureSlots.length > 1 && !isAdjusting)

    // Button Rail Hints
    useButtonHints(isAdjusting ? {
        1: { label: 'Reset posisi', onScreen: true },
        2: { label: `Zoom (+${Math.round(currentScale * 100)}%)`, onScreen: true },
        3: { label: 'Selesai atur', primary: true, onScreen: true }
    } : {
        1: captureSlots.length > 1 ? { label: 'Foto berikutnya', onScreen: true } : null,
        2: retakeLocked ? null : { label: 'Ulangi foto ini' },
        3: { label: isConcert ? 'Lanjut cetak' : 'Lanjut', primary: true }
    })

    if (!currentSession || !sessionFrame) return null

    // Sizing for carousel cards
    const isPortraitMode = config.appOrientation === 'portrait'
    const slotAspect = captureSlots[0] ? captureSlots[0].width / captureSlots[0].height : 1.5
    const touchCardHeight = bottomSize.height > 0
        ? Math.min((bottomSize.height * 0.78) / 1.1, (bottomSize.width * 0.84) / 1.1 / slotAspect)
        : 400
    const cardHeight = single ? Math.round(touchCardHeight) : isPortraitMode ? 380 : 400
    const cardWidth = Math.round(cardHeight * slotAspect)
    const previewRatio = activeSlot && cardWidth ? (cardWidth / activeSlot.width) : 1

    // Drag handlers for panning
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isAdjusting) return
        e.currentTarget.setPointerCapture(e.pointerId)
        dragStartRef.current = {
            clientX: e.clientX,
            clientY: e.clientY,
            startPanX: currentPanX,
            startPanY: currentPanY
        }
        setIsDragging(true)
    }

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging || !dragStartRef.current || !activeSlot || !sourceSlotId) return
        const dx = (e.clientX - dragStartRef.current.clientX) / previewRatio
        const dy = (e.clientY - dragStartRef.current.clientY) / previewRatio
        const { maxPanX, maxPanY } = calculateMaxPan(currentScale)
        const newPanX = Math.min(maxPanX, Math.max(-maxPanX, Math.round(dragStartRef.current.startPanX + dx)))
        const newPanY = Math.min(maxPanY, Math.max(-maxPanY, Math.round(dragStartRef.current.startPanY + dy)))
        updatePhoto(sourceSlotId, {
            panX: newPanX,
            panY: newPanY
        })
    }

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging) return
        setIsDragging(false)
        try {
            e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
        dragStartRef.current = null
    }

    // Touch pinch-to-zoom
    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
        if (!isAdjusting) return
        if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            )
            pinchDistRef.current = dist
            pinchStartScaleRef.current = currentScale
        }
    }

    const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
        if (!isAdjusting || e.touches.length !== 2 || pinchDistRef.current === null) return
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        )
        const factor = dist / pinchDistRef.current
        handleZoomChange(pinchStartScaleRef.current * factor)
    }

    const handleTouchEnd = () => {
        pinchDistRef.current = null
    }

    // Mouse wheel zoom
    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        if (!isAdjusting) return
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        handleZoomChange(currentScale + delta)
    }

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
                                    const sourceSlot = slot.duplicateOfSlotId || slot.id
                                    const photo = photos.find(p => p.slotId === sourceSlot)
                                    const isSelectedSlot = activeSlot && (activeSlot.id === slot.id || activeSlot.id === slot.duplicateOfSlotId)

                                    return (
                                        <div
                                            key={slot.id}
                                            className={`${styles.slotArea} ${isSelectedSlot ? styles.activeSlotHighlight : ''}`}
                                            onClick={() => {
                                                const targetIdx = captureSlots.findIndex(s => s.id === sourceSlot)
                                                if (targetIdx !== -1) setActiveIndex(targetIdx)
                                            }}
                                            style={{
                                                position: 'absolute',
                                                left: `${slot.x}px`,
                                                top: `${slot.y}px`,
                                                width: `${slot.width}px`,
                                                height: `${slot.height}px`,
                                                transform: `rotate(${slot.rotation || 0}deg)`,
                                                cursor: 'pointer'
                                            }}
                                            title={`Pilih Slot ${slot.id}`}
                                        >
                                            {photo ? (
                                                <img
                                                    src={photo.imagePath}
                                                    alt={`Slot ${slot.id}`}
                                                    className={styles.slotImage}
                                                    style={{
                                                        transform: `translate(${photo.panX || 0}px, ${photo.panY || 0}px) scale(${photo.scale || 1})`,
                                                        transformOrigin: 'center center'
                                                    }}
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
                                    const slotSourceId = slot.duplicateOfSlotId || slot.id
                                    const photo = photos.find(p => p.slotId === slotSourceId)
                                    const offset = index - activeIndex
                                    const isCenter = index === activeIndex

                                    const cardSpacing = single ? cardWidth * 1.3 : cardWidth * 0.85
                                    const translateX = offset * cardSpacing
                                    const cardScale = isCenter ? 1.1 : single ? 0.88 : Math.max(0.55, 0.8 - Math.abs(offset) * 0.2)
                                    const cardOpacity = isCenter ? 1 : single ? 0 : Math.max(0.35, 1 - Math.abs(offset) * 0.4)
                                    const zIndex = 100 - Math.abs(offset)
                                    const cardSlotRatio = slot.width ? (cardWidth / slot.width) : 1
                                    const isPhotoAdjusted = (photo?.scale && photo.scale !== 1) || (photo?.panX && photo.panX !== 0) || (photo?.panY && photo.panY !== 0)

                                    if (Math.abs(offset) > 3) return null

                                    return (
                                        <motion.div
                                            key={slot.id}
                                            className={`${styles.carouselCard} ${isCenter ? styles.centerCard : styles.sideCard} ${isCenter && isAdjusting ? styles.centerCardAdjusting : ''}`}
                                            onClick={touch || isCenter ? undefined : () => setActiveIndex(index)}
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
                                            <div
                                                className={styles.cardImageWrapper}
                                                onPointerDown={isCenter && isAdjusting ? handlePointerDown : undefined}
                                                onPointerMove={isCenter && isAdjusting ? handlePointerMove : undefined}
                                                onPointerUp={isCenter && isAdjusting ? handlePointerUp : undefined}
                                                onPointerCancel={isCenter && isAdjusting ? handlePointerUp : undefined}
                                                onTouchStart={isCenter && isAdjusting ? handleTouchStart : undefined}
                                                onTouchMove={isCenter && isAdjusting ? handleTouchMove : undefined}
                                                onTouchEnd={isCenter && isAdjusting ? handleTouchEnd : undefined}
                                                onWheel={isCenter && isAdjusting ? handleWheel : undefined}
                                                style={{
                                                    cursor: isCenter && isAdjusting ? (isDragging ? 'grabbing' : 'grab') : 'default',
                                                    touchAction: isCenter && isAdjusting ? 'none' : 'auto',
                                                    position: 'relative'
                                                }}
                                            >
                                                {photo ? (
                                                    <img
                                                        src={photo.imagePath}
                                                        alt={`Foto ${index + 1}`}
                                                        className={styles.cardImage}
                                                        draggable={false}
                                                        onLoad={(e) => {
                                                            const img = e.currentTarget
                                                            if (img.naturalWidth && img.naturalHeight) {
                                                                setImgNaturalSizes(prev => ({
                                                                    ...prev,
                                                                    [slotSourceId]: { width: img.naturalWidth, height: img.naturalHeight }
                                                                }))
                                                            }
                                                        }}
                                                        style={{
                                                            transform: `translate(${(photo.panX || 0) * cardSlotRatio}px, ${(photo.panY || 0) * cardSlotRatio}px) scale(${photo.scale || 1})`,
                                                            transformOrigin: 'center center',
                                                            pointerEvents: 'none',
                                                            userSelect: 'none'
                                                        }}
                                                    />
                                                ) : (
                                                    <div className={styles.cardPlaceholder}>Belum ada foto</div>
                                                )}

                                                {/* Adjusted indicator badge */}
                                                {isCenter && !isAdjusting && isPhotoAdjusted && (
                                                    <div className={styles.adjustedBadge}>
                                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12"/>
                                                        </svg>
                                                        <span>Disesuaikan</span>
                                                    </div>
                                                )}

                                                {/* Open Adjust Mode Button when viewing active photo */}
                                                {isCenter && !isAdjusting && photo && (
                                                    <button
                                                        type="button"
                                                        className={styles.adjustOpenBtn}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setIsAdjusting(true)
                                                        }}
                                                        title="Atur posisi geser dan zoom foto ini"
                                                    >
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <circle cx="11" cy="11" r="8"/>
                                                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                                                            <line x1="11" y1="8" x2="11" y2="14"/>
                                                            <line x1="8" y1="11" x2="14" y2="11"/>
                                                        </svg>
                                                        <span>Sesuaikan Foto</span>
                                                    </button>
                                                )}

                                                {/* Adjust Overlay with Grid & Drag Hint */}
                                                {isCenter && isAdjusting && (
                                                    <div className={styles.adjustOverlay}>
                                                        <div className={styles.gridContainer}>
                                                            <div className={styles.gridLineH1} />
                                                            <div className={styles.gridLineH2} />
                                                            <div className={styles.gridLineV1} />
                                                            <div className={styles.gridLineV2} />
                                                        </div>
                                                        <div className={styles.dragHintBadge}>
                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                                <polyline points="5 9 2 12 5 15"/>
                                                                <polyline points="9 5 12 2 15 5"/>
                                                                <polyline points="15 19 12 22 9 19"/>
                                                                <polyline points="19 9 22 12 19 15"/>
                                                                <line x1="2" y1="12" x2="22" y2="12"/>
                                                                <line x1="12" y1="2" x2="12" y2="22"/>
                                                            </svg>
                                                            <span>Tahan & geser untuk atur posisi</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )
                                })}
                            </div>
                        </motion.div>

                        {/* Navigation Arrows for fast browsing (< and >) */}
                        {captureSlots.length > 1 && !isAdjusting && (
                            <>
                                <button
                                    type="button"
                                    className={`${styles.navArrowBtn} ${styles.navArrowLeft}`}
                                    onClick={handlePrevSlide}
                                    aria-label="Foto Sebelumnya"
                                    title="Foto Sebelumnya"
                                >
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="15 18 9 12 15 6" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.navArrowBtn} ${styles.navArrowRight}`}
                                    onClick={handleNextSlide}
                                    aria-label="Foto Berikutnya"
                                    title="Foto Berikutnya"
                                >
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                </button>
                            </>
                        )}

                        {/* Floating Adjustment Toolbar Dock when Adjusting */}
                        {isAdjusting && (
                            <div className={styles.adjustToolbar}>
                                <div className={styles.zoomGroup}>
                                    <button
                                        type="button"
                                        className={styles.zoomBtn}
                                        onClick={() => handleZoomChange(currentScale - 0.1)}
                                        disabled={currentScale <= 1.0}
                                        title="Perkecil Zoom"
                                    >
                                        −
                                    </button>
                                    <input
                                        type="range"
                                        min="1"
                                        max="2.5"
                                        step="0.05"
                                        value={currentScale}
                                        onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                                        className={styles.zoomSlider}
                                        aria-label="Zoom foto"
                                    />
                                    <button
                                        type="button"
                                        className={styles.zoomBtn}
                                        onClick={() => handleZoomChange(currentScale + 0.1)}
                                        disabled={currentScale >= 2.5}
                                        title="Perbesar Zoom"
                                    >
                                        +
                                    </button>
                                    <span className={styles.zoomBadge}>
                                        {Math.round(currentScale * 100)}%
                                    </span>
                                </div>

                                <div className={styles.toolbarDivider} />

                                <button
                                    type="button"
                                    className={styles.resetBtn}
                                    onClick={handleReset}
                                    title="Kembalikan posisi dan zoom ke awal"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="1 4 1 10 7 10"/>
                                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                                    </svg>
                                    <span>Reset</span>
                                </button>

                                <button
                                    type="button"
                                    className={styles.doneBtn}
                                    onClick={() => setIsAdjusting(false)}
                                    title="Selesai menyesuaikan foto"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                    <span>Selesai</span>
                                </button>
                            </div>
                        )}

                        {/* Touch Dots */}
                        {single && captureSlots.length > 1 && !isAdjusting && (
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
