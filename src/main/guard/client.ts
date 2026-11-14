import { app, ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { hostname } from 'os'
import {
    GUARD_API_BASE, GUARD_APPROVE_URL, GUARD_ENABLED, OFFLINE_LEASE_MS, OWNER_KEYS, RECOVERY_PUBLIC_KEYS, SERVER_PUBLIC_KEY
} from '@shared/guardPins'
import { canonicalJSON, parseBoothCommand, signDeviceRequest, verifyOwnerAssertion, verifyServerResponse, type OwnerAssertion } from './protocol'
import { atomicWrite, guardDir, loadIdentity, saveIdentity, wipeIdentity, type Identity } from './identity'
import { sessionsToday, setGuardLocked } from './runtime'
import { configService } from '../services/ConfigService'
import { cameraConnected } from '../ipc/camera.ipc'
import { runRemoteUpdate, updateState } from './updater'
import { createPublicKey, sign, verify } from 'crypto'

// Booth Guard state machine (see docs/agent/BOOTH_GUARD.md):
//   pending -> active        owner `approve`
//   active  -> stale         no good heartbeat for OFFLINE_LEASE_MS, or the clock moved back > 1 h
//   stale   -> active        next good heartbeat while the server still says `approved`
//   *       -> locked        owner `lock`, or the server reports locked (clone detected)
//   locked  -> active        owner `unlock` issued after the lock
//   owner `revoke`           identity wiped -> new pending identity
// Anyone trusted may lock; only an owner signature (pinned key) may approve or unlock.

export type GuardMode = 'disabled' | 'pending' | 'active' | 'stale' | 'locked'

interface GuardState {
    mode: GuardMode
    reason: string | null
    lockedAt: number | null
    approvedAt: number | null
    leaseUntil: number | null
    lastHeartbeat: number | null
    maxSeenTime: number
    usedCommandIds: string[]
    pendingAcks: { id: string; result: string }[]
}

export interface GuardView {
    enabled: boolean
    locked: boolean
    mode: GuardMode
    reason: string | null
    deviceCode: string
    approveUrl: string
}

const HEARTBEAT_MS = 30_000
const CLOCK_SKEW_MS = 5 * 60 * 1000
const stateFile = (): string => join(guardDir(), 'state.json')

let identity: Identity | null = null
let state: GuardState = freshState()
const listeners: ((v: GuardView) => void)[] = []

function freshState(): GuardState {
    return {
        mode: 'pending', reason: null, lockedAt: null, approvedAt: null, leaseUntil: null,
        lastHeartbeat: null, maxSeenTime: Date.now(), usedCommandIds: [], pendingAcks: []
    }
}

export function guardView(): GuardView {
    const mode = GUARD_ENABLED ? state.mode : 'disabled'
    return {
        enabled: GUARD_ENABLED,
        locked: mode !== 'active' && mode !== 'disabled',
        mode,
        reason: state.reason,
        deviceCode: identity?.deviceId ? identity.deviceId.slice(0, 8).toUpperCase() : (identity?.publicKey.slice(-8).toUpperCase() || ''),
        approveUrl: GUARD_APPROVE_URL
    }
}

export function onGuardChange(cb: (v: GuardView) => void): void {
    listeners.push(cb)
}

// ── persistence (state is signed with the device key, so hand edits are detected) ──

async function persist(): Promise<void> {
    if (!identity) return
    const sig = sign(null, Buffer.from(canonicalJSON(state)), identity.privateKey).toString('base64')
    await atomicWrite(stateFile(), JSON.stringify({ state, sig })).catch(err => console.error('[Guard] Failed to save state:', err))
}

async function loadState(id: Identity, fresh: boolean): Promise<GuardState> {
    if (fresh) return freshState()
    try {
        const { state: s, sig } = JSON.parse(await readFile(stateFile(), 'utf-8'))
        const pub = createPublicKey({ key: Buffer.from(id.publicKey, 'base64'), format: 'der', type: 'spki' })
        if (verify(null, Buffer.from(canonicalJSON(s)), pub, Buffer.from(sig, 'base64'))) return s
        console.warn('[Guard] State file signature invalid')
    } catch {
        console.warn('[Guard] State file missing or unreadable')
    }
    // An existing identity without a valid state was tampered with (or lost its state): hard lock.
    return { ...freshState(), mode: 'locked', reason: 'tamper', lockedAt: Date.now() }
}

// ── transitions ──

async function update(next: Partial<GuardState>): Promise<void> {
    const wasLocked = guardView().locked
    state = { ...state, ...next }
    await persist()
    const view = guardView()
    setGuardLocked(view.locked)
    if (view.locked !== wasLocked) console.log(`[Guard] ${view.locked ? 'LOCKED' : 'UNLOCKED'} (${view.mode}${view.reason ? `: ${view.reason}` : ''})`)
    for (const cb of listeners) cb(view)
}

function lockPatch(reason: string): Partial<GuardState> {
    return { mode: 'locked', reason, lockedAt: Date.now() }
}

function activePatch(now: number): Partial<GuardState> {
    return { mode: 'active', reason: null, lockedAt: null, approvedAt: state.approvedAt ?? now, leaseUntil: now + OFFLINE_LEASE_MS }
}

async function checkClock(): Promise<void> {
    const now = Date.now()
    if (state.mode === 'active' && now < state.maxSeenTime - 60 * 60 * 1000) {
        return update({ mode: 'stale', reason: 'clock' })
    }
    if (state.mode === 'active' && state.leaseUntil !== null && now > state.leaseUntil) {
        return update({ mode: 'stale', reason: 'offline', maxSeenTime: Math.max(state.maxSeenTime, now) })
    }
    if (now > state.maxSeenTime) state.maxSeenTime = now
}

// ── server calls ──

// Every signed request goes through one queue: the server rejects a counter that is not larger than the
// last one it saw, so two requests in flight at once (heartbeat + upload) would look like a clone.
let callChain: Promise<unknown> = Promise.resolve()
function call(path: string, payload: Record<string, unknown>): Promise<any | null> {
    const next = callChain.then(() => callNow(path, payload))
    callChain = next.catch(() => undefined)
    return next
}

/** Signed request to a Booth Guard cloud route (uploads, rows). null when not approved/online. */
export function guardRequest(path: string, payload: Record<string, unknown>): Promise<any | null> {
    if (!GUARD_ENABLED || !identity?.deviceId || state.mode !== 'active') return Promise.resolve(null)
    return call(path, { ...payload, deviceId: identity.deviceId })
}

async function callNow(path: string, payload: Record<string, unknown>): Promise<any | null> {
    if (!identity) return null
    identity.counter += 1
    await saveIdentity(identity) // persist the counter before the server can see it
    const raw = JSON.stringify({ ...payload, ts: Date.now(), counter: identity.counter })
    try {
        const res = await fetch(GUARD_API_BASE + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-booth-sig': signDeviceRequest(identity.privateKey, path, raw) },
            body: raw,
            signal: AbortSignal.timeout(15_000)
        })
        const text = await res.text()
        if (!verifyServerResponse(SERVER_PUBLIC_KEY, path, text, res.headers.get('x-server-sig'))) {
            if (res.ok) console.warn(`[Guard] ${path}: response not signed by the pinned server key`)
            return null
        }
        return JSON.parse(text)
    } catch {
        return null // offline: the lease covers it
    }
}

