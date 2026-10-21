import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './PickupCounter.module.css'

interface PrintJob {
    id: string
    sessionId: string
    filePath: string
    copies: number
    status: 'QUEUED' | 'PRINTING' | 'COMPLETED' | 'FAILED'
    createdAt: number
    completedAt?: number
    sourceDevice?: string
    label?: string
    errorMessage?: string
    pickedUpAt?: number
    reprintedAt?: number
}

interface BoothBeat { deviceName: string; boothCode?: string; pending: number; lastSeen: number }
interface ServerStatus {
    serverTime: number
    version?: number
    printServerEnabled: boolean
    printerName: string
    deviceName: string
    queueLength: number
    booths: BoothBeat[]
}

type View = 'QUEUED' | 'PRINTING' | 'READY' | 'FAILED' | 'PICKED' | 'REPRINTED'
type Filter = 'open' | 'READY' | 'busy' | 'FAILED' | 'PICKED' | 'all'
interface Toast { text: string; bad?: boolean; action?: { label: string; fn: () => void } }
interface Confirm { text: string; yes: string; onYes: () => void }

const VIEW_TEXT: Record<View, string> = {
    QUEUED: 'Antre',
    PRINTING: 'Mencetak',
    READY: 'Siap diambil',
    FAILED: 'Gagal',
    PICKED: 'Sudah diambil',
    REPRINTED: 'Dicetak ulang'
}

const FILTERS: { id: Filter; label: string }[] = [
    { id: 'open', label: 'Belum diambil' },
    { id: 'READY', label: 'Siap' },
    { id: 'busy', label: 'Antre / cetak' },
    { id: 'FAILED', label: 'Gagal' },
    { id: 'PICKED', label: 'Diambil' },
    { id: 'all', label: 'Semua' }
]

const PAGE = 60
const BOOTH_STALE_MS = 30000
const TOAST_MS = 6000

// Electron window and dev preview talk to the local server; a phone opened at http://<ip>:5050 uses its own origin
const API = window.location.port === '5050' ? '' : 'http://localhost:5050'
const isElectron = !!(window as any).api

const viewOf = (j: PrintJob): View => {
    if (j.pickedUpAt) return 'PICKED'
    if (j.reprintedAt) return 'REPRINTED'
    if (j.status === 'COMPLETED') return 'READY'
    return j.status
}

const inFilter = (v: View, f: Filter): boolean => {
    switch (f) {
        case 'open': return v === 'QUEUED' || v === 'PRINTING' || v === 'READY' || v === 'FAILED'
        case 'busy': return v === 'QUEUED' || v === 'PRINTING'
        case 'all': return true
        default: return v === f
    }
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const clock = (t: number) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
const ago = (ms: number) => ms < 60000 ? `${Math.round(ms / 1000)} dtk lalu` : `${Math.round(ms / 60000)} mnt lalu`

async function getJson(path: string) {
    const res = await fetch(`${API}${path}`)
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
}

async function post(path: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    })
    const data = await res.json().catch(() => ({}))
    // The server answers 404 + success:false when the job is gone; that must not look like it worked
    if (!res.ok || data?.success === false) throw new Error(`${res.status}`)
    return data
}

/**
 * Pickup counter dashboard for the Print Server laptop (and staff phones via http://<ip>:5050/#/loket):
 * find a strip by code or photo, mark it picked up, reprint failures, and see which booths still hold unsent prints.
 */
