import { useEffect, useRef } from 'react'

/**
 * Tiny bus from pages to the optional MascotAssistant: pages report what the customer just did
 * (swiped, picked a filter, the shutter fired...), the assistant reacts and moves its guidance on.
 * When the assistant is off nobody listens, so emitting is free and changes nothing.
 */

export type MascotAction =
    | 'swipe'      // a carousel moved (data.dir = 'next' | 'prev')
    | 'focus'      // a side card was tapped into the centre
    | 'filter'     // filter changed (data.name)
    | 'mirror'     // mirror toggled (data.on = 'on' | 'off')
    | 'media'      // Output: another medium is in the centre (data.title)
    | 'countdown'  // capture countdown started
    | 'shot'       // a photo was taken

export const MASCOT_EVENT = 'sebooth:mascot'

export interface MascotEventDetail {
    type: MascotAction
    data?: Record<string, string>
}

export function emitMascot(type: MascotAction, data?: Record<string, string>): void {
    window.dispatchEvent(new CustomEvent<MascotEventDetail>(MASCOT_EVENT, { detail: { type, data } }))
}

/** Emit when `value` changes after mount (not for the initial value). */
export function useEmitOnChange(value: unknown, emit: () => void): void {
    const first = useRef(true)
    useEffect(() => {
        if (first.current) {
            first.current = false
            return
        }
        emit()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])
}
