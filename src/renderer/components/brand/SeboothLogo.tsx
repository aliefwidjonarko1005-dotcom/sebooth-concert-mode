import { useId, type CSSProperties } from 'react'
import {
    LOGO_VIEWBOX,
    LETTER_S,
    LETTER_E,
    LETTER_B,
    LETTER_T,
    LETTER_H,
    EYE_LEFT,
    EYE_RIGHT,
    PHOTOBOOTH_LABEL,
    PAPER,
    PAPER_IMAGE,
    SLOT
} from './seboothLogoParts'

// Ported from sebooth-website src/components/ui/SeboothLoader.tsx — keep the two in sync.
// Animation CSS lives in styles/brand.css.

export const SEBOOTH_THEMES = {
    royal: { background: '#1d43c4', ink: '#fe6b00', accent: '#fe6b00' },
    navy: { background: '#00113a', ink: '#ffffff', accent: '#ff4500' },
    orange: { background: '#ff4500', ink: '#ffffff', accent: '#00113a' },
    light: { background: '#eef2ff', ink: '#002366', accent: '#ff4500' },
    white: { background: '#ffffff', ink: '#fe6b00', accent: '#002366' }
} as const

export type SeboothTheme = keyof typeof SEBOOTH_THEMES

interface SeboothLogoProps {
    /**
     * block: full animated wordmark (letters pop in, eyes look around, photo slides out).
     * mini: just the O-O eyes looking around, icon-sized (spinners, small marks).
     */
    variant?: 'block' | 'mini'
    theme?: SeboothTheme
    ink?: string
    accent?: string
    label?: string
    className?: string
    style?: CSSProperties
}

const STAGGER = 90
const EYES_VIEWBOX = '390 62 232 152'

function Eye({ uid, eye, delay, pop }: { uid: string; eye: { body: string; white: string }; delay: number; pop: boolean }) {
    const maskId = `${uid}-mask`
    return (
        <g className={pop ? 'sb-loader__pop' : undefined} style={pop ? { animationDelay: `${delay}ms` } : undefined}>
            <g className="sb-loader__blink">
                <mask id={maskId} maskUnits="userSpaceOnUse" x="380" y="50" width="260" height="180">
                    <rect x="380" y="50" width="260" height="180" fill="#fff" />
                    <path className="sb-loader__look" d={eye.white} fill="#000" />
                </mask>
                <path d={eye.body} mask={`url(#${maskId})`} />
            </g>
        </g>
    )
}

export function SeboothLogo({
    variant = 'block',
    theme = 'royal',
    ink,
    accent,
    label = 'Sebooth Photobooth',
    className = '',
    style
}: SeboothLogoProps): JSX.Element {
    const uid = `sb${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
    const preset = SEBOOTH_THEMES[theme]
    const colors = {
        '--sb-ink': ink ?? (variant === 'mini' ? 'currentColor' : preset.ink),
        '--sb-accent': accent ?? preset.accent,
        ...style
    } as CSSProperties

    if (variant === 'mini') {
        return (
            <span role="img" aria-label={label} className={`sb-loader-mini ${className}`} style={colors}>
                <svg viewBox={EYES_VIEWBOX} aria-hidden="true" className="sb-loader-mini__svg">
                    <Eye uid={`${uid}-l`} eye={EYE_LEFT} delay={0} pop={false} />
                    <Eye uid={`${uid}-r`} eye={EYE_RIGHT} delay={0} pop={false} />
                </svg>
            </span>
        )
    }

    // The photo raster is drawn in the default orange; other ink colours get a flat vector print
    const rasterPaper = (ink ?? preset.ink).toLowerCase() === SEBOOTH_THEMES.royal.ink

    return (
        <div role="img" aria-label={label} className={`sb-loader sb-loader--block ${className}`} style={colors}>
            <svg viewBox={LOGO_VIEWBOX} className="sb-loader__svg" aria-hidden="true">
                <defs>
                    {rasterPaper && (
                        <pattern id={`${uid}-paper`} patternContentUnits="objectBoundingBox" width="1" height="1">
                            <image
                                href={PAPER_IMAGE.href}
                                width={PAPER_IMAGE.width}
                                height={PAPER_IMAGE.height}
                                transform={PAPER_IMAGE.transform}
                                preserveAspectRatio="none"
                            />
                        </pattern>
                    )}
                    {/* Only what is below the slot is visible, so the paper comes out of it */}
                    <clipPath id={`${uid}-mouth`}>
                        <rect x="380" y={SLOT.y + SLOT.height / 2} width="280" height="160" />
                    </clipPath>
                </defs>

                <path className="sb-loader__label" d={PHOTOBOOTH_LABEL} />

                <g clipPath={`url(#${uid}-mouth)`}>
                    <path
                        className="sb-loader__paper"
                        d={PAPER}
                        fill={rasterPaper ? `url(#${uid}-paper)` : '#ffffff'}
                        stroke={rasterPaper ? undefined : 'var(--sb-ink)'}
                        strokeWidth={rasterPaper ? undefined : 6}
                    />
                </g>
                <rect className="sb-loader__pop" style={{ animationDelay: `${STAGGER * 3}ms` }} {...SLOT} />

                <path className="sb-loader__pop" style={{ animationDelay: '0ms' }} d={LETTER_S} />
                <path className="sb-loader__pop" style={{ animationDelay: `${STAGGER}ms` }} d={LETTER_E} />
                <path className="sb-loader__pop" style={{ animationDelay: `${STAGGER * 2}ms` }} d={LETTER_B} />
                <Eye uid={`${uid}-l`} eye={EYE_LEFT} delay={STAGGER * 3} pop />
                <Eye uid={`${uid}-r`} eye={EYE_RIGHT} delay={STAGGER * 4} pop />
                <path className="sb-loader__pop" style={{ animationDelay: `${STAGGER * 5}ms` }} d={LETTER_T} />
                <path className="sb-loader__pop" style={{ animationDelay: `${STAGGER * 6}ms` }} d={LETTER_H} />
            </svg>
        </div>
    )
}
