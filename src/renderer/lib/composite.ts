import QRCode from 'qrcode'
import { AppConfig, CapturedPhoto, FrameConfig, PhotoSlot, QRSlot } from '@shared/types'

const FILTER_CSS: Record<string, string> = {
    grayscale: 'grayscale(100%)',
    sepia: 'sepia(80%)',
    warm: 'saturate(1.3) hue-rotate(-10deg)',
    cool: 'saturate(1.1) hue-rotate(10deg)',
    vintage: 'contrast(1.1) brightness(0.9) sepia(30%)'
}

export const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image()
        if (!src.startsWith('file:///') && !src.startsWith('data:')) {
            img.crossOrigin = 'anonymous'
        }
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = src
    })
}

const resolveSourceSlotId = (frame: FrameConfig, slot: PhotoSlot): string => {
    if (!slot.duplicateOfSlotId) return slot.id
    const sourceSlot = frame.slots.find(s => s.id === slot.duplicateOfSlotId)
    return sourceSlot ? resolveSourceSlotId(frame, sourceSlot) : slot.duplicateOfSlotId
}

export const getPhotoForSlot = (frame: FrameConfig, photos: CapturedPhoto[], slot: PhotoSlot): CapturedPhoto | undefined => {
    const sourceSlotId = resolveSourceSlotId(frame, slot)
    return photos.find(p => p.slotId === sourceSlotId)
}

export const getQRSlots = (frame: any): QRSlot[] => {
    if (frame.qrSlots && frame.qrSlots.length > 0) {
        return frame.qrSlots
    }
    if (frame.qrSlot && frame.qrSlot.enabled) {
        return [{
            id: 'legacy-qr',
            x: frame.qrSlot.x,
            y: frame.qrSlot.y,
            width: frame.qrSlot.width,
            height: frame.qrSlot.height,
            enabled: true
        }]
    }
    return []
}

/** URL encoded in the strip QR. Built offline from the session id; the page goes live once uploads finish. */
export const getQRUrl = async (config: AppConfig, sessionId: string): Promise<string> => {
    if (config.sharingMode === 'cloud') {
        let portalBase = config.cloudPortalUrl
        if (!portalBase) {
            const ipRes = await (window as any).api.system.getLocalIp()
            const localIp = (ipRes && ipRes.success && ipRes.data) ? ipRes.data : 'localhost'
            portalBase = `http://${localIp}:3000`
        }
        portalBase = portalBase.replace(/\/$/, '')
        // "sebooth.in" without a scheme makes the QR plain text on many phone scanners
        if (!/^https?:\/\//i.test(portalBase)) portalBase = `https://${portalBase}`
        return `${portalBase}/access/${sessionId}`
    }
    const ipRes = await (window as any).api.system.getLocalIp()
    const localIp = (ipRes && ipRes.success && ipRes.data) ? ipRes.data : '127.0.0.1'
    return `http://${localIp}:5050/gallery/${sessionId}`
}

/** Draw photos + frame overlay + QR codes into a JPEG data URL. */
export const buildComposite = async (params: {
    frame: FrameConfig
    photos: CapturedPhoto[]
    filter: string
    mirror: boolean
    qrUrl: string
    canvas?: HTMLCanvasElement
}): Promise<string> => {
    const { frame, photos, filter, mirror, qrUrl } = params
    const canvas = params.canvas || document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    canvas.width = frame.canvasWidth
    canvas.height = frame.canvasHeight

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const filterStr = FILTER_CSS[filter] || 'none'

    for (const slot of frame.slots) {
        const photo = getPhotoForSlot(frame, photos, slot)
        if (!photo) continue

        try {
            const img = await loadImage(photo.imagePath)

            ctx.save()
            ctx.filter = filterStr
            ctx.translate(slot.x + slot.width / 2, slot.y + slot.height / 2)
            ctx.rotate((slot.rotation * Math.PI) / 180)

            ctx.beginPath()
            ctx.rect(-slot.width / 2, -slot.height / 2, slot.width, slot.height)
            ctx.clip()

            const imgAspect = img.width / img.height
            const slotAspect = slot.width / slot.height
            let drawWidth, drawHeight

            if (imgAspect > slotAspect) {
                drawHeight = slot.height
                drawWidth = slot.height * imgAspect
            } else {
                drawWidth = slot.width
                drawHeight = slot.width / imgAspect
            }

            const scale = photo.scale || 1
            const panX = photo.panX || 0
            const panY = photo.panY || 0

            if (mirror) {
                ctx.scale(-1, 1)
                ctx.translate(-panX, panY)
            } else {
                ctx.translate(panX, panY)
            }
            ctx.scale(scale, scale)

            ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
            ctx.restore()
        } catch (err) {
            console.error('Failed to load photo:', err)
        }
    }

    try {
        ctx.filter = 'none'

        const frameImg = await loadImage(`file://${frame.overlayPath}`)
        const frameAspect = frameImg.width / frameImg.height
        const canvasAspect = canvas.width / canvas.height

        let fw = canvas.width
        let fh = canvas.height
        let fx = 0
        let fy = 0

        if (Math.abs(frameAspect - canvasAspect) > 0.01) {
            if (frameAspect > canvasAspect) {
                fw = canvas.width
                fh = canvas.width / frameAspect
                fy = (canvas.height - fh) / 2
            } else {
                fh = canvas.height
                fw = canvas.height * frameAspect
                fx = (canvas.width - fw) / 2
            }
        }

        ctx.drawImage(frameImg, fx, fy, fw, fh)
    } catch (err) {
        console.error('Failed to load frame overlay:', err)
    }

    const activeQrSlots = getQRSlots(frame)
    if (activeQrSlots.length > 0 && qrUrl) {
        try {
            const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1 })
            const qrImg = await loadImage(qrDataUrl)
            for (const qrSlot of activeQrSlots) {
                if (!qrSlot.enabled) continue
                ctx.drawImage(qrImg, qrSlot.x, qrSlot.y, qrSlot.width, qrSlot.height)
            }
        } catch (qrErr) {
            console.error('Failed to draw QR code on composite:', qrErr)
        }
    }

    return canvas.toDataURL('image/jpeg', 0.95)
}

