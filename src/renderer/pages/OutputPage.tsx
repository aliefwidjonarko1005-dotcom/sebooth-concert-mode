import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useFrameStore, useSessionStore, useAppConfig } from '../stores'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import styles from './OutputPage.module.css'
import { useEmitOnChange, emitMascot } from '../lib/mascotEvents'
import { useElementSize } from '../lib/useElementHeight'
import { useButtonHints, useInputMode } from '../components/ButtonRail/ButtonRail'
import { useSwipe } from '../lib/useSwipe'
import { buildComposite, buildGifFrames, buildSaveParams, getPhotoForSlot, getQRUrl } from '../lib/composite'
import Lottie from 'lottie-react'
import PA22Animation from '../assets/PA22.json'

type OutputMediaType = 'strip' | 'gif' | 'live'

interface OutputItemDef {
    id: OutputMediaType
    title: string
}

const OUTPUT_ITEMS: OutputItemDef[] = [
    { id: 'strip', title: 'Photostrip' },
    { id: 'gif', title: 'GIF' },
    { id: 'live', title: 'Live Photo' }
]

// Helper function to calculate circular offset relative to active index
const getCircularOffset = (index: number, activeIndex: number, length: number): number => {
    let diff = index - activeIndex
    while (diff > length / 2) diff -= length
    while (diff <= -length / 2) diff += length
    return diff
}