async function register(): Promise<void> {
    if (!identity) return
    const res = await call('/api/booth/register', {
        publicKey: identity.publicKey,
        fingerprint: identity.fingerprint,
        hostname: hostname(),
        appVersion: app.getVersion()
    })
    if (res?.deviceId) {
        identity.deviceId = res.deviceId
        await saveIdentity(identity)
        await update({})
    }
}

async function heartbeat(): Promise<void> {
    if (!identity?.deviceId) return register()
    const acks = state.pendingAcks
    const cfg = configService.getConfig()
    const res = await call('/api/booth/heartbeat', {
        deviceId: identity.deviceId,
        fingerprint: identity.fingerprint,
        acks,
        status: {
            appVersion: app.getVersion(),
            guardState: state.mode,
            uptimeMin: Math.round(process.uptime() / 60),
            sessionsToday: sessionsToday(),
            cameraReady: cameraConnected(),
            cameraMode: cfg.cameraMode,
            printerReady: !!cfg.printerEnabled && !!cfg.printerName,
            printerName: cfg.printerName || null,
            update: updateState()
        }
    })
    if (!res || res.deviceId !== identity.deviceId || res.counter !== identity.counter) return

    const now = Date.now()
    const sentAcks = new Set(acks.map(a => a.id))
    const next: Partial<GuardState> = {
        lastHeartbeat: now,
        maxSeenTime: now, // the server accepted our clock (±5 min), so it is the new reference

        pendingAcks: state.pendingAcks.filter(a => !sentAcks.has(a.id))
    }

    if (res.status === 'unknown') {
        // The server lost this device: register again (owner approval will be needed again server-side).
        identity.deviceId = null
        await saveIdentity(identity)
    } else if (res.status === 'locked' && state.mode !== 'locked') {
        Object.assign(next, lockPatch(res.lockReason || 'server'))
    } else if (res.status === 'approved' && (state.mode === 'active' || (state.mode === 'stale' && state.approvedAt))) {
        Object.assign(next, activePatch(now))
    }
    await update(next)
    await applyCommands(Array.isArray(res.commands) ? res.commands : [])
}

