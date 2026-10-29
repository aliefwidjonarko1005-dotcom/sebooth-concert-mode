import { PhotoSlot } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'

export interface RGB {
    r: number
    g: number
    b: number
}

export interface ChromaKeyOptions {
    keyColor: string         // Hex format, e.g. '#00FF00'
    tolerance: number        // 1 - 100
    smoothness: number       // 0 - 50
    invert?: boolean
}

/**
 * Parse hex string (#RGB, #RRGGBB) to RGB object.
 */
export function hexToRgb(hex: string): RGB {
    let cleanHex = hex.replace(/^#/, '').trim()
    if (cleanHex.length === 3) {
        cleanHex = cleanHex.split('').map(c => c + c).join('')
    }
    if (cleanHex.length !== 6) {
        return { r: 0, g: 255, b: 0 } // Default green
    }
    const num = parseInt(cleanHex, 16)
    return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255
    }
}

/**
 * Convert RGB to uppercase hex string (#RRGGBB).
 */
export function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

/**
 * Apply chroma key to ImageData in-place.
 */
export function applyChromaKeyToImageData(
    sourceImageData: ImageData,
    targetImageData: ImageData,
    options: ChromaKeyOptions
): void {
    const { keyColor, tolerance, smoothness, invert = false } = options
    const targetRgb = hexToRgb(keyColor)

    // Max Euclidean distance in RGB is sqrt(255^2 * 3) ~ 441.67
    const maxDistance = Math.sqrt(255 * 255 * 3)
    const thresholdMax = (Math.max(1, Math.min(100, tolerance)) / 100) * maxDistance
    const feather = (Math.max(0, Math.min(50, smoothness)) / 100) * 160
    const thresholdMin = Math.max(0, thresholdMax - feather)

    const src = sourceImageData.data
    const dest = targetImageData.data
    const len = src.length

    for (let i = 0; i < len; i += 4) {
        const r = src[i]
        const g = src[i + 1]
        const b = src[i + 2]
        const originalAlpha = src[i + 3]

        if (originalAlpha === 0) {
            dest[i] = r
            dest[i + 1] = g
            dest[i + 2] = b
            dest[i + 3] = 0
            continue
        }

        // Euclidean distance from key color
        const diffR = r - targetRgb.r
        const diffG = g - targetRgb.g
        const diffB = b - targetRgb.b
        const dist = Math.sqrt(diffR * diffR + diffG * diffG + diffB * diffB)

        let alpha: number

        if (dist <= thresholdMin) {
            alpha = 0
        } else if (dist >= thresholdMax) {
            alpha = originalAlpha
        } else {
            // Smooth feathering zone
            const factor = (dist - thresholdMin) / (thresholdMax - thresholdMin)
            alpha = Math.round(originalAlpha * factor)
        }

        if (invert) {
            alpha = 255 - alpha
        }

        // Slight spill desaturation on the edge pixels
        if (alpha > 0 && alpha < originalAlpha && dist < thresholdMax) {
            const edgeFactor = (dist - thresholdMin) / (thresholdMax - thresholdMin)
            const lum = 0.299 * r + 0.587 * g + 0.114 * b
            const blend = (1 - edgeFactor) * 0.4
            dest[i] = Math.round(r * (1 - blend) + lum * blend)
            dest[i + 1] = Math.round(g * (1 - blend) + lum * blend)
            dest[i + 2] = Math.round(b * (1 - blend) + lum * blend)
        } else {
            dest[i] = r
            dest[i + 1] = g
            dest[i + 2] = b
        }

        dest[i + 3] = alpha
    }
}

/**
 * Scan transparent areas in keyed ImageData and automatically detect rectangular photo slots.
 */
