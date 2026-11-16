import { app } from 'electron'
import { realpath } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'

// File-path IPC only touches the app's own folders. A compromised renderer (webSecurity is off) must
// not be able to read keys/cookies elsewhere or write into e.g. the Windows Startup folder.
// Writes: userData, Documents\Sebooth, OS temp. Reads: those plus the app's own resources and any
// file the operator picked in a native open dialog during this run.

const picked = new Set<string>()

const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)

function writeRoots(): string[] {
    return [app.getPath('userData'), join(app.getPath('documents'), 'Sebooth'), app.getPath('temp')]
}

function readRoots(): string[] {
    return [...writeRoots(), process.resourcesPath, app.getAppPath()]
}

/** Resolves symlinks/junctions of the deepest existing ancestor, so a link cannot escape a root. */
async function realish(p: string): Promise<string> {
    let current = resolve(p)
    const rest: string[] = []
    for (;;) {
        try {
            return join(await realpath(current), ...rest.reverse())
        } catch {
            const parent = dirname(current)
            if (parent === current) return resolve(p)
            rest.push(current.slice(parent.length).replace(/^[\\/]+/, ''))
            current = parent
        }
    }
}

async function inside(p: string, roots: string[]): Promise<boolean> {
    const target = norm(await realish(p))
    for (const root of roots) {
        const r = norm(await realish(root))
        if (target === r || target.startsWith(r.endsWith(sep) ? r : r + sep)) return true
    }
    return false
}

/** Remember paths returned by the native open-file dialog: the operator chose them explicitly. */
export async function rememberPicked(paths: string[]): Promise<void> {
    for (const p of paths) picked.add(norm(await realish(p)))
}

export async function assertReadable(p: unknown): Promise<string> {
    if (typeof p !== 'string' || !p) throw new Error('Invalid path')
    if (picked.has(norm(await realish(p))) || (await inside(p, readRoots()))) return p
    throw new Error(`Path not allowed: ${p}`)
}

export async function assertWritable(p: unknown): Promise<string> {
    if (typeof p !== 'string' || !p) throw new Error('Invalid path')
    if (await inside(p, writeRoots())) return p
    throw new Error(`Path not allowed: ${p}`)
}
