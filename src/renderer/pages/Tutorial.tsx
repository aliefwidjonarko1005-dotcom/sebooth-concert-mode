import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppConfig, useSessionStore } from '../stores'
import { SessionTimer } from '../components/SessionTimer'
import { ConfirmBackHomeModal } from '../components/ConfirmBackHomeModal'
import { useButtonHints, useInputMode } from '../components/ButtonRail/ButtonRail'
import styles from './Tutorial.module.css'

/**
 * How-to screen between Landing/Queue and FrameSelection (skipped in concert mode, see startRoute).
 * Copy and the controls illustration follow the input mode: portrait booth = push buttons,
 * landscape booth = touchscreen. The steps are drawn as the booth's own artefact, a 4-frame photo strip.
 */

const INK = '#00113a'
const ORANGE = '#ff4500'
const SUN = '#ffc928'
const ROYAL = '#1d43c4'
const WHITE = '#ffffff'

// Seconds before the tutorial moves on by itself (it is not a decision, so no need to wait)
const AUTO_CONTINUE_SECONDS = 45

/** Where "start a session" goes: concert mode skips the tutorial. */
export function startRoute(concertMode?: boolean): string {
    return concertMode ? '/frames' : '/tutorial'
}

function FramePic() {
    return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
            <rect x="22" y="10" width="76" height="100" rx="6" fill={WHITE} stroke={INK} strokeWidth="6" />
            <rect x="32" y="20" width="56" height="34" fill={ROYAL} stroke={INK} strokeWidth="4" />
            <rect x="32" y="60" width="56" height="34" fill={ROYAL} stroke={INK} strokeWidth="4" />
            <rect x="32" y="98" width="56" height="5" fill={ORANGE} />
        </svg>
    )
}

function CountPic() {
    const pts = Array.from({ length: 24 }, (_, i) => {
        const a = (Math.PI * i) / 12 - Math.PI / 2
        const r = i % 2 ? 40 : 54
        return `${(60 + r * Math.cos(a)).toFixed(1)},${(60 + r * Math.sin(a)).toFixed(1)}`
    }).join(' ')
    return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
            <polygon points={pts} fill={ORANGE} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
            <text x="60" y="78" textAnchor="middle" fontSize="50" fontWeight="900" fill={WHITE} stroke={INK} strokeWidth="5" paintOrder="stroke" fontFamily="var(--font-family)">3</text>
        </svg>
    )
}

function RetakePic() {
    return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
            <rect x="14" y="20" width="72" height="80" rx="4" fill={WHITE} stroke={INK} strokeWidth="6" />
            <rect x="22" y="28" width="56" height="50" fill={SUN} />
            <circle cx="50" cy="48" r="10" fill={WHITE} stroke={INK} strokeWidth="4" />
            <path d="M34 78 C38 62 62 62 66 78" fill={WHITE} stroke={INK} strokeWidth="4" />
            <path d="M96 40 a22 22 0 1 1 -12 -6" fill="none" stroke={INK} strokeWidth="7" strokeLinecap="round" />
            <polygon points="78,24 92,36 76,42" fill={INK} />
        </svg>
    )
}

function TakeHomePic() {
    const cells = [[0, 0], [2, 0], [0, 2], [1, 1], [3, 1], [2, 3], [3, 3], [1, 3]]
    return (
        <svg viewBox="0 0 120 120" aria-hidden="true">
            <rect x="10" y="14" width="58" height="58" rx="6" fill={WHITE} stroke={INK} strokeWidth="6" />
            {cells.map(([cx, cy], i) => (
                <rect key={i} x={20 + cx * 10} y={24 + cy * 10} width="9" height="9" fill={INK} />
            ))}
            <rect x="66" y="40" width="42" height="70" rx="4" fill={WHITE} stroke={INK} strokeWidth="6" transform="rotate(8 87 75)" />
            <rect x="73" y="49" width="28" height="22" fill={ROYAL} transform="rotate(8 87 75)" />
            <rect x="73" y="76" width="28" height="22" fill={ORANGE} transform="rotate(8 87 75)" />
        </svg>
    )
}

/** Side panel with the three physical buttons; 3 is the big orange one and keeps getting pressed. */
function ButtonsPic() {
    return (
        <svg viewBox="0 0 120 220" className={styles.controlsPic} aria-hidden="true">
            <rect x="20" y="6" width="80" height="208" rx="22" fill={INK} />
            {[1, 2].map((n, i) => (
                <g key={n}>
                    <circle cx="60" cy={44 + i * 62} r="22" fill={WHITE} stroke={WHITE} strokeWidth="4" />
                    <text x="60" y={54 + i * 62} textAnchor="middle" fontSize="28" fontWeight="900" fill={INK} fontFamily="var(--font-family)">{n}</text>
                </g>
            ))}
            <g className={styles.pressKey}>
                <circle cx="60" cy="168" r="28" fill={ORANGE} stroke={WHITE} strokeWidth="4" />
                <text x="60" y="179" textAnchor="middle" fontSize="32" fontWeight="900" fill={WHITE} fontFamily="var(--font-family)">3</text>
            </g>
        </svg>
    )
}

