import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { create } from 'zustand'
import { useAppConfig } from '../../stores'
import { SeboothLogo } from '../brand/SeboothLogo'
import styles from './ButtonRail.module.css'

/**
 * Right-edge legend for the three physical push buttons (1 top, 2 middle, 3 bottom).
 * Pages declare what each button does with useButtonHints(); unused buttons render dimmed.
 * Also hosts KeyGuard, which drops bounced/double button presses before pages see them.
 *
 * Input mode follows the screen: portrait = push-button booth (this rail), landscape = touchscreen.
 * In touch mode the rail is gone; hints the page does not already show as on-screen controls
 * (onScreen !== true) become tappable buttons in a bottom dock that fire the same key, so every
 * page keeps a single action path.
 */

export type ButtonKey = 1 | 2 | 3
export interface ButtonHint {
    label: string
    primary?: boolean // the "go forward" action (always button 3 by convention)
    onScreen?: boolean // the page already shows a tappable control for this action (touch mode skips it)
}

export type InputMode = 'buttons' | 'touch'

/** Portrait booth = physical push buttons; landscape booth = touchscreen. */
export function useInputMode(): InputMode {
    const { config } = useAppConfig()
    return config.appOrientation === 'portrait' ? 'buttons' : 'touch'
}
type Hints = Partial<Record<ButtonKey, ButtonHint | null>>

const useHintStore = create<{
    hints: Hints
    set: (h: Hints) => void
    override: Hints | null
    setOverride: (h: Hints | null) => void
    status: string
    setStatus: (s: string) => void
}>((set) => ({
    hints: {},
    set: (hints) => set({ hints }),
    override: null,
    setOverride: (override) => set({ override }),
    status: '',
    setStatus: (status) => set({ status })
}))

/** Declare the physical button actions for the current screen. Pass a stable-ish object; it's compared by content. */
export function useButtonHints(hints: Hints): void {
    const set = useHintStore((s) => s.set)
    const key = JSON.stringify(hints)
    useEffect(() => {
        set(hints)
        return () => set({})
    }, [key])
}

/**
 * Temporary hints that win over the page's own while a dialog is open (pass null when closed).
 * Separate from useButtonHints so closing the dialog restores the page's labels untouched.
 */
export function useButtonHintsOverride(hints: Hints | null): void {
    const setOverride = useHintStore((s) => s.setOverride)
    const key = JSON.stringify(hints)
    useEffect(() => {
        setOverride(hints)
        return () => setOverride(null)
    }, [key])
}

/** Small progress line under the rail logo (e.g. "Foto 1/2"). Cleared when the page unmounts. */
export function useRailStatus(text: string): void {
    const setStatus = useHintStore((s) => s.setStatus)
    useEffect(() => {
        setStatus(text)
        return () => setStatus('')
    }, [text])
}

const HIDDEN_ROUTES = ['/admin', '/loket', '/gallery']
const DEFAULT_POSITIONS: [number, number, number] = [22, 50, 78]

// Same key again within this window = switch bounce, not a second press
const SAME_KEY_DEBOUNCE_MS = 400
// After a screen change, ignore everything briefly so a bounced press can't act on the next screen
const ROUTE_LOCKOUT_MS = 700

function KeyGuard({ routeKey }: { routeKey: string }): null {
    useEffect(() => {
        const lockUntil = Date.now() + ROUTE_LOCKOUT_MS
        const lastPress: Record<string, number> = {}

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== '1' && e.key !== '2' && e.key !== '3') return
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
            const now = Date.now()
            const bounced = e.repeat || now < lockUntil || now - (lastPress[e.key] || 0) < SAME_KEY_DEBOUNCE_MS
            if (!e.repeat) lastPress[e.key] = now
            if (bounced) {
                // Capture phase on window runs before every page listener, so they never see it
                e.stopImmediatePropagation()
                e.preventDefault()
            }
        }
        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [routeKey])
    return null
}

export function ButtonRail(): JSX.Element | null {
    const location = useLocation()
    const { config } = useAppConfig()
    const pageHints = useHintStore((s) => s.hints)
    const override = useHintStore((s) => s.override)
    const hints = override ?? pageHints
    const status = useHintStore((s) => s.status)

    const touch = config.appOrientation !== 'portrait'
    const offRoute = HIDDEN_ROUTES.some((r) => location.pathname.startsWith(r))
    const hidden = touch || config.buttonRailEnabled === false || offRoute
    const dockHints = touch && !offRoute
        ? ([1, 2, 3] as ButtonKey[]).filter((k) => hints[k] && !hints[k]!.onScreen)
        : []
    const positions = config.buttonRailPositions || DEFAULT_POSITIONS

    useEffect(() => {
        document.body.classList.toggle('has-rail', !hidden)
        return () => document.body.classList.remove('has-rail')
    }, [hidden])

    // Touch dock visible → pages reserve room for it (body.has-dock, landscape only)
    const hasDock = dockHints.length > 0
    useEffect(() => {
        document.body.classList.toggle('has-dock', hasDock)
        return () => document.body.classList.remove('has-dock')
    }, [hasDock])

    return (
        <>
            <KeyGuard routeKey={location.pathname} />
            {dockHints.length > 0 && (
                <nav className={styles.dock} aria-label="Aksi">
                    {dockHints.map((k) => (
                        <button
                            key={k}
                            type="button"
                            className={`${styles.dockBtn} ${hints[k]!.primary ? styles.dockPrimary : ''}`}
                            // Same path as the physical button: pages listen for keydown 1/2/3
                            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: String(k), bubbles: true }))}
                        >
                            {hints[k]!.label}
                        </button>
                    ))}
                </nav>
            )}
            {!hidden && (
                <aside className={styles.rail} aria-label="Panduan tombol">
                    <div className={styles.logo}>
                        <SeboothLogo theme="royal" ink="#ffffff" accent="#fe6b00" />
                        {status && <div className={styles.status}>{status}</div>}
                    </div>
                    {([1, 2, 3] as ButtonKey[]).map((k, i) => {
                        const hint = hints[k]
                        return (
                            <button
                                key={k}
                                type="button"
                                tabIndex={-1}
                                disabled={!hint}
                                className={`${styles.item} ${hint ? '' : styles.idle} ${hint?.primary ? styles.primary : ''}`}
                                style={{ top: `${positions[i]}%` }}
                                // Clicking/tapping the legend = pressing that physical button (same keydown path)
                                onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: String(k), bubbles: true }))}
                            >
                                <span className={styles.label}>{hint?.label || ''}</span>
                                <span className={styles.badge}>{k}</span>
                            </button>
                        )
                    })}
                </aside>
            )}
        </>
    )
}
