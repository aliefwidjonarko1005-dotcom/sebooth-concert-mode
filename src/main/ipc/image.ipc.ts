import { IpcMain } from 'electron'
import { ImageProcessor } from '../services/ImageProcessor'
import { PhotoSlot, APIResponse } from '@shared/types'
import { assertReadable, assertWritable } from '../lib/safePath'

const imageProcessor = new ImageProcessor()

/**
 * Register all image processing IPC handlers
 */
export function registerImageHandlers(ipcMain: IpcMain): void {

    // Composite photos with frame overlay
    ipcMain.handle('image:composite', async (_, options: {
        photos: { path: string; slot: PhotoSlot }[]
        framePath: string
        outputPath: string
        canvasWidth: number
        canvasHeight: number
    }): Promise<APIResponse<string>> => {
        try {
            for (const ph of options.photos) await assertReadable(ph.path)
            await assertReadable(options.framePath)
            await assertWritable(options.outputPath)
            const result = await imageProcessor.composite(
                options.photos,
                options.framePath,
                options.outputPath,
                options.canvasWidth,
                options.canvasHeight
            )
            return { success: true, data: result }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Resize image
    ipcMain.handle('image:resize', async (_, options: {
        inputPath: string
        outputPath: string
        width: number
        height: number
        fit?: 'cover' | 'contain' | 'fill'
    }): Promise<APIResponse<string>> => {
        try {
            await assertReadable(options.inputPath)
            await assertWritable(options.outputPath)
            const result = await imageProcessor.resize(
                options.inputPath,
                options.outputPath,
                options.width,
                options.height,
                options.fit
            )
            return { success: true, data: result }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Apply filter/adjustments
    ipcMain.handle('image:apply-filter', async (_, options: {
        inputPath: string
        outputPath: string
        filter: {
            brightness?: number
            contrast?: number
            saturation?: number
            grayscale?: boolean
            sepia?: boolean
        }
    }): Promise<APIResponse<string>> => {
        try {
            await assertReadable(options.inputPath)
            await assertWritable(options.outputPath)
            const result = await imageProcessor.applyFilter(
                options.inputPath,
                options.outputPath,
                options.filter
            )
            return { success: true, data: result }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Generate GIF from multiple images
    ipcMain.handle('image:generate-gif', async (_, options: {
        imagePaths: string[]
        outputPath: string
        delay?: number
        width?: number
        height?: number
    }): Promise<APIResponse<string>> => {
        try {
            for (const ip of options.imagePaths) await assertReadable(ip)
            await assertWritable(options.outputPath)
            const result = await imageProcessor.generateGif(
                options.imagePaths,
                options.outputPath,
                options.delay,
                options.width,
                options.height
            )
            return { success: true, data: result }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })

    // Get image metadata
    ipcMain.handle('image:metadata', async (_, imagePath: string): Promise<APIResponse<{
        width: number
        height: number
        format: string
    }>> => {
        try {
            await assertReadable(imagePath)
            const result = await imageProcessor.getMetadata(imagePath)
            return { success: true, data: result }
        } catch (error) {
            const err = error as Error
            return { success: false, error: err.message }
        }
    })
}