/** JPEG frames (one per photo) for the main-process HQ GIF encoder. */
export const buildGifFrames = async (frame: FrameConfig, photos: CapturedPhoto[], mirror: boolean): Promise<string[]> => {
    const gifCanvas = document.createElement('canvas')
    const firstSlot = frame.slots?.[0]
    const slotAspect = firstSlot ? (firstSlot.width / firstSlot.height) : 1.5
    gifCanvas.width = 1080
    gifCanvas.height = Math.round(1080 / slotAspect)
    const gctx = gifCanvas.getContext('2d', { willReadFrequently: true, alpha: false })
    if (!gctx) return []

    gctx.imageSmoothingEnabled = true
    gctx.imageSmoothingQuality = 'high'
    const framesBase64: string[] = []

    for (const photo of photos) {
        const img = await loadImage(photo.imagePath)
        const imgAspect = img.width / img.height
        const canvasAspect = gifCanvas.width / gifCanvas.height
        let dw = gifCanvas.width, dh = gifCanvas.height, dx = 0, dy = 0
        if (imgAspect > canvasAspect) {
            dh = gifCanvas.height; dw = gifCanvas.height * imgAspect; dx = (gifCanvas.width - dw) / 2
        } else {
            dw = gifCanvas.width; dh = gifCanvas.width / imgAspect; dy = (gifCanvas.height - dh) / 2
        }
        gctx.fillStyle = '#ffffff'
        gctx.fillRect(0, 0, gifCanvas.width, gifCanvas.height)
        gctx.save()
        if (mirror) {
            gctx.translate(gifCanvas.width, 0)
            gctx.scale(-1, 1)
        }
        gctx.drawImage(img, dx, dy, dw, dh)
        gctx.restore()
        framesBase64.push(gifCanvas.toDataURL('image/jpeg', 0.95))
    }
    return framesBase64
}

/** Payload for system:save-session-locally / system:finalize-session. */
export const buildSaveParams = async (params: {
    config: AppConfig
    sessionId: string
    frame: FrameConfig
    photos: CapturedPhoto[]
    stripDataUrl?: string
    gifDataUrl?: string
    mirror: boolean
}) => {
    const { config, sessionId, frame, photos } = params
    const qrUrl = await getQRUrl(config, sessionId)
    const qrSlots = getQRSlots(frame)
    const qrCodeDataUrl = qrUrl && qrSlots.length > 0 ? await QRCode.toDataURL(qrUrl, { margin: 1 }) : undefined

    return {
        sessionId,
        stripDataUrl: params.stripDataUrl,
        gifDataUrl: params.gifDataUrl,
        qrCodeDataUrl,
        photos: frame.slots.map((slot, i) => ({
            path: getPhotoForSlot(frame, photos, slot)?.imagePath || '',
            filename: `photo_${i + 1}.jpg`
        })),
        videos: frame.slots.map((slot, i) => ({
            path: getPhotoForSlot(frame, photos, slot)?.videoPath || '',
            filename: `video_${i + 1}.mp4`
        })),
        overlay: { path: frame.overlayPath, filename: 'overlay.png' },
        mirrorOutput: params.mirror,
        cameraRotation: config.cameraRotation || 0,
        // EDSDK clips (camera movie, or the HDMI/EVF fallback) are the raw, unrotated sensor picture
        videoSource: config.cameraMode === 'edsdk' ? 'camera' as const : 'webcam' as const,
        frameConfig: {
            width: frame.canvasWidth,
            height: frame.canvasHeight,
            slots: frame.slots.map(s => ({ width: s.width, height: s.height, x: s.x, y: s.y, rotation: s.rotation })),
            qrSlots: qrSlots.map(s => ({ width: s.width, height: s.height, x: s.x, y: s.y }))
        }
    }
}
