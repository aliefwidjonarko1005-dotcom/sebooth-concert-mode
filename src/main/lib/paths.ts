/**
 * Production-safe path utilities for Sebooth Desktop App
 * 
 * Resolves paths that differ between development (source tree) and
 * production (packaged with electron-builder).
 */
import { app } from 'electron'
import { join, basename } from 'path'
import { existsSync } from 'fs'

/**
 * Get the path to the ffmpeg binary.
 * - Development: resolved from @ffmpeg-installer/ffmpeg node_modules
 * - Production: bundled in resources/bin/ffmpeg.exe via extraResources
 */
export function getFFmpegPath(): string {
    if (app.isPackaged) {
        const prodPath = join(process.resourcesPath, 'bin', 'ffmpeg.exe')
        if (existsSync(prodPath)) {
            console.log(`[Paths] FFmpeg (production): ${prodPath}`)
            return prodPath
        }
        console.warn(`[Paths] FFmpeg binary not found at: ${prodPath}`)
    }

    // Development: use @ffmpeg-installer/ffmpeg
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')
        console.log(`[Paths] FFmpeg (dev): ${ffmpegInstaller.path}`)
        return ffmpegInstaller.path
    } catch {
        console.error('[Paths] Failed to resolve ffmpeg path')
        return 'ffmpeg' // fallback to system PATH
    }
}

/**
 * Get the path to the Google Cloud Storage service account key.
 * - Development: from project root (process.cwd())
 * - Production: bundled in resources/gcs-key.json via extraResources
 */
export function getGCSKeyPath(): string | null {
    const keyName = process.env.GCS_KEY_PATH || 'google-key.json'

    if (app.isPackaged) {
        // Production: check resources directory
        const prodPath = join(process.resourcesPath, 'gcs-key.json')
        if (existsSync(prodPath)) {
            console.log(`[Paths] GCS Key (production): ${prodPath}`)
            return prodPath
        }
        console.warn(`[Paths] GCS key not found at: ${prodPath}`)
        return null
    }

    // Development: resolve from project root
    const { isAbsolute } = require('path')
    const devPath = isAbsolute(keyName) ? keyName : join(process.cwd(), keyName)
    if (existsSync(devPath)) {
        console.log(`[Paths] GCS Key (dev): ${basename(devPath)}`)
        return devPath
    }

    console.warn(`[Paths] GCS key not found at: ${devPath}`)
    return null
}

/**
 * Get the path to app resources directory.
 * - Development: <project>/resources/
 * - Production: <app>/resources/resources/ (due to extraResources mapping)
 */
export function getAppResourcesPath(): string {
    if (app.isPackaged) {
        return join(process.resourcesPath, 'resources')
    }
    return join(process.cwd(), 'resources')
}