function PickupCounter(): JSX.Element {
    const navigate = useNavigate()
    const [jobs, setJobs] = useState<PrintJob[]>([])
    const [status, setStatus] = useState<ServerStatus | null>(null)
    const [offline, setOffline] = useState(false)
    const [lastOk, setLastOk] = useState<number | null>(null)
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<Filter>('open')
    const [booth, setBooth] = useState('')
    const [limit, setLimit] = useState(PAGE)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [imgFailed, setImgFailed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [showHelp, setShowHelp] = useState(false)
    const [toast, setToast] = useState<Toast | null>(null)
    const [confirm, setConfirm] = useState<Confirm | null>(null)

    const searchRef = useRef<HTMLInputElement>(null)
    const modalRef = useRef<HTMLDivElement>(null)
    const versionRef = useRef<number | undefined>(-1)

    const refresh = useCallback(async (force = false) => {
        // A phone in a pocket keeps the tab alive; no need to poll it
        if (document.hidden && !force) return
        try {
            const s: ServerStatus = await getJson('/api/print/status')
            setStatus(s)
            // The lists can be 2000 jobs, so only pull them when the server says something changed
            if (force || s.version === undefined || s.version !== versionRef.current) {
                const [q, h] = await Promise.all([getJson('/api/print/queue'), getJson('/api/print/history')])
                // Waiting jobs first (oldest first), then finished jobs (newest first)
                setJobs([...(Array.isArray(q) ? q : []), ...(Array.isArray(h) ? h : [])])
                versionRef.current = s.version
            }
            setOffline(false)
            setLastOk(Date.now())
        } catch {
            setOffline(true)
        }
    }, [])

    useEffect(() => {
        refresh(true)
        const t = setInterval(() => refresh(), 3000)
        const onVisible = () => { if (!document.hidden) refresh(true) }
        document.addEventListener('visibilitychange', onVisible)
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
    }, [refresh])

    useEffect(() => {
        if (!toast) return
        const t = setTimeout(() => setToast(null), TOAST_MS)
        return () => clearTimeout(t)
    }, [toast])

    const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0)

    const closeDetail = useCallback(() => {
        setSelectedId(null)
        focusSearch()
    }, [])

    // Escape closes the top-most layer: confirm, then detail
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            if (confirm) setConfirm(null)
            else if (selectedId) closeDetail()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [confirm, selectedId, closeDetail])

    // Detail opens with focus on its main action so Enter / Space finishes the handover
    useEffect(() => {
        setImgFailed(false)
        if (selectedId) setTimeout(() => modalRef.current?.querySelector<HTMLElement>('[data-primary]')?.focus(), 0)
    }, [selectedId])

    const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
        setBusy(true)
        try {
            await fn()
            await refresh(true)
            return true
        } catch {
            setToast({ text: 'Gagal menghubungi print server. Coba lagi.', bad: true })
            return false
        } finally {
            setBusy(false)
        }
    }

    const setPicked = (job: PrintJob, pickedUp: boolean) =>
        run(() => post(`/api/print/jobs/${job.id}/picked-up`, { pickedUp }))

    const markPicked = async (job: PrintJob) => {
        if (!(await setPicked(job, true))) return
        setSelectedId(null)
        setQuery('')
        setLimit(PAGE)
        focusSearch()
        setToast({
            text: `${job.label || 'Strip'} ditandai sudah diambil.`,
            action: { label: 'Batalkan', fn: () => { setToast(null); setPicked(job, false) } }
        })
    }

    const reprint = (job: PrintJob) => {
        const go = async () => {
            if (await run(() => post(`/api/print/jobs/${job.id}/reprint`))) {
                setToast({ text: `${job.label || 'Strip'} masuk antrean cetak ulang.` })
            }
        }
        // "Siap" only means the spooler took it (a paper jam still counts), so confirm before spending paper
        if (viewOf(job) === 'FAILED') go()
        else setConfirm({ text: `Cetak ulang ${job.label || 'strip ini'}?`, yes: 'Cetak ulang', onYes: go })
    }

    const counts = useMemo(() => {
        const c: Record<Filter, number> = { open: 0, READY: 0, busy: 0, FAILED: 0, PICKED: 0, all: 0 }
        for (const j of jobs) {
            if (booth && j.sourceDevice !== booth) continue
            const v = viewOf(j)
            for (const f of FILTERS) if (inFilter(v, f.id)) c[f.id]++
        }
        return c
    }, [jobs, booth])

    const boothNames = useMemo(
        () => [...new Set(jobs.map(j => j.sourceDevice).filter(Boolean) as string[])].sort(),
        [jobs]
    )

    const visible = useMemo(() => {
        const q = norm(query)
        return jobs.filter(j =>
            (!booth || j.sourceDevice === booth) &&
            // A code search looks through everything, so a picked-up or old strip is still found.
            // The replaced copy of a reprint is skipped: the new job carries the same code.
            (q ? norm(j.label || '').includes(q) && viewOf(j) !== 'REPRINTED' : inFilter(viewOf(j), filter))
        )
    }, [jobs, query, filter, booth])

    const failedOpen = jobs.filter(j => viewOf(j) === 'FAILED').length
    const selected = jobs.find(j => j.id === selectedId) || null
    const boothsWithIssues = (status?.booths || []).filter(b => b.pending > 0 || status!.serverTime - b.lastSeen > BOOTH_STALE_MS)

    const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && visible.length === 1) setSelectedId(visible[0].id)
        else if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') }
    }

    // Keep Tab inside the open dialog
    const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Tab') return
        const els = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)')]
        if (!els.length) return
        const first = els[0], last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1>Loket Pengambilan</h1>
                    <p className={styles.sub}>
                        {status ? `${status.deviceName} · Printer: ${status.printerName || 'belum dipilih'} · ${status.queueLength} antre` : 'Menghubungkan…'}
                    </p>
                </div>
                <div className={styles.headerActions}>
                    <button className={styles.ghostBtn} onClick={() => setShowHelp(v => !v)}>
                        {showHelp ? 'Tutup panduan' : 'Panduan'}
                    </button>
                    {isElectron && <button className={styles.ghostBtn} onClick={() => navigate('/admin')}>Admin</button>}
                </div>
            </header>

            {offline && (
                <div className={`${styles.banner} ${styles.bannerBad}`} role="alert">
                    <span>
                        <b>Tidak terhubung ke print server.</b> Pastikan laptop loket menyala dan satu jaringan.
                        {lastOk && ` Daftar di bawah adalah data terakhir jam ${clock(lastOk)} dan mungkin sudah berubah.`}
                    </span>
                </div>
            )}
            {status && !status.printServerEnabled && (
                <div className={`${styles.banner} ${styles.bannerWarn}`}>
                    Mode Print Server belum aktif di laptop ini, jadi booth tidak bisa mengirim cetakan. Aktifkan di Admin → Printers.
                </div>
            )}
            {failedOpen > 0 && (
                <div className={`${styles.banner} ${styles.bannerBad}`}>
                    <span><b>{failedOpen} cetakan gagal.</b> Cek kertas, tinta, dan kabel printer dulu, lalu cetak ulang.</span>
                    <button
                        className={styles.solidBtn}
                        disabled={busy}
                        onClick={() => setConfirm({
                            text: `Cetak ulang ${failedOpen} strip yang gagal? Pastikan printer sudah dibetulkan.`,
                            yes: `Cetak ulang ${failedOpen}`,
                            onYes: async () => {
                                if (await run(() => post('/api/print/reprint-failed'))) setToast({ text: `${failedOpen} strip masuk antrean cetak ulang.` })
                            }
                        })}
                    >
                        Cetak ulang semua ({failedOpen})
                    </button>
                </div>
            )}

            {showHelp && (
                <section className={styles.help}>
                    <div>
                        <h3>Alur cepat</h3>
                        <p>Ketik kode lalu Enter untuk membuka strip. Tekan Enter lagi untuk "Tandai sudah diambil" — kolom cari langsung kosong untuk customer berikutnya. Salah tandai? Tekan "Batalkan" di notifikasi bawah.</p>
                    </div>
                    <div>
                        <h3>Customer lupa kodenya</h3>
                        <p>Pilih booth tempat dia foto, filter "Belum diambil", lalu cocokkan wajah di foto dan jam cetaknya. Ketuk kartu untuk memperbesar foto.</p>
                    </div>
                    <div>
                        <h3>Customer tidak dapat kode dari booth</h3>
                        <p>Artinya cetakan belum sampai ke loket. Lihat panel Booth: kalau ada "tertunda", cetakan masih menunggu di booth dan akan masuk otomatis begitu jaringan tersambung. Kalau booth tidak muncul atau lama tidak terlihat, cek koneksi WiFi / Print Server URL di booth itu.</p>
                    </div>
                    <div>
                        <h3>Cetakan gagal</h3>
                        <p>Kartu merah = gagal. Betulkan printer (kertas habis, macet, kabel), lalu tekan "Cetak ulang". Strip yang macet tapi tercatat "Siap" juga bisa dicetak ulang dari detailnya.</p>
                    </div>
                </section>
            )}

            <section className={styles.booths}>
                <span className={styles.boothsTitle}>Booth</span>
                {(status?.booths || []).length === 0 && <span className={styles.muted}>Belum ada booth yang terhubung.</span>}
                {(status?.booths || []).map(b => {
                    const age = status!.serverTime - b.lastSeen
                    const stale = age > BOOTH_STALE_MS
                    return (
                        <span key={b.deviceName} className={`${styles.booth} ${stale || b.pending > 0 ? styles.boothWarn : ''}`}>
                            <b>{b.boothCode || b.deviceName}</b>
                            {b.boothCode && <span className={styles.muted}>{b.deviceName}</span>}
                            <span>{stale ? `tidak terlihat ${ago(age)}` : 'online'}</span>
                            {b.pending > 0 && <span>{b.pending} tertunda</span>}
                        </span>
                    )
                })}
                {boothsWithIssues.length > 0 && <span className={styles.muted}>Strip dari booth bertanda kuning mungkin belum sampai.</span>}
            </section>

            <section className={styles.controls}>
                <input
                    ref={searchRef}
                    autoFocus
                    className={styles.search}
                    value={query}
                    onChange={e => { setQuery(e.target.value); setLimit(PAGE) }}
                    onKeyDown={onSearchKey}
                    placeholder="Ketik kode, misal 037 atau B2-037"
                    aria-label="Cari kode"
                    inputMode="search"
                    enterKeyHint="go"
                    autoComplete="off"
                />
                {boothNames.length > 1 && (
                    <select className={styles.select} value={booth} onChange={e => { setBooth(e.target.value); setLimit(PAGE) }} aria-label="Booth">
                        <option value="">Semua booth</option>
                        {boothNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                )}
            </section>
            {query && visible.length === 1 && <p className={styles.hint}>Tekan Enter untuk membuka {visible[0].label}.</p>}

            <nav className={`${styles.filters} ${query ? styles.filtersOff : ''}`}>
                {FILTERS.map(f => (
                    <button
                        key={f.id}
                        className={`${styles.chip} ${filter === f.id ? styles.chipOn : ''} ${f.id === 'FAILED' && counts.FAILED > 0 ? styles.chipBad : ''}`}
                        aria-pressed={filter === f.id}
                        onClick={() => { setFilter(f.id); setQuery(''); setLimit(PAGE) }}
                    >
                        {f.label} <span className={styles.count}>{counts[f.id]}</span>
                    </button>
                ))}
            </nav>

            {visible.length === 0 ? (
                <p className={styles.empty}>
                    {query ? `Kode "${query}" tidak ditemukan. Mungkin cetakannya belum sampai — cek panel Booth di atas.` : 'Tidak ada cetakan di daftar ini.'}
                </p>
            ) : (
                <div className={styles.grid}>
                    {visible.slice(0, limit).map(job => {
                        const v = viewOf(job)
                        return (
                            <button key={job.id} className={`${styles.card} ${styles[`v${v}`]}`} onClick={() => setSelectedId(job.id)}>
                                <div className={styles.thumb}>
                                    <img src={`${API}/api/print/jobs/${job.id}/thumb`} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                                </div>
                                <div className={styles.cardInfo}>
                                    <div className={styles.code}>{job.label || '—'}</div>
                                    <span className={styles.status}>{VIEW_TEXT[v]}</span>
                                    <span className={styles.meta}>{job.sourceDevice || 'Lokal'} · {clock(job.createdAt)} · {job.copies}x</span>
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
            {visible.length > limit && (
                <button className={styles.more} onClick={() => setLimit(l => l + PAGE)}>
                    Tampilkan lebih banyak ({visible.length - limit} lagi)
                </button>
            )}

            {selected && (
                <div className={styles.backdrop} onClick={closeDetail}>
                    <div
                        ref={modalRef}
                        className={styles.modal}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Detail ${selected.label || 'strip'}`}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={trapTab}
                    >
                        <div className={styles.modalImg}>
                            {imgFailed
                                ? <div className={styles.imgMissing}>Foto tidak tersedia di laptop ini</div>
                                : <img src={`${API}/api/print/jobs/${selected.id}/image`} alt={selected.label || selected.sessionId} onError={() => setImgFailed(true)} />}
                        </div>
                        <div className={styles.modalInfo}>
                            <div className={styles.modalCode}>{selected.label || 'Tanpa kode'}</div>
                            <span className={`${styles.badge} ${styles[`v${viewOf(selected)}`]}`}>{VIEW_TEXT[viewOf(selected)]}</span>
                            <dl className={styles.facts}>
                                <dt>Booth</dt><dd>{selected.sourceDevice || 'Lokal'}</dd>
                                <dt>Masuk</dt><dd>{clock(selected.createdAt)}</dd>
                                {selected.completedAt && <><dt>Selesai</dt><dd>{clock(selected.completedAt)}</dd></>}
                                <dt>Jumlah</dt><dd>{selected.copies} lembar</dd>
                                {selected.pickedUpAt && <><dt>Diambil</dt><dd>{clock(selected.pickedUpAt)}</dd></>}
                            </dl>
                            {selected.status === 'FAILED' && selected.errorMessage && <p className={styles.errorText}>{selected.errorMessage}</p>}
                            {selected.reprintedAt && !selected.pickedUpAt && (
                                <p className={styles.muted}>Sudah dicetak ulang {clock(selected.reprintedAt)} — serahkan dari kartu kode yang sama yang terbaru.</p>
                            )}

                            <div className={styles.modalActions}>
                                {(selected.status === 'COMPLETED' || selected.status === 'FAILED') && (
                                    selected.pickedUpAt ? (
                                        <button data-primary className={styles.ghostBtn} disabled={busy} onClick={() => setPicked(selected, false)}>
                                            Batalkan "sudah diambil"
                                        </button>
                                    ) : (
                                        <button data-primary className={styles.solidBtn} disabled={busy} onClick={() => markPicked(selected)}>
                                            Tandai sudah diambil
                                        </button>
                                    )
                                )}
                                {(selected.status === 'COMPLETED' || selected.status === 'FAILED') && (
                                    <button className={styles.ghostBtn} disabled={busy} onClick={() => reprint(selected)}>Cetak ulang</button>
                                )}
                                <button data-primary={selected.status === 'QUEUED' || selected.status === 'PRINTING' ? true : undefined} className={styles.ghostBtn} onClick={closeDetail}>Tutup</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {confirm && (
                <div className={`${styles.backdrop} ${styles.backdropTop}`} onClick={() => setConfirm(null)}>
                    <div className={styles.confirm} role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()} onKeyDown={trapTab}>
                        <p>{confirm.text}</p>
                        <div className={styles.modalActions}>
                            <button className={styles.ghostBtn} onClick={() => setConfirm(null)}>Batal</button>
                            <button autoFocus className={styles.solidBtn} onClick={() => { const c = confirm; setConfirm(null); c.onYes() }}>{confirm.yes}</button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div className={`${styles.toast} ${toast.bad ? styles.toastBad : ''}`} role="status" aria-live="polite">
                    <span>{toast.text}</span>
                    {toast.action && <button className={styles.toastBtn} onClick={toast.action.fn}>{toast.action.label}</button>}
                </div>
            )}
        </div>
    )
}

export default PickupCounter
