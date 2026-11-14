import { pbkdf2, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { configService } from '../services/ConfigService'

const pbkdf2Async = promisify(pbkdf2)

// The owner sets adminPinHash from the website (PBKDF2 computed in their browser), so the PIN itself
// is never stored. With 1/2/3 buttons the PIN space is small, hence the attempt limit.
const MAX_FAILS = 5
const LOCKOUT_MS = 5 * 60 * 1000
let fails = 0
let lockedUntil = 0

export async function verifyAdminPin(pin: string): Promise<{ ok: boolean; retryInSec?: number }> {
    const now = Date.now()
    if (now < lockedUntil) return { ok: false, retryInSec: Math.ceil((lockedUntil - now) / 1000) }

    const stored = configService.getConfig().adminPinHash || ''
    let ok = false
    if (!stored) {
        ok = pin === '123' || pin === 'admin123' // legacy until the owner sets a PIN
    } else {
        const [scheme, iter, saltB64, hashB64] = stored.split('$')
        const expected = Buffer.from(hashB64 || '', 'base64')
        if (scheme === 'pbkdf2' && Number(iter) > 0 && expected.length > 0) {
            const got = await pbkdf2Async(String(pin), Buffer.from(saltB64, 'base64'), Number(iter), expected.length, 'sha256')
            ok = timingSafeEqual(got, expected)
        }
    }

    if (ok) { fails = 0; return { ok } }
    fails++
    if (fails >= MAX_FAILS) { fails = 0; lockedUntil = now + LOCKOUT_MS }
    return { ok: false }
}
