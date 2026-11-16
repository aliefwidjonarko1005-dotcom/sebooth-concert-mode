import { join } from 'path'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { CameraHandler } from './CameraHandler'
import { CameraDevice, CaptureResult } from '@shared/types'
import sharp from 'sharp'

const MOCK_COLOURS: [number, number, number][] = [[29, 67, 196], [254, 107, 0], [255, 200, 40], [40, 160, 110], [200, 60, 90]]

/**
 * Mock Camera Handler for Development/Testing
 * Uses sample images instead of actual camera capture
 */
export class MockCamera extends CameraHandler {
    private mockImagePath: string | null = null
    private captureCount: number = 0

    constructor(mockImagePath?: string) {
        super()
        this.mockImagePath = mockImagePath || null
    }

    async listCameras(): Promise<CameraDevice[]> {
        // Return a mock camera for development
        return [
            {
                id: 'mock_camera_1',
                name: 'Mock Camera (Development)',
                port: 'VIRTUAL',
                connected: false
            },
            {
                id: 'mock_camera_2',
                name: 'Mock Fujifilm XS10',
                port: 'VIRTUAL',
                connected: false
            }
        ]
    }

    async connect(cameraId: string): Promise<boolean> {
        const cameras = await this.listCameras()
        const camera = cameras.find(c => c.id === cameraId)

        if (camera) {
            this.currentCamera = { ...camera, connected: true }
            this.connected = true
            console.log(`[MockCamera] Connected to ${camera.name}`)
            return true
        }
        return false
    }

    async disconnect(): Promise<void> {
        console.log('[MockCamera] Disconnected')
        this.connected = false
        this.currentCamera = null
    }

    async capture(outputPath: string, options?: any): Promise<CaptureResult> {
        if (!this.connected) {
            return {
                success: false,
                error: 'Camera not connected',
                timestamp: Date.now()
            }
        }

        // Simulate capture delay
        await new Promise(resolve => setTimeout(resolve, 500))

        try {
            // Ensure output directory exists
            const dir = join(outputPath, '..')
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }

            // If a mock image is provided, copy it to the output path
            if (this.mockImagePath && existsSync(this.mockImagePath)) {
                copyFileSync(this.mockImagePath, outputPath)
            } else {
                // A real baseline JPEG (sharp rejects malformed ones, e.g. when building flipbook sheets),
                // in a colour that changes per shot so strip/flipbook previews visibly differ
                const [r, g, b] = MOCK_COLOURS[this.captureCount % MOCK_COLOURS.length]
                await sharp({ create: { width: 1500, height: 1000, channels: 3, background: { r, g, b } } })
                    .jpeg({ quality: 80 })
                    .toFile(outputPath)
                console.log(`[MockCamera] Captured test image to: ${outputPath}`)
            }

            this.captureCount++

            return {
                success: true,
                imagePath: outputPath,
                timestamp: Date.now()
            }
        } catch (error) {
            const err = error as Error
            return {
                success: false,
                error: err.message,
                timestamp: Date.now()
            }
        }
    }

    /**
     * Set a mock image to use for captures
     */
    setMockImage(imagePath: string): void {
        this.mockImagePath = imagePath
    }

    /**
     * Get the number of captures made
     */
    getCaptureCount(): number {
        return this.captureCount
    }
}