/** An orange on-screen button with tap ripples. */
function TapPic() {
    return (
        <svg viewBox="0 0 220 140" className={styles.controlsPic} aria-hidden="true">
            <circle className={styles.ripple} cx="150" cy="70" r="26" fill="none" stroke={WHITE} strokeWidth="6" />
            <circle className={`${styles.ripple} ${styles.rippleLate}`} cx="150" cy="70" r="26" fill="none" stroke={WHITE} strokeWidth="6" />
            <rect x="14" y="40" width="192" height="60" rx="30" fill={ORANGE} stroke={INK} strokeWidth="6" />
            <rect x="40" y="62" width="76" height="16" rx="8" fill={INK} />
            <circle className={styles.tapDot} cx="150" cy="70" r="14" fill={WHITE} stroke={INK} strokeWidth="5" />
        </svg>
    )
}

const STEPS: { pic: JSX.Element; text: string }[] = [
    { pic: <FramePic />, text: 'Pilih frame' },
    { pic: <CountPic />, text: 'Bergaya saat hitung mundur' },
    { pic: <RetakePic />, text: 'Cek fotomu, ulangi kalau kurang pas' },
    { pic: <TakeHomePic />, text: 'Pilih filter, lalu scan QR dan ambil cetakannya' }
]

function Tutorial(): JSX.Element {
    const navigate = useNavigate()
    const { config } = useAppConfig()
    const { endSession } = useSessionStore()
    const mode = useInputMode()
    const touch = mode === 'touch'
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)

    const goOn = (): void => navigate('/frames')

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === '3') {
                e.preventDefault()
                navigate('/frames')
            } else if (e.key === '1') {
                e.preventDefault()
                setIsConfirmModalOpen(true)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [navigate])

    useButtonHints({
        1: { label: 'Kembali', onScreen: true },
        3: { label: 'Mengerti, lanjut', primary: true, onScreen: true }
    })

    return (
        <div className={`${styles.container} ${touch ? styles.touch : ''}`}>
            <SessionTimer
                duration={AUTO_CONTINUE_SECONDS}
                onTimeout={goOn}
                enabled={config.sessionTimerEnabled}
                label="Lanjut otomatis"
            />

            {touch && (
                <button type="button" className={styles.backBtn} onClick={() => setIsConfirmModalOpen(true)}>
                    Kembali
                </button>
            )}

            <section className={styles.intro}>
                <h1 className={`kiosk-title ${styles.title}`}>Begini cara pakainya</h1>
                <p className={styles.lead}>
                    {touch ? 'Semuanya cukup diketuk di layar.' : 'Semuanya diatur tiga tombol di sisi kanan layar.'}
                </p>

                <div className={styles.controls}>
                    {touch ? <TapPic /> : <ButtonsPic />}
                    <ul className={styles.controlsList}>
                        {touch ? (
                            <>
                                <li><strong>Tombol oranye</strong> untuk lanjut dan mengambil foto.</li>
                                <li><strong>Ketuk gambar</strong> untuk memilih frame atau foto.</li>
                            </>
                        ) : (
                            <>
                                <li><strong>Tombol 3</strong> untuk lanjut dan mengambil foto. Untuk maju, selalu tombol ini.</li>
                                <li><strong>Tombol 1 dan 2</strong> untuk pilihan lain. Artinya tertulis di samping tombol.</li>
                            </>
                        )}
                    </ul>
                </div>

                {touch ? (
                    <button type="button" className={styles.cta} onClick={goOn}>Mengerti, pilih frame</button>
                ) : (
                    <p className={styles.cta}>
                        <span>Tekan</span>
                        <span className={styles.ctaKey}>3</span>
                        <span>kalau sudah paham</span>
                    </p>
                )}
            </section>

            {/* The steps, printed as a photo strip */}
            <ol className={styles.strip} aria-label="Langkah-langkah">
                {STEPS.map((s, i) => (
                    <li key={s.text} className={styles.frame} style={{ animationDelay: `${0.25 + i * 0.18}s` }}>
                        <span className={styles.pic}>{s.pic}</span>
                        <span className={styles.stepText}>{s.text}</span>
                    </li>
                ))}
            </ol>

            <ConfirmBackHomeModal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                onConfirm={() => {
                    endSession()
                    navigate('/')
                }}
            />
        </div>
    )
}

export default Tutorial
