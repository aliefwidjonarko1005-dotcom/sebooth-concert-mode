/**
 * Environment Loader (Production-safe)
 * 
 * MUST be imported FIRST in index.ts before any other module that reads process.env.
 * In production (packaged app), loads .env from the resources directory.
 * In development, loads from the project root (default dotenv behavior).
 */
import { config } from 'dotenv'
import { app } from 'electron'
import { join } from 'path'

if (app.isPackaged) {
    // Production: .env is bundled via extraResources → <app>/resources/.env
    const envPath = join(process.resourcesPath, '.env')
    config({ path: envPath })
    console.log(`[Env] Loaded production .env from: ${envPath}`)
} else {
    // Development: load from project root (default)
    config()
    console.log('[Env] Loaded development .env from project root')
}