// ── owner commands ──

async function applyCommands(items: { command: unknown; assertion: OwnerAssertion }[]): Promise<void> {
    let revoke = false
    let restart = false
    let updateTo: string | null = null
    for (const item of items) {
        const cmd = parseBoothCommand(item?.command)
        const id = cmd?.id || (item?.command as { id?: string })?.id
        if (!id || typeof id !== 'string') continue
        const ack = (result: string): void => {
            state.pendingAcks = [...state.pendingAcks.filter(a => a.id !== id), { id, result }]
            state.usedCommandIds = [...state.usedCommandIds, id].slice(-500)
        }
        if (state.usedCommandIds.includes(id)) { ack('duplicate'); continue }
        if (!cmd) { ack('rejected: malformed'); continue }

        const now = Date.now()
        const reason =
            cmd.deviceId !== identity?.deviceId ? 'wrong device'
            : cmd.expiresAt < now ? 'expired'
            : cmd.issuedAt > now + CLOCK_SKEW_MS ? 'issued in the future'
            : verifyOwnerAssertion(cmd, item.assertion, OWNER_KEYS, RECOVERY_PUBLIC_KEYS)
        if (reason) {
            console.warn(`[Guard] Rejected ${cmd.action} ${cmd.id}: ${reason}`)
            ack(`rejected: ${reason}`)
            continue
        }

        switch (cmd.action) {
            case 'approve':
                if (state.mode === 'pending') Object.assign(state, activePatch(now), { approvedAt: now })
                ack(state.mode === 'active' ? 'ok' : `ignored: ${state.mode}`)
                break
            case 'unlock':
                if (state.mode === 'stale' || (state.mode === 'locked' && cmd.issuedAt >= (state.lockedAt ?? 0) - CLOCK_SKEW_MS)) {
                    Object.assign(state, activePatch(now))
                }
                ack(state.mode === 'active' ? 'ok' : 'ignored: lock is newer than this unlock')
                break
            case 'lock':
                Object.assign(state, lockPatch('owner'))
                ack('ok')
                break
            case 'revoke':
                revoke = true
                ack('ok')
                break
            case 'set_config': {
                const patch = cmd.params.patch
                if (state.mode !== 'active') { ack('ignored: locked'); break }
                if (!patch || typeof patch !== 'object' || Array.isArray(patch)) { ack('rejected: patch must be an object'); break }
                configService.updateConfig(patch as never)
                ack('ok')
                break
            }
            case 'restart':
                restart = true
                ack('ok')
                break
            case 'update': {
                const version = cmd.params.version
                if (state.mode !== 'active') { ack('ignored: locked'); break }
                if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) { ack('rejected: version must be x.y.z'); break }
                updateTo = version
                ack('started') // progress is reported in the heartbeat status (update)
                break
            }
            default:
                ack('unsupported')
        }
    }
    await update({})

    if (revoke && identity) {
        console.warn('[Guard] Revoked by owner: wiping identity')
        identity = await wipeIdentity()
        state = { ...freshState(), mode: 'pending', reason: 'revoked' }
        await update({})
        await register()
    }
    if (restart) {
        app.relaunch()
        app.exit(0)
    }
    if (updateTo) void runRemoteUpdate(updateTo)
}

// ── lifecycle ──

/** Call once after app ready and before the window loads, so the gate is right from the first IPC. */
export async function initGuard(): Promise<void> {
    ipcMain.handle('guard:get-state', () => ({ success: true, data: guardView() }))
    if (!GUARD_ENABLED) {
        setGuardLocked(false)
        console.log('[Guard] Disabled (no pinned server/owner keys in src/shared/guardPins.ts)')
        return
    }
    try {
        const loaded = await loadIdentity()
        identity = loaded.identity
        state = await loadState(identity, loaded.fresh)
        await update({})
        await checkClock()
    } catch (err) {
        console.error('[Guard] Init failed, staying locked:', err)
        setGuardLocked(true)
    }
}

export function startGuardLoop(): void {
    if (!GUARD_ENABLED) return
    let running = false
    const tick = async (): Promise<void> => {
        if (running) return
        running = true
        try {
            await checkClock()
            await heartbeat()
        } catch (err) {
            console.error('[Guard] Heartbeat error:', err)
        } finally {
            running = false
        }
    }
    tick()
    setInterval(tick, HEARTBEAT_MS)
}
