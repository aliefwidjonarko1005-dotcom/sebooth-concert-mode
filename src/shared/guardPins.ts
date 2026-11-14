// Booth Guard trust anchors, baked into the build. Only keys listed here can approve or unlock a booth;
// the website and Supabase cannot add one. Fill them from the website (see docs/agent/BOOTH_GUARD.md):
//   SERVER_PUBLIC_KEY     <- `node scripts/booth-guard-keygen.mjs server` (website repo)
//   OWNER_KEYS            <- Admin -> Booth Guard -> "Daftarkan passkey device ini" (one entry per device)
//   RECOVERY_PUBLIC_KEYS  <- `node scripts/booth-guard-keygen.mjs recovery <file>`
// While SERVER_PUBLIC_KEY or every owner key is missing, the guard is off and the app runs unguarded.

/** Same shape as OwnerKeyPin in src/main/guard/protocol.ts (kept here so src/shared stays main-free). */
export interface OwnerKeyPin {
    credentialId: string
    jwk: JsonWebKey
    alg: number
    rpId: string
    origins: string[]
    label?: string | null
}

export const GUARD_API_BASE = 'https://www.sebooth.in'
export const GUARD_APPROVE_URL = 'https://www.sebooth.in/admin?tab=booths'

export const SERVER_PUBLIC_KEY = ''

export const OWNER_KEYS: OwnerKeyPin[] = []

export const RECOVERY_PUBLIC_KEYS: string[] = []

/** Remote update feed (must match build.publish[0].url in package.json) and the release signing key.
 *  RELEASE_PUBLIC_KEY <- `node scripts/publish-release.mjs keygen <file>`; empty = remote update refused. */
export const UPDATE_FEED_URL = 'https://storage.googleapis.com/sebooth-media-konser/releases/win'
export const RELEASE_PUBLIC_KEY = ''

export const GUARD_ENABLED = !!SERVER_PUBLIC_KEY && OWNER_KEYS.length + RECOVERY_PUBLIC_KEYS.length > 0

/** How long an approved booth keeps working without a successful heartbeat. */
export const OFFLINE_LEASE_MS = 3 * 24 * 60 * 60 * 1000
