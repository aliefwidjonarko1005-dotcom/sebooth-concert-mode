import { app } from 'electron'
import { randomBytes, timingSafeEqual } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

// Per-install secret for the LAN server (:5050). Phones/browsers get it once via ?k=<key> (Admin shows the link)
// and keep it as an HttpOnly cookie; the kiosk window itself is exempt as a loopback caller.
let keyPromise: Promise<string> | null = null

export function getLanKey(): Promise<string> {
    if (!keyPromise) {
        keyPromise = (async () => {
            const file = join(app.getPath('userData'), 'lan-key.txt')
            try {
                const saved = (await readFile(file, 'utf-8')).trim()
                if (/^[0-9a-f]{32}$/.test(saved)) return saved
            } catch { /* first run */ }
            const fresh = randomBytes(16).toString('hex')
            await writeFile(file, fresh, 'utf-8').catch(err => console.error('[LanKey] Failed to persist key:', err))
            return fresh
        })()
    }
    return keyPromise
}

export function sameKey(given: string, expected: string): boolean {
    const a = Buffer.from(given)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
}
