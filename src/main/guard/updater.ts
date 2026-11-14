import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { basename } from 'path'
import { RELEASE_PUBLIC_KEY, UPDATE_FEED_URL } from '@shared/guardPins'
import { verifyReleaseSignature } from './protocol'

// Remote update, started only by an owner-signed `update` command (client.ts). electron-updater fetches
// latest.yml + the installer from the GCS feed; before installing we hash the downloaded file ourselves
// and require "<installer>.sig" signed by the offline release key pinned in guardPins. Write access to
// the bucket alone therefore cannot push code to the booths.

export interface UpdateState {
    state: 'idle' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'current' | 'failed'
    version?: string
    error?: string
    at?: number
}

let current: UpdateState = { state: 'idle' }
let running = false
export const updateState = (): UpdateState => current

function sha512File(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha512')
        createReadStream(path).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('base64')))
    })
}

export async function runRemoteUpdate(version: string): Promise<void> {
    if (running) return
    running = true
    const set = (s: Partial<UpdateState>): void => {
        current = { ...current, ...s, version, at: Date.now() }
        console.log(`[Guard] Update ${version}: ${current.state}${current.error ? ` (${current.error})` : ''}`)
    }
    try {
        if (!RELEASE_PUBLIC_KEY) throw new Error('no release key pinned in this build')
        if (!app.isPackaged) throw new Error('not a packaged build')
        if (version === app.getVersion()) return set({ state: 'current', error: undefined })

        autoUpdater.autoDownload = false
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.allowDowngrade = false

        set({ state: 'checking', error: undefined })
        const info = (await autoUpdater.checkForUpdates())?.updateInfo
        if (!info || info.version !== version) throw new Error(`feed offers ${info?.version ?? 'nothing'}, not ${version}`)

        set({ state: 'downloading' })
        const installer = (await autoUpdater.downloadUpdate()).find((f) => f.toLowerCase().endsWith('.exe'))
        if (!installer) throw new Error('no installer downloaded')

        set({ state: 'verifying' })
        const sha512 = await sha512File(installer)
        const name = info.files?.[0]?.url || basename(installer)
        const sigRes = await fetch(`${UPDATE_FEED_URL}/${encodeURIComponent(name)}.sig`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
        if (!sigRes.ok) throw new Error(`release signature not found (${sigRes.status})`)
        if (!verifyReleaseSignature(RELEASE_PUBLIC_KEY, version, sha512, await sigRes.text())) {
            throw new Error('release signature invalid, not installing')
        }

        set({ state: 'installing' })
        autoUpdater.quitAndInstall(true, true) // silent install, relaunch afterwards
    } catch (e) {
        set({ state: 'failed', error: String((e as Error)?.message || e).slice(0, 200) })
    } finally {
        running = false
    }
}
