import { app, safeStorage } from 'electron'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { hostname } from 'os'
import { dirname, join } from 'path'

// Device identity: an Ed25519 key whose private half is sealed with DPAPI (safeStorage), so copying
// userData to another PC yields an identity that cannot be opened there -> that copy starts as a new,
// pending (locked) device. The fingerprint (MachineGuid hash) catches the rest.

export interface Identity {
    deviceId: string | null
    publicKey: string // SPKI DER base64
    privateKey: KeyObject
    fingerprint: string
    counter: number // last request counter sent; strictly increasing, persisted before each request
}

interface Stored {
    deviceId: string | null
    publicKey: string
    sealedKey: string // "dpapi:<b64>" or "plain:<b64>" where safeStorage is unavailable
    fingerprint: string
    counter: number
}

export const guardDir = (): string => join(app.getPath('userData'), 'guard')
const identityFile = (): string => join(guardDir(), 'identity.json')

export async function atomicWrite(path: string, data: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    await writeFile(tmp, data, 'utf-8')
    await rename(tmp, path)
}

function machineGuid(): Promise<string> {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') return resolve(hostname())
        execFile('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
            { windowsHide: true, timeout: 5000 },
            (_err, out) => resolve(/MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out || '')?.[1] || hostname()))
    })
}

async function machineFingerprint(): Promise<string> {
    return createHash('sha256').update(`${await machineGuid()}|com.sebooth.app`).digest('hex')
}

function seal(pem: string): string {
    return safeStorage.isEncryptionAvailable()
        ? 'dpapi:' + safeStorage.encryptString(pem).toString('base64')
        : 'plain:' + Buffer.from(pem).toString('base64')
}

function unseal(sealed: string): string {
    const [kind, b64] = sealed.split(':')
    if (kind === 'dpapi') return safeStorage.decryptString(Buffer.from(b64, 'base64'))
    if (kind === 'plain') return Buffer.from(b64, 'base64').toString('utf-8')
    throw new Error('unknown key sealing')
}

const spki = (key: KeyObject): string => key.export({ format: 'der', type: 'spki' }).toString('base64')

/** Loads this machine's identity, or creates a fresh one. `fresh` is true when a new identity was made. */
export async function loadIdentity(): Promise<{ identity: Identity; fresh: boolean }> {
    const fingerprint = await machineFingerprint()
    try {
        const s: Stored = JSON.parse(await readFile(identityFile(), 'utf-8'))
        if (s.fingerprint === fingerprint) {
            const privateKey = createPrivateKey(unseal(s.sealedKey))
            if (spki(createPublicKey(privateKey)) === s.publicKey) {
                return { identity: { deviceId: s.deviceId, publicKey: s.publicKey, privateKey, fingerprint, counter: s.counter }, fresh: false }
            }
        }
        console.warn('[Guard] Stored identity belongs to another machine or cannot be opened; creating a new one')
    } catch {
        // first run, or unreadable
    }
    return { identity: await createIdentity(fingerprint), fresh: true }
}

async function createIdentity(fingerprint: string): Promise<Identity> {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const identity: Identity = { deviceId: null, publicKey: spki(publicKey), privateKey, fingerprint, counter: 0 }
    await saveIdentity(identity)
    return identity
}

export async function saveIdentity(id: Identity): Promise<void> {
    const pem = id.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string
    const stored: Stored = { deviceId: id.deviceId, publicKey: id.publicKey, sealedKey: seal(pem), fingerprint: id.fingerprint, counter: id.counter }
    await atomicWrite(identityFile(), JSON.stringify(stored))
}

/** Revocation: forget this identity; the next start (or call) creates a new pending one. */
export async function wipeIdentity(): Promise<Identity> {
    await rm(identityFile(), { force: true })
    return createIdentity(await machineFingerprint())
}
