import { useCallback, useEffect, useState } from 'react'
import type { FrameConfig } from '../../../shared/types'
import { useAppConfig, useFrameStore } from '../../stores'
import styles from './FramePacksPanel.module.css'

interface Pack { id: string; name: string; createdAt: number; count: number }

const srcOf = (p: string) => (p.startsWith('http') || p.startsWith('data:') ? p : `file:///${p.replace(/\\/g, '/')}`)

// fetch() cannot read file:// URLs, but <img> can: draw it and re-encode as PNG
async function overlayPng(frame: FrameConfig): Promise<Uint8Array> {
    const img = new Image()
    img.src = srcOf(frame.overlayPath)
    await img.decode().catch(() => { throw new Error(`Gambar frame "${frame.name}" tidak terbaca.`) })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error(`Gambar frame "${frame.name}" gagal diproses.`)
    return new Uint8Array(await blob.arrayBuffer())
}

/** Admin → Frames: upload the active frames as a cloud pack, or download a pack and use it right away. */
export function FramePacksPanel(): JSX.Element {
    const { frames, addFrame } = useFrameStore()
    const { config, updateConfig } = useAppConfig()
    const [packs, setPacks] = useState<Pack[] | null>(null)
    const [name, setName] = useState('')
    const [busy, setBusy] = useState<string | null>(null) // 'upload' or the pack id being downloaded
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
    const api = window.api?.frames

    const load = useCallback(async () => {
        if (!api) return
        const r = await api.listPacks()
        if (r.success) setPacks(r.data)
        else setMsg({ ok: false, text: `Daftar paket gagal dimuat: ${r.error}` })
    }, [api])
    useEffect(() => { load() }, [load])

    if (!api) return <div className={styles.panel}><p className={styles.hint}>Paket frame cloud hanya bisa dari aplikasi booth.</p></div>

    const toUpload = config.activeFrameIds.length > 0 ? frames.filter(f => config.activeFrameIds.includes(f.id)) : frames

    const upload = async () => {
        setBusy('upload')
        setMsg(null)
        try {
            const items = []
            for (const frame of toUpload) items.push({ frame, png: await overlayPng(frame) })
            const r = await api.uploadPack({ name: name.trim(), frames: items })
            if (!r.success) throw new Error(r.error)
            setMsg({ ok: true, text: `Paket "${r.data.name}" terupload (${r.data.count} frame).` })
            setName('')
            await load()
        } catch (e) {
            setMsg({ ok: false, text: (e as Error).message })
        } finally {
            setBusy(null)
        }
    }

    const download = async (pack: Pack) => {
        setBusy(pack.id)
        setMsg(null)
        const r = await api.downloadPack(pack.id)
        if (r.success) {
            const ids = (r.data as FrameConfig[]).map(({ id: _id, ...frame }) => addFrame(frame))
            updateConfig({ activeFrameIds: ids })
            setMsg({ ok: true, text: `${ids.length} frame dari "${pack.name}" ditambahkan dan langsung jadi frame aktif.` })
        } else {
            setMsg({ ok: false, text: `Download gagal: ${r.error}` })
        }
        setBusy(null)
    }

    return (
        <div className={styles.panel}>
            <h4 className={styles.title}>Paket frame cloud</h4>
            <div className={styles.row}>
                <input
                    className={styles.input}
                    placeholder="Nama paket, mis. Konser X"
                    value={name}
                    maxLength={60}
                    onChange={e => setName(e.target.value)}
                />
                <button className={styles.button} disabled={!name.trim() || !!busy || toUpload.length === 0} onClick={upload}>
                    {busy === 'upload' ? 'Mengupload…' : `Upload ${toUpload.length} frame`}
                </button>
            </div>
            <p className={styles.hint}>Yang diupload: frame aktif (atau semua frame kalau belum ada yang aktif).</p>
            {msg && <p className={msg.ok ? styles.ok : styles.error}>{msg.text}</p>}

            <div className={styles.list}>
                {packs === null ? (
                    <p className={styles.hint}>Memuat daftar paket…</p>
                ) : packs.length === 0 ? (
                    <p className={styles.hint}>Belum ada paket di cloud.</p>
                ) : packs.map(p => (
                    <div key={p.id} className={styles.item}>
                        <div className={styles.itemInfo}>
                            <strong>{p.name}</strong>
                            <span>{p.count} frame · {new Date(p.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </div>
                        <button className={styles.button} disabled={!!busy} onClick={() => download(p)}>
                            {busy === p.id ? 'Mengunduh…' : 'Download'}
                        </button>
                    </div>
                ))}
            </div>
            <button className={styles.link} disabled={!!busy} onClick={load}>Muat ulang daftar</button>
        </div>
    )
}
