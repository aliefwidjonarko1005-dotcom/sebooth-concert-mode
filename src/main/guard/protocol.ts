// Booth Guard wire protocol. Pure (node:crypto only) so scripts/check-guard-protocol.mjs can test it.
// Keep canonicalJSON, parseBoothCommand and verifyOwnerAssertion identical to the website's
// src/lib/boothGuardShared.ts + src/lib/boothGuard.ts (sebooth-website).
//
//   kiosk -> server: JSON body, header x-booth-sig = Ed25519(device key, "SEBOOTH-BOOTH-V1\n<path>\n<raw body>")
//   server -> kiosk: JSON body, header x-server-sig = Ed25519(server key, "SEBOOTH-SERVER-V1\n<path>\n<raw body>")
//   owner -> kiosk: BoothCommand + passkey assertion over challenge base64url(sha256(canonicalJSON(command))),
//                   or recovery Ed25519 signature over "SEBOOTH-OWNER-V1\n<canonicalJSON(command)>".

import { createHash, createPublicKey, sign, verify, type KeyObject } from 'crypto'

export const DEVICE_SIG_PREFIX = 'SEBOOTH-BOOTH-V1'
export const SERVER_SIG_PREFIX = 'SEBOOTH-SERVER-V1'
export const RECOVERY_SIG_PREFIX = 'SEBOOTH-OWNER-V1'
export const RELEASE_SIG_PREFIX = 'SEBOOTH-RELEASE-V1'

/** Release signature: Ed25519(release key, "SEBOOTH-RELEASE-V1\n<version>\n<sha512 base64 of installer>"). */
export function verifyReleaseSignature(releasePublicKeyB64: string, version: string, sha512B64: string, sigB64: string): boolean {
    if (!releasePublicKeyB64 || !sigB64) return false
    try {
        const key = createPublicKey({ key: Buffer.from(releasePublicKeyB64, 'base64'), format: 'der', type: 'spki' })
        return verify(null, Buffer.from(`${RELEASE_SIG_PREFIX}\n${version}\n${sha512B64}`), key, Buffer.from(sigB64.trim(), 'base64'))
    } catch {
        return false
    }
}

export const BOOTH_ACTIONS = ['approve', 'lock', 'unlock', 'revoke', 'set_config', 'restart', 'update'] as const
export type BoothAction = (typeof BOOTH_ACTIONS)[number]

export interface BoothCommand {
    v: 1
    id: string
    deviceId: string
    action: BoothAction
    params: Record<string, unknown>
    issuedAt: number
    expiresAt: number
}

export interface OwnerKeyPin {
    credentialId: string // base64url
    jwk: JsonWebKey
    alg: number // COSE: -7 ES256, -257 RS256
    rpId: string
    origins: string[]
    label?: string | null
}

export type OwnerAssertion =
    | { type: 'passkey'; credentialId: string; authenticatorData: string; clientDataJSON: string; signature: string }
    | { type: 'recovery'; signature: string }

export function canonicalJSON(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']'
    const obj = value as Record<string, unknown>
    return '{' + Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k]))
        .join(',') + '}'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 24 * 60 * 60 * 1000

export function parseBoothCommand(x: unknown): BoothCommand | null {
    if (!x || typeof x !== 'object') return null
    const c = x as Record<string, unknown>
    if (c.v !== 1 || typeof c.id !== 'string' || !UUID.test(c.id)) return null
    if (typeof c.deviceId !== 'string' || !UUID.test(c.deviceId)) return null
    if (typeof c.action !== 'string' || !(BOOTH_ACTIONS as readonly string[]).includes(c.action)) return null
    if (!c.params || typeof c.params !== 'object' || Array.isArray(c.params)) return null
    if (typeof c.issuedAt !== 'number' || typeof c.expiresAt !== 'number') return null
    if (c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 7 * DAY_MS) return null
    return c as unknown as BoothCommand
}

export const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest()

export function commandChallenge(cmd: BoothCommand): string {
    return sha256(canonicalJSON(cmd)).toString('base64url')
}

/** Returns null when `a` is a valid owner signature over `cmd`, else the reason it is not. */
export function verifyOwnerAssertion(cmd: BoothCommand, a: OwnerAssertion, pins: OwnerKeyPin[], recoveryKeys: string[]): string | null {
    try {
        if (a?.type === 'recovery') {
            const msg = Buffer.from(`${RECOVERY_SIG_PREFIX}\n${canonicalJSON(cmd)}`)
            const sig = Buffer.from(a.signature, 'base64')
            const ok = recoveryKeys.some((pk) =>
                verify(null, msg, createPublicKey({ key: Buffer.from(pk, 'base64'), format: 'der', type: 'spki' }), sig))
            return ok ? null : 'recovery signature does not match'
        }
        if (a?.type !== 'passkey') return 'unknown assertion type'

        const pin = pins.find((p) => p.credentialId === a.credentialId)
        if (!pin) return 'credential is not an owner key'

        const clientDataBytes = Buffer.from(a.clientDataJSON, 'base64url')
        const clientData = JSON.parse(clientDataBytes.toString('utf8'))
        if (clientData.type !== 'webauthn.get') return 'wrong clientData type'
        if (clientData.challenge !== commandChallenge(cmd)) return 'challenge does not match the command'
        if (!pin.origins.includes(clientData.origin)) return 'origin not allowed'
        if (clientData.crossOrigin === true) return 'cross-origin assertion'

        const authData = Buffer.from(a.authenticatorData, 'base64url')
        if (authData.length < 37) return 'authenticatorData too short'
        if (!authData.subarray(0, 32).equals(sha256(pin.rpId))) return 'rpId does not match'
        const flags = authData[32]
        if (!(flags & 0x01) || !(flags & 0x04)) return 'user presence and verification are required'

        const signed = Buffer.concat([authData, sha256(clientDataBytes)])
        const key = createPublicKey({ key: pin.jwk as never, format: 'jwk' })
        const sig = Buffer.from(a.signature, 'base64url')
        const ok = pin.alg === -7
            ? verify('sha256', signed, { key, dsaEncoding: 'der' }, sig)
            : pin.alg === -257
                ? verify('sha256', signed, key, sig)
                : false
        return ok ? null : 'signature does not verify'
    } catch {
        return 'malformed assertion'
    }
}

export function signDeviceRequest(privateKey: KeyObject, path: string, raw: string): string {
    return sign(null, Buffer.from(`${DEVICE_SIG_PREFIX}\n${path}\n${raw}`), privateKey).toString('base64')
}

export function verifyServerResponse(serverPublicKeyB64: string, path: string, raw: string, sigB64: string | null): boolean {
    if (!sigB64 || !serverPublicKeyB64) return false
    try {
        const key = createPublicKey({ key: Buffer.from(serverPublicKeyB64, 'base64'), format: 'der', type: 'spki' })
        return verify(null, Buffer.from(`${SERVER_SIG_PREFIX}\n${path}\n${raw}`), key, Buffer.from(sigB64, 'base64'))
    } catch {
        return false
    }
}
