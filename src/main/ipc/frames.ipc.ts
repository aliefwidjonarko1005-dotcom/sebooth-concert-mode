import { ipcMain, app } from 'electron'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { GCS_BUCKET_NAME } from '@shared/supabaseConfig'
import type { APIResponse, FrameConfig } from '@shared/types'
import { getStorage } from './cloud.ipc'

// Frame packs in the media bucket: frame-packs/index.json (list), frame-packs/<id>/manifest.json + 1.png, 2.png …
// Reading is public (bucket-level read, same as session media); uploading needs the GCS key on this laptop.
const PREFIX = 'frame-packs'
const PUBLIC = `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${PREFIX}`
const NO_CACHE = 'no-cache, max-age=0' // index/manifest change; GCS serves public objects with max-age=3600 otherwise

export interface FramePackInfo { id: string; name: string; createdAt: number; count: number }

async function getJson<T>(url: string): Promise<T> {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<T>
}

async function listPacks(): Promise<FramePackInfo[]> {
    try {
        return await getJson<FramePackInfo[]>(`${PUBLIC}/index.json`)
    } catch (e) {
        if ((e as Error).message === 'HTTP 404') return [] // nothing uploaded yet
        throw e
    }
}

const fail = (e: unknown): APIResponse<never> => ({ success: false, error: (e as Error)?.message || String(e) })

export function registerFrameHandlers(): void {
    ipcMain.handle('frames:list-packs', async (): Promise<APIResponse<FramePackInfo[]>> => {
        try { return { success: true, data: await listPacks() } } catch (e) { return fail(e) }
    })

    // Overlay bytes come from the renderer (it already shows them), so main never opens a renderer-given path.
    ipcMain.handle('frames:upload-pack', async (_, params: { name: string; frames: { frame: FrameConfig; png: Uint8Array }[] }): Promise<APIResponse<FramePackInfo>> => {
        try {
            const storage = getStorage()
            if (!storage) throw new Error('Kunci Google Cloud tidak ada di laptop ini, jadi tidak bisa upload.')
            const name = String(params?.name || '').trim().slice(0, 60)
            if (!name || !params.frames?.length) throw new Error('Nama paket dan minimal satu frame wajib diisi.')

            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'paket'
            const id = `${Date.now().toString(36)}-${slug}`
            const bucket = storage.bucket(GCS_BUCKET_NAME)

            const frames: FrameConfig[] = []
            for (const [i, f] of params.frames.entries()) {
                const file = `${i + 1}.png`
                await bucket.file(`${PREFIX}/${id}/${file}`).save(Buffer.from(f.png), { resumable: false, metadata: { contentType: 'image/png' } })
                frames.push({ ...f.frame, overlayPath: file, originalOverlayPath: undefined })
            }
            const info: FramePackInfo = { id, name, createdAt: Date.now(), count: frames.length }
            await bucket.file(`${PREFIX}/${id}/manifest.json`).save(JSON.stringify({ ...info, frames }), {
                resumable: false, metadata: { contentType: 'application/json', cacheControl: NO_CACHE }
            })
            // shortcut: read-modify-write of the index; two laptops uploading in the same second can drop one entry
            const index = [info, ...(await listPacks()).filter(p => p.id !== id)]
            await bucket.file(`${PREFIX}/index.json`).save(JSON.stringify(index), {
                resumable: false, metadata: { contentType: 'application/json', cacheControl: NO_CACHE }
            })
            return { success: true, data: info }
        } catch (e) { return fail(e) }
    })

    // Downloads a pack into userData/frame-packs/<id>/ and returns its frames with local overlay paths
    ipcMain.handle('frames:download-pack', async (_, id: string): Promise<APIResponse<FrameConfig[]>> => {
        try {
            if (!/^[a-z0-9-]{1,64}$/.test(String(id))) throw new Error('ID paket tidak valid.')
            const manifest = await getJson<{ frames: FrameConfig[] }>(`${PUBLIC}/${id}/manifest.json`)
            const dir = path.join(app.getPath('userData'), 'frame-packs', id)
            await mkdir(dir, { recursive: true })
            const frames: FrameConfig[] = []
            for (const frame of manifest.frames || []) {
                if (!/^\d{1,3}\.png$/.test(frame.overlayPath)) throw new Error('Isi paket tidak valid.')
                const res = await fetch(`${PUBLIC}/${id}/${frame.overlayPath}`)
                if (!res.ok) throw new Error(`Gambar frame gagal diunduh (HTTP ${res.status}).`)
                const file = path.join(dir, frame.overlayPath)
                await writeFile(file, Buffer.from(await res.arrayBuffer()))
                frames.push({ ...frame, overlayPath: file })
            }
            return { success: true, data: frames }
        } catch (e) { return fail(e) }
    })
}
