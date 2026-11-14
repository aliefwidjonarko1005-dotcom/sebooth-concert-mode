import { GUARD_ENABLED } from '@shared/guardPins'

// Tiny shared flag read by the IPC gate and the LAN server. Kept free of heavy imports because
// gate.ts loads it before any IPC handler is registered.
// Fails closed: with the guard enabled, everything is locked until the guard has read its state.
let locked = GUARD_ENABLED

export const isGuardLocked = (): boolean => locked
export const setGuardLocked = (value: boolean): void => { locked = value }

// Completed sessions today, for the owner's live status (counted from system:finalize-session calls).
let sessionDay = ''
let sessionCount = 0
export function noteIpc(channel: string): void {
    if (channel !== 'system:finalize-session') return
    const today = new Date().toDateString()
    if (today !== sessionDay) { sessionDay = today; sessionCount = 0 }
    sessionCount++
}
export const sessionsToday = (): number => (sessionDay === new Date().toDateString() ? sessionCount : 0)
