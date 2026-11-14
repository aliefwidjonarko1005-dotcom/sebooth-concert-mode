import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'
import styles from './LockScreen.module.css'

export interface GuardView {
    enabled: boolean
    locked: boolean
    mode: 'disabled' | 'pending' | 'active' | 'stale' | 'locked'
    reason: string | null
    deviceCode: string
    approveUrl: string
}

const MESSAGES: Record<string, string> = {
    'pending:': 'Instalasi baru. Owner perlu meng-approve booth ini dari device-nya.',
    'pending:revoked': 'Booth ini dicabut. Owner perlu meng-approve ulang.',
    'locked:owner': 'Booth dikunci oleh owner.',
    'locked:clone': 'Identitas booth ini terdeteksi dipakai di lebih dari satu PC.',
    'locked:tamper': 'File keamanan booth berubah atau hilang.',
    'locked:server': 'Booth dikunci dari server.',
    'stale:offline': 'Booth tidak terhubung ke server lebih dari 3 hari. Sambungkan internet, booth terbuka sendiri.',
    'stale:clock': 'Jam komputer mundur. Perbaiki jam, lalu sambungkan internet.',
}

/** Reads the Booth Guard state from main and keeps it current. */
export function useGuardView(): GuardView | null {
    const [view, setView] = useState<GuardView | null>(null)
    useEffect(() => {
        const guard = (window as any).api?.guard
        if (!guard) return // remote browser on the LAN server: the server itself refuses while locked
        guard.getState().then((r: any) => r?.success && setView(r.data))
        return guard.onState((v: GuardView) => setView(v))
    }, [])
    return view
}

export function LockScreen({ view }: { view: GuardView }): JSX.Element {
    const message = MESSAGES[`${view.mode}:${view.reason || ''}`] || MESSAGES[`${view.mode}:`] || 'Booth terkunci.'
    return (
        <div className={styles.root}>
            <h1 className={`kiosk-title ${styles.title}`}>Booth terkunci</h1>
            <p className={styles.message}>{message}</p>
            <div className={styles.card}>
                <div className={styles.qr}>
                    <QRCode value={view.approveUrl} size={256} style={{ width: '100%', height: 'auto' }} />
                </div>
                <div className={styles.code}>
                    <span className={styles.codeLabel}>Kode booth</span>
                    <span className={`kiosk-num ${styles.codeValue}`}>{view.deviceCode || '--------'}</span>
                </div>
            </div>
            <p className={styles.hint}>Hanya owner yang bisa membuka kunci, lewat passkey di device-nya.</p>
        </div>
    )
}