export function detectPhotoSlotsFromImageData(
    imageData: ImageData,
    targetCanvasWidth?: number,
    targetCanvasHeight?: number
): PhotoSlot[] {
    const { width: w, height: h, data } = imageData
    if (w <= 0 || h <= 0) return []

    // Adaptive step to keep scanning ultra fast (< 25ms)
    const step = Math.max(2, Math.min(8, Math.floor(Math.max(w, h) / 300)))
    const gridCols = Math.ceil(w / step)
    const gridRows = Math.ceil(h / step)

    // Build binary mask: 1 if keyed out (transparent, alpha < 64), 0 otherwise
    const mask = new Uint8Array(gridCols * gridRows)
    for (let gy = 0; gy < gridRows; gy++) {
        const py = Math.min(h - 1, gy * step)
        const rowOffset = py * w
        for (let gx = 0; gx < gridCols; gx++) {
            const px = Math.min(w - 1, gx * step)
            const alpha = data[(rowOffset + px) * 4 + 3]
            if (alpha < 64) {
                mask[gy * gridCols + gx] = 1
            }
        }
    }

    // Connected components search using BFS
    const visited = new Uint8Array(gridCols * gridRows)
    const rawClusters: { minX: number; maxX: number; minY: number; maxY: number; count: number }[] = []

    for (let gy = 0; gy < gridRows; gy++) {
        for (let gx = 0; gx < gridCols; gx++) {
            const idx = gy * gridCols + gx
            if (mask[idx] === 0 || visited[idx] === 1) continue

            // Start BFS
            let minGX = gx
            let maxGX = gx
            let minGY = gy
            let maxGY = gy
            let count = 0

            const queue: number[] = [idx]
            visited[idx] = 1

            while (queue.length > 0) {
                const currIdx = queue.pop()!
                const cy = Math.floor(currIdx / gridCols)
                const cx = currIdx % gridCols
                count++

                if (cx < minGX) minGX = cx
                if (cx > maxGX) maxGX = cx
                if (cy < minGY) minGY = cy
                if (cy > maxGY) maxGY = cy

                // 4-neighborhood
                const neighbors = [
                    cy > 0 ? (cy - 1) * gridCols + cx : -1,
                    cy < gridRows - 1 ? (cy + 1) * gridCols + cx : -1,
                    cx > 0 ? cy * gridCols + (cx - 1) : -1,
                    cx < gridCols - 1 ? cy * gridCols + (cx + 1) : -1
                ]

                for (const n of neighbors) {
                    if (n >= 0 && mask[n] === 1 && visited[n] === 0) {
                        visited[n] = 1
                        queue.push(n)
                    }
                }
            }

            const pixelMinX = minGX * step
            const pixelMaxX = Math.min(w, (maxGX + 1) * step)
            const pixelMinY = minGY * step
            const pixelMaxY = Math.min(h, (maxGY + 1) * step)

            rawClusters.push({
                minX: pixelMinX,
                maxX: pixelMaxX,
                minY: pixelMinY,
                maxY: pixelMaxY,
                count
            })
        }
    }

    // Filter clusters: photo slots are significant rectangular areas
    const totalArea = w * h
    const minSlotArea = totalArea * 0.015 // at least 1.5% of canvas
    const minWidth = w * 0.08
    const minHeight = h * 0.06

    const validClusters = rawClusters.filter(cluster => {
        const boxW = cluster.maxX - cluster.minX
        const boxH = cluster.maxY - cluster.minY
        const boxArea = boxW * boxH

        if (boxArea < minSlotArea) return false
        if (boxW < minWidth || boxH < minHeight) return false

        // Check rectangular fill density
        const gridCellsInBox = Math.max(1, (boxW / step) * (boxH / step))
        const density = cluster.count / gridCellsInBox
        if (density < 0.60) return false

        const aspect = boxW / boxH
        if (aspect < 0.15 || aspect > 6.5) return false

        return true
    })

    // Scale factors if target canvas dimensions are specified
    const scaleX = targetCanvasWidth && targetCanvasWidth > 0 ? targetCanvasWidth / w : 1
    const scaleY = targetCanvasHeight && targetCanvasHeight > 0 ? targetCanvasHeight / h : 1

    // Sort clusters in visual reading order (top-to-bottom, left-to-right)
    validClusters.sort((a, b) => {
        const rowThreshold = h * 0.12
        const rowA = Math.floor(a.minY / rowThreshold)
        const rowB = Math.floor(b.minY / rowThreshold)
        if (rowA !== rowB) return rowA - rowB
        return a.minX - b.minX
    })

    return validClusters.map(cluster => {
        const rawW = cluster.maxX - cluster.minX
        const rawH = cluster.maxY - cluster.minY

        return {
            id: uuidv4(),
            x: Math.round(cluster.minX * scaleX),
            y: Math.round(cluster.minY * scaleY),
            width: Math.round(rawW * scaleX),
            height: Math.round(rawH * scaleY),
            rotation: 0
        }
    })
}