function OutputPage(): JSX.Element | null {
    const navigate = useNavigate()
    const { frames, activeFrame } = useFrameStore()
    const { photos, currentSession, setCompositePath, selectedFilter, isMirrored, endSession } = useSessionStore()
    const { config } = useAppConfig()

    const sessionFrame = currentSession?.frameId
        ? frames.find(f => f.id === currentSession.frameId)
        : activeFrame

    const [activeIndex, setActiveIndex] = useState<number>(0)
    const [gifDataUrl, setGifDataUrl] = useState<string | null>(null)
    // Natural aspect (w/h) of the generated GIF, read when it loads; sizes its card in touch mode
    const [gifAspect, setGifAspect] = useState<number | null>(null)
    const [liveVideoPath, setLiveVideoPath] = useState<string | null>(null)
    const [compositeDataUrl, setCompositeDataUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isProcessing, setIsProcessing] = useState(true)
    const [isUploading, setIsUploading] = useState(false)
    const [uploadStatus, setUploadStatus] = useState<string>('')
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const { setCloudSessionId } = useSessionStore()

    const canvasRef = useRef<HTMLCanvasElement>(null)
    const uploadLockRef = useRef<string | null>(null)
    const carouselRef = useRef<HTMLDivElement>(null)
    const workspace = useElementSize(carouselRef)
    const workspaceHeight = workspace.height

    // Generate composite when photos, frame, or filter changes
    useEffect(() => {
        if (photos.length > 0 && sessionFrame) {
            generateMedia()
        }
    }, [photos, sessionFrame, selectedFilter])

    const generateMedia = async () => {
        setIsProcessing(true)
        try {
            await generateCompositeFromPhotos()
            await generateGif()
            extractLiveVideo()
        } finally {
            setIsProcessing(false)
        }
    }

    // Save locally + queue cloud upload in the background once media is ready (never blocks the flow)
    useEffect(() => {
        if (!isProcessing && compositeDataUrl) {
            handleCloudUpload()
        }
    }, [isProcessing, compositeDataUrl, config.sharingMode])

    const handleCloudUpload = async () => {
        const sessionId = currentSession?.id
        if (!sessionId || !sessionFrame || uploadLockRef.current === sessionId) return
        uploadLockRef.current = sessionId

        try {
            const save = await buildSaveParams({
                config,
                sessionId,
                frame: sessionFrame,
                photos,
                stripDataUrl: compositeDataUrl || undefined,
                gifDataUrl: gifDataUrl || undefined,
                mirror: isMirrored
            })
            await window.api.system.finalizeSession({
                save,
                upload: config.sharingMode === 'cloud'
                    ? { eventName: config.eventName || 'Sebooth Event', frameName: sessionFrame.name || '-' }
                    : undefined
            })
            setUploadStatus('Media disimpan & diunggah otomatis di background.')
        } catch (err) {
            console.error('Failed to queue session media:', err)
            uploadLockRef.current = null
        } finally {
            setCloudSessionId(sessionId)
        }
    }

    const extractLiveVideo = () => {
        const videoPhoto = photos.find(p => p.videoPath && !p.videoPath.startsWith('blob:'))
        if (videoPhoto && videoPhoto.videoPath) {
            setLiveVideoPath(`file://${videoPhoto.videoPath.replace(/\\/g, '/')}`)
        }
    }

    const generateGif = async () => {
        if (photos.length === 0 || !sessionFrame) return
        try {
            const framesBase64 = await buildGifFrames(sessionFrame, photos, isMirrored)
            const hqGifResult = await window.api.system.generateHqGif(framesBase64, 500)
            if (hqGifResult.success && hqGifResult.data) {
                setGifDataUrl(hqGifResult.data)
            }
        } catch (e) {
            console.error('GIF Gen Error', e)
        }
    }

    const generateCompositeFromPhotos = async (): Promise<void> => {
        if (!sessionFrame || photos.length === 0 || !canvasRef.current || !currentSession) return
        try {
            const dataUrl = await buildComposite({
                frame: sessionFrame,
                photos,
                filter: selectedFilter,
                mirror: isMirrored,
                qrUrl: await getQRUrl(config, currentSession.id),
                canvas: canvasRef.current
            })
            setCompositeDataUrl(dataUrl)
            setCompositePath(dataUrl)
        } catch (error) {
            console.error('Failed to generate composite:', error)
            setError('Failed to generate composite image')
        }
    }

    // Circular Carousel Navigation Handlers
    // 1: Back (Prev)
    // 2: Next
    // 3: Lanjutkan (/sharing)
    const handlePrevMedia = useCallback(() => {
        setActiveIndex(prev => (prev - 1 + OUTPUT_ITEMS.length) % OUTPUT_ITEMS.length)
    }, [])

    const handleNextMedia = useCallback(() => {
        setActiveIndex(prev => (prev + 1) % OUTPUT_ITEMS.length)
    }, [])

    const handleProceed = useCallback(() => {
        navigate('/sharing')
    }, [navigate])

    useButtonHints(isProcessing || isUploading ? {} : {
        1: { label: 'Sebelumnya', onScreen: true },
        2: { label: 'Berikutnya', onScreen: true },
        3: { label: 'Lanjut', primary: true, onScreen: true }
    })

    // Keyboard navigation according to specifications:
    // Key 1: Back (Previous output in circular loop)
    // Key 2: Next (Next output in circular loop)
    // Key 3: Lanjutkan (Next step to /sharing)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
            if (isProcessing || isUploading) return

            if (e.key === '1') {
                e.preventDefault()
                handlePrevMedia()
            } else if (e.key === '2') {
                e.preventDefault()
                handleNextMedia()
            } else if (e.key === '3') {
                e.preventDefault()
                handleProceed()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isProcessing, isUploading, handlePrevMedia, handleNextMedia, handleProceed])

    const touch = useInputMode() === 'touch'
    const swipe = useSwipe(handlePrevMedia, handleNextMedia, touch)
    useEmitOnChange(activeIndex, () => emitMascot('media', { title: OUTPUT_ITEMS[activeIndex].title }))

    if (!sessionFrame) return null

    // Calculate dimensions for circular 3D carousel cards (Enlarged selected item size)
    const isPortrait = config.appOrientation === 'portrait'
    // Landscape (touch booth) screens vary (1080p at 100-150% scaling): fit the enlarged centre card
    // (scale 1.2) inside the measured workspace. Portrait keeps its fixed, tested size.
    // Landscape: the centre card (scale 1.2) takes the whole workspace minus room for its hard shadow,
    // so the media is as large as possible (people film this screen with their phones)
    // Portrait: as large as the workspace allows in both directions (the stage is narrow), so phones can film it
    const canvasAspect = sessionFrame.canvasWidth / sessionFrame.canvasHeight
    const portraitCardHeight = workspaceHeight > 0
        ? Math.min((workspaceHeight - 76) / 1.2, (workspace.width * 0.78) / 1.2 / canvasAspect)
        : 520
    const targetCardHeight = isPortrait ? portraitCardHeight : workspaceHeight > 0 ? (workspaceHeight - 76) / 1.2 : 600
    const cardScaleFactor = targetCardHeight / sessionFrame.canvasHeight
    const scaledWidth = sessionFrame.canvasWidth * cardScaleFactor
    const scaledHeight = sessionFrame.canvasHeight * cardScaleFactor
    // Touch booth: each card hugs its own medium (strip/live = frame canvas, GIF = the GIF), so no letterbox.
    // Card = title tape (~64px) + padding (32px) above/around a body of the medium's aspect.
    const CARD_CHROME_H = 24 // landscape card: 12px padding each side; the title tape sits on the top edge
    const mediaAspect = (id: OutputMediaType): number => {
        if (id === 'gif') {
            const slot = sessionFrame.slots.find(s => !s.duplicateOfSlotId)
            return gifAspect || (slot ? slot.width / slot.height : 4 / 3)
        }
        return sessionFrame.canvasWidth / sessionFrame.canvasHeight
    }
    const touchCardWidth = (id: OutputMediaType): number =>
        Math.max(160, (scaledHeight - CARD_CHROME_H) * mediaAspect(id) + 32)
    const widestTouchCard = Math.max(...OUTPUT_ITEMS.map(i => touchCardWidth(i.id)))
    // Side cards (scale 0.5) must stay fully on screen: cap the spacing by the measured stage width
    const maxTouchSpacing = workspace.width > 0 ? workspace.width / 2 - (widestTouchCard * 0.5) / 2 - 32 : Infinity
    const portraitMaxSpacing = workspace.width > 0 ? workspace.width / 2 - (scaledWidth * 0.5) / 2 - 16 : Infinity
    const spacingX = isPortrait ? Math.min(scaledWidth * 0.88, portraitMaxSpacing) : touch ? Math.min(widestTouchCard * 0.95, maxTouchSpacing) : scaledWidth * 1.10

    // Helper to render media inside a card
    const renderMediaContent = (mediaId: OutputMediaType) => {
        if (mediaId === 'strip') {
            return compositeDataUrl ? (
                <img src={compositeDataUrl} alt="Photostrip" className={styles.mediaContentImage} />
            ) : (
                <div className={styles.loadingMedia}>
                    <div className={styles.mediaSpinner} />
                    <span>Memproses Photostrip...</span>
                </div>
            )
        }

        if (mediaId === 'gif') {
            return gifDataUrl ? (
                <img
                    src={gifDataUrl}
                    alt="GIF"
                    className={styles.mediaContentImage}
                    onLoad={(e) => {
                        const im = e.currentTarget
                        if (im.naturalWidth && im.naturalHeight) setGifAspect(im.naturalWidth / im.naturalHeight)
                    }}
                />
            ) : (
                <div className={styles.loadingMedia}>
                    <div className={styles.mediaSpinner} />
                    <span>Memproses GIF...</span>
                </div>
            )
        }

        if (mediaId === 'live') {
            const scaleY = (targetCardHeight * 0.88) / sessionFrame.canvasHeight
            const scaleX = (scaledWidth * 0.88) / sessionFrame.canvasWidth
            const scale = Math.min(scaleX, scaleY, 1)

            let filterStyle: React.CSSProperties = {}
            if (selectedFilter === 'grayscale') filterStyle = { filter: 'grayscale(100%)' }
            else if (selectedFilter === 'sepia') filterStyle = { filter: 'sepia(80%)' }
            else if (selectedFilter === 'warm') filterStyle = { filter: 'saturate(1.3) hue-rotate(-10deg)' }
            else if (selectedFilter === 'cool') filterStyle = { filter: 'saturate(1.1) hue-rotate(10deg)' }
            else if (selectedFilter === 'vintage') filterStyle = { filter: 'contrast(1.1) brightness(0.9) sepia(30%)' }

            return (
                <div style={{
                    position: 'relative',
                    width: sessionFrame.canvasWidth * scale,
                    height: sessionFrame.canvasHeight * scale,
                    borderRadius: '12px',
                    overflow: 'hidden',
                    backgroundColor: 'white'
                }}>
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: sessionFrame.canvasWidth,
                        height: sessionFrame.canvasHeight,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left'
                    }}>
                        {sessionFrame.slots.map(slot => {
                            const photo = getPhotoForSlot(sessionFrame, photos, slot)
                            if (!photo) return null
                            
                            const isVideo = !!photo.videoPath
                            let src = photo.imagePath
                            if (isVideo) {
                                if (photo.videoPath!.startsWith('blob:') || photo.videoPath!.startsWith('file://')) {
                                    src = photo.videoPath!
                                } else {
                                    src = `file:///${photo.videoPath!.replace(/\\/g, '/')}`
                                }
                            }
                            
                            const cameraRotation = config.cameraRotation || 0
                            const isRotated90or270 = cameraRotation === 90 || cameraRotation === 270

                            // EDSDK clips (camera movie / HDMI fallback) are the raw, unrotated sensor picture:
                            // turn them upright with rotate(-rot) and mirror only like the photos.
                            const isCaptureCardSource = isVideo && config.cameraMode === 'edsdk'

                            const camRotTransform = isCaptureCardSource
                                ? `${isMirrored ? 'scaleX(-1) ' : ''}rotate(${-cameraRotation}deg)`
                                : isVideo && isRotated90or270
                                ? `rotate(${cameraRotation}deg) scaleX(-1)`
                                : isVideo && cameraRotation === 180
                                ? `rotate(180deg) scaleX(-1)`
                                : isVideo && isMirrored
                                ? `scaleX(-1)`
                                : ''

                            const effectiveRotated = isRotated90or270
                            // Raw clips are not cropped yet: show the same centre crop (digital zoom) as the photos/MP4
                            const mediaScale = (photo.scale || 1) * (isVideo ? (config.digitalZoom || 1) : 1)

                            const mediaStyle: React.CSSProperties = {
                                position: 'absolute',
                                top: isVideo && effectiveRotated ? '50%' : 0,
                                left: isVideo && effectiveRotated ? '50%' : 0,
                                width: isVideo && effectiveRotated ? `${slot.height}px` : '100%',
                                height: isVideo && effectiveRotated ? `${slot.width}px` : '100%',
                                objectFit: 'cover',
                                transform: isVideo && effectiveRotated
                                    ? `translate(-50%, -50%) ${camRotTransform} translate(${photo.panX || 0}px, ${photo.panY || 0}px) scale(${mediaScale})`
                                    : `translate(${photo.panX || 0}px, ${photo.panY || 0}px) scale(${mediaScale}) ${camRotTransform}`,
                                transformOrigin: 'center center',
                                ...filterStyle
                            }

                            return (
                                <div key={slot.id} style={{
                                    position: 'absolute',
                                    left: slot.x,
                                    top: slot.y,
                                    width: slot.width,
                                    height: slot.height,
                                    transform: `rotate(${slot.rotation}deg)`,
                                    overflow: 'hidden'
                                }}>
                                    {isVideo ? (
                                        <video src={src} autoPlay loop muted playsInline style={mediaStyle} />
                                    ) : (
                                        <img src={src} style={mediaStyle} />
                                    )}
                                </div>
                            )
                        })}
                        <img 
                            src={`file:///${sessionFrame.overlayPath.replace(/\\/g, '/')}`} 
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                pointerEvents: 'none'
                            }} 
                            alt="Frame Overlay" 
                        />
                    </div>
                </div>
            )
        }

        return null
    }

    return (
        <div className={styles.container}>
            {/* Top Navigation Back Button */}
            <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => setIsConfirmModalOpen(true)}
                title="Back to Home"
                className={styles.backButton}
            >
                Kembali
            </motion.button>

            {error && <div className={styles.errorMessage}>{error}</div>}
            <canvas ref={canvasRef} style={{ display: 'none' }} />

            {/* Loading / Uploading Overlay */}
            <AnimatePresence>
                {(isProcessing || isUploading) && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={styles.loadingOverlay}
                    >
                        <Lottie 
                            animationData={PA22Animation} 
                            loop={true} 
                            style={{ width: 360, height: 360, marginBottom: 'var(--spacing-xl)' }}
                        />
                        <p>{isUploading ? 'Uploading to Cloud...' : 'Processing Magic...'}</p>
                        {uploadStatus && <p className={styles.statusSubtext}>{uploadStatus}</p>}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Header Title */}
            <div className={styles.header}>
                <h2>Sesi Foto Selesai</h2>
                <p>Lihat & Review Hasil Media Anda</p>
            </div>

            {/* 3D Infinite Circular Sliding Carousel */}
            <div className={styles.carouselWorkspace} ref={carouselRef}>
                <motion.div className={styles.carouselCenterTrack} {...swipe}>
                    {OUTPUT_ITEMS.map((item, idx) => {
                        const offset = getCircularOffset(idx, activeIndex, OUTPUT_ITEMS.length)
                        const isCenter = offset === 0
                        const absOffset = Math.abs(offset)

                        let xPos = offset * spacingX
                        let scale = 1.20
                        let opacity = 1
                        let zIndex = 20
                        let rotateY = 0

                        if (!isCenter) {
                            scale = 0.50
                            opacity = 0.40
                            zIndex = 10 - absOffset
                            rotateY = offset > 0 ? -12 : 12
                        }

                        return (
                            <motion.div
                                key={item.id}
                                className={`${styles.slideCardWrapper} ${isCenter ? styles.centerCard : ''}`}
                                style={{
                                    width: touch ? touchCardWidth(item.id) : scaledWidth,
                                    height: scaledHeight,
                                    zIndex
                                }}
                                animate={{
                                    x: xPos,
                                    scale,
                                    opacity,
                                    rotateY
                                }}
                                transition={{
                                    type: 'spring',
                                    stiffness: 280,
                                    damping: 26,
                                    mass: 0.8
                                }}
                                onClick={touch ? undefined : () => {
                                    if (!isCenter) {
                                        setActiveIndex(idx)
                                    }
                                }}
                                onTap={touch ? () => { if (!isCenter) setActiveIndex(idx) } : undefined}
                            >
                                {/* Header Title at Top of Output File Item */}
                                <div className={styles.cardItemHeader}>
                                    <span className={styles.cardItemTitle}>{item.title}</span>
                                </div>

                                {/* Media Content Body */}
                                <div className={styles.cardMediaBody}>
                                    {renderMediaContent(item.id)}
                                </div>
                            </motion.div>
                        )
                    })}
                </motion.div>
            </div>

            {/* Bottom Floating Control Bar with Buttons 1: Back, 2: Next, 3: Lanjutkan */}
            <div className={styles.bottomActionBar}>
                {/* Button 1: Back (Prev Media) */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnBack}`}
                    onClick={handlePrevMedia}
                    title="Tekan 1 untuk Kembali ke media sebelumnya"
                >
                    <span className={styles.btnNumber}>1</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Kembali</span>
                        <span className={styles.btnSublabel}>Media sebelumnya</span>
                    </div>
                </button>

                {/* Button 2: Next Media */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnNextMedia}`}
                    onClick={handleNextMedia}
                    title="Tekan 2 untuk melihat media selanjutnya"
                >
                    <span className={styles.btnNumber}>2</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Selanjutnya</span>
                        <span className={styles.btnSublabel}>Media berikutnya</span>
                    </div>
                </button>

                {/* Button 3: Lanjutkan */}
                <button 
                    className={`${styles.actionBtn} ${styles.btnProceed}`}
                    onClick={handleProceed}
                    title="Tekan 3 untuk lanjut ke halaman Sharing"
                >
                    <span className={styles.btnNumber}>3</span>
                    <div className={styles.btnLabelGroup}>
                        <span className={styles.btnLabel}>Lanjutkan</span>
                        <span className={styles.btnSublabel}>Ke Sharing </span>
                    </div>
                </button>
            </div>

            {/* Confirm Back Home Modal */}
            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={() => {
                    endSession()
                    navigate('/')
                }}
            />
        </div>
    )
}

export default OutputPage

