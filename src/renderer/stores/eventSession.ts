import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ================================
// Event Session Store
// ================================
// Tracks a timed "event" (e.g. 1-hour unlimited photo booth session).
// While an event is active, every completed photo session, print job,
// and frame usage is recorded. The event can end manually or auto-end
// after the configured duration.

export interface FrameUsageRecord {
    frameId: string
    frameName: string
    count: number
}

export interface EventSessionData {
    id: string
    /** Human-readable event/client name */
    eventName: string
    /** Epoch ms when the event started */
    startedAt: number
    /** Epoch ms when the event ended (null if still running) */
    endedAt: number | null
    /** Duration in minutes (0 = manual-only, no auto-end) */
    durationMinutes: number
    /** Number of completed photo sessions (capture cycles) */
    totalSessions: number
    /** Number of printed strips */
    totalPrints: number
    /** Frame usage breakdown */
    frameUsage: FrameUsageRecord[]
}

interface EventSessionState {
    /** Currently active event session (null if no event running) */
    activeEvent: EventSessionData | null
    /** Historical completed events */
    eventHistory: EventSessionData[]

    // Actions
    startEvent: (name: string, durationMinutes: number) => void
    endEvent: () => void
    extendEvent: (additionalMinutes: number) => void
    updateActiveEventName: (name: string) => void
    deleteHistoryItem: (id: string) => void
    /** Called when a photo session completes (all photos captured + composite created) */
    recordSession: (frameId: string, frameName: string) => void
    /** Called when a print job is sent */
    recordPrint: (quantity: number) => void
    /** Clear all history */
    clearHistory: () => void
}

export const useEventSessionStore = create<EventSessionState>()(
    persist(
        (set, get) => ({
            activeEvent: null,
            eventHistory: [],

            startEvent: (name, durationMinutes) => {
                // End any existing event first
                const { activeEvent, eventHistory } = get()
                let history = eventHistory
                if (activeEvent) {
                    history = [{ ...activeEvent, endedAt: Date.now() }, ...eventHistory]
                }
                set({
                    activeEvent: {
                        id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        eventName: name.trim() || 'Sesi Bebas Foto',
                        startedAt: Date.now(),
                        endedAt: null,
                        durationMinutes,
                        totalSessions: 0,
                        totalPrints: 0,
                        frameUsage: []
                    },
                    eventHistory: history
                })
            },

            endEvent: () => {
                const { activeEvent, eventHistory } = get()
                if (!activeEvent) return
                set({
                    activeEvent: null,
                    eventHistory: [{ ...activeEvent, endedAt: Date.now() }, ...eventHistory]
                })
            },

            extendEvent: (additionalMinutes: number) => {
                set((state) => {
                    if (!state.activeEvent) return state
                    return {
                        activeEvent: {
                            ...state.activeEvent,
                            durationMinutes: Math.max(0, state.activeEvent.durationMinutes + additionalMinutes)
                        }
                    }
                })
            },

            updateActiveEventName: (name: string) => {
                set((state) => {
                    if (!state.activeEvent) return state
                    return {
                        activeEvent: {
                            ...state.activeEvent,
                            eventName: name.trim() || state.activeEvent.eventName
                        }
                    }
                })
            },

            deleteHistoryItem: (id: string) => {
                set((state) => ({
                    eventHistory: state.eventHistory.filter(item => item.id !== id)
                }))
            },

            recordSession: (frameId, frameName) => {
                set((state) => {
                    if (!state.activeEvent) return state
                    const usage = [...state.activeEvent.frameUsage]
                    const existing = usage.find(f => f.frameId === frameId)
                    if (existing) {
                        existing.count += 1
                    } else {
                        usage.push({ frameId, frameName, count: 1 })
                    }
                    return {
                        activeEvent: {
                            ...state.activeEvent,
                            totalSessions: state.activeEvent.totalSessions + 1,
                            frameUsage: usage
                        }
                    }
                })
            },

            recordPrint: (quantity) => {
                set((state) => {
                    if (!state.activeEvent) return state
                    return {
                        activeEvent: {
                            ...state.activeEvent,
                            totalPrints: state.activeEvent.totalPrints + quantity
                        }
                    }
                })
            },

            clearHistory: () => set({ eventHistory: [] })
        }),
        {
            name: 'sebooth-event-sessions',
            // Persist everything so event data survives app restarts
        }
    )
)
