import sharp, { type OverlayOptions } from 'sharp'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { PhotoSlot } from '@shared/types'

/**
 * ImageProcessor - Handles image manipulation using Sharp
 */
export class ImageProcessor {

    /**
     * Ensure output directory exists
     */
    private ensureDir(filePath: string): void {
        const dir = dirname(filePath)
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true })
        }
    }

    /**
     * Composite multiple photos with a frame overlay
     */
    async composite(
        photos: { path: string; slot: PhotoSlot }[],
        framePath: string,
        outputPath: string,
        canvasWidth: number,
        canvasHeight: number
    ): Promise<string> {
        this.ensureDir(outputPath)

        // Create base canvas
        let canvas = sharp({
            create: {
                width: canvasWidth,
                height: canvasHeight,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
        })

        // Prepare photo layers
        const photoLayers: OverlayOptions[] = []

        for (const photo of photos) {
            if (!existsSync(photo.path)) continue

            // Resize and rotate photo to fit slot
            // Calculate dimensions to COVER the slot while maintaining aspect ratio
            const slotRatio = photo.slot.width / photo.slot.height

            // We use sharp's resize with fit: 'cover' which does center cropping automatically
            const photoBuffer = await sharp(photo.path)
                .rotate(photo.slot.rotation || 0)
                .resize({
                    width: Math.round(photo.slot.width),
                    height: Math.round(photo.slot.height),
                    fit: 'cover',
                    position: 'center'
                })
                .toBuffer()

            photoLayers.push({
                input: photoBuffer,
                left: Math.round(photo.slot.x),
                top: Math.round(photo.slot.y)
            })
        }

        // Add frame overlay on top if it exists
        if (existsSync(framePath)) {
            const frameBuffer = await sharp(framePath)
                .resize(canvasWidth, canvasHeight, { fit: 'contain' })
                .toBuffer()

            photoLayers.push({
                input: frameBuffer,
                left: 0,
                top: 0
            })
        }

        // Composite all layers
        await canvas
            .composite(photoLayers)
            .jpeg({ quality: 95 })
            .toFile(outputPath)

        return outputPath
    }

    /**
     * Resize an image
     */
    async resize(
        inputPath: string,
        outputPath: string,
        width: number,
        height: number,
        fit: 'cover' | 'contain' | 'fill' = 'cover'
    ): Promise<string> {
        this.ensureDir(outputPath)

        await sharp(inputPath)
            .resize(width, height, { fit })
            .toFile(outputPath)

        return outputPath
    }

    /**
     * Apply filter/adjustments to an image
     */
    async applyFilter(
        inputPath: string,
        outputPath: string,
        filter: {
            brightness?: number
            contrast?: number
            saturation?: number
            grayscale?: boolean
            sepia?: boolean
        }
    ): Promise<string> {
        this.ensureDir(outputPath)

        let image = sharp(inputPath)

        // Apply modulate for brightness/saturation
        if (filter.brightness !== undefined || filter.saturation !== undefined) {
            image = image.modulate({
                brightness: filter.brightness || 1,
                saturation: filter.saturation || 1
            })
        }

        // Apply grayscale
        if (filter.grayscale) {
            image = image.grayscale()
        }

        // Apply sepia (grayscale + tint)
        if (filter.sepia) {
            image = image.grayscale().tint({ r: 112, g: 66, b: 20 })
        }

        await image.jpeg({ quality: 95 }).toFile(outputPath)

        return outputPath
    }

    /**
     * Generate animated GIF from multiple images
     * Note: Sharp doesn't support GIF animation natively
     * This creates a simple slideshow-style output
     */
    async generateGif(
        imagePaths: string[],
        outputPath: string,
        _delay: number = 500,
        width: number = 800,
        height: number = 600
    ): Promise<string> {
        this.ensureDir(outputPath)

        // For now, create a horizontal strip of images as a "GIF" placeholder
        // Full GIF animation would require additional library like gifski

        const validPaths = imagePaths.filter(p => existsSync(p))

        if (validPaths.length === 0) {
            throw new Error('No valid images provided')
        }

        if (validPaths.length === 1) {
            // Just resize and save the single image
            await sharp(validPaths[0])
                .resize(width, height, { fit: 'cover' })
                .toFile(outputPath)
            return outputPath
        }

        // Create a horizontal strip for multiple images
        const stripWidth = width * validPaths.length
        const buffers: OverlayOptions[] = []

        for (let i = 0; i < validPaths.length; i++) {
            const buffer = await sharp(validPaths[i])
                .resize(width, height, { fit: 'cover' })
                .toBuffer()

            buffers.push({
                input: buffer,
                left: i * width,
                top: 0
            })
        }

        await sharp({
            create: {
                width: stripWidth,
                height: height,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        })
            .composite(buffers)
            .jpeg({ quality: 90 })
            .toFile(outputPath.replace('.gif', '.jpg'))

        return outputPath.replace('.gif', '.jpg')
    }

    /**
     * Get image metadata
     */
    async getMetadata(imagePath: string): Promise<{
        width: number
        height: number
        format: string
    }> {
        const metadata = await sharp(imagePath).metadata()

        return {
            width: metadata.width || 0,
            height: metadata.height || 0,
            format: metadata.format || 'unknown'
        }
    }
}
