import { AppConfig } from '@shared/types'

// Check if we are running inside the Electron window, or if we are a remote Chrome browser
export const isElectron = !!((window as any).api)

// If we are external/remote, we need to know the origin. In production/LAN, window.location.origin works perfectly.
// If accessing http://192.168.x.x:5050, then origin is exactly that!
const baseUrl = isElectron ? '' : window.location.origin

export const apiHelper = {
    async getConfig(): Promise<AppConfig | null> {
        try {
            if (isElectron) {
                const res = await (window as any).api.config.get()
                return res.success ? res.data : null
            } else {
                const res = await fetch(`${baseUrl}/api/config`)
                return await res.json()
            }
        } catch (error) {
            console.error('Failed to get config:', error)
            return null
        }
    },

    async updateConfig(updates: Partial<AppConfig>): Promise<AppConfig | null> {
        try {
            if (isElectron) {
                const res = await (window as any).api.config.update(updates)
                return res.success ? res.data : null
            } else {
                const res = await fetch(`${baseUrl}/api/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updates)
                })
                const json = await res.json()
                return json.success ? json.config : null
            }
        } catch (error) {
            console.error('Failed to update config:', error)
            return null
        }
    },

    onConfigUpdate(callback: (newConfig: AppConfig) => void): () => void {
        if (isElectron) {
            // Subscribe via Electron IPC
            return (window as any).api.config.onUpdate(callback)
        } else {
            // For Remote Browser, we could use WebSocket or Polling.
            // Since this is Phase 1, we use a simple short-polling loop just in case 
            // the config was changed by another user, though mostly the mobile user changes it themselves.
            const interval = setInterval(async () => {
                const cfg = await this.getConfig()
                if (cfg) callback(cfg)
            }, 3000)
            return () => clearInterval(interval)
        }
    },
    
    // Abstract Cloud Queue
    async getQueue(): Promise<any[]> {
        try {
            if (isElectron) {
                const res = await (window as any).api.cloud.getQueue()
                return res.success ? res.data : []
            } else {
                return []
            }
        } catch (e) {
            return []
        }
    },
    
    // Abstract Print Queue
    async getPrintQueue(): Promise<any[]> {
        try {
            if (isElectron) {
                const res = await (window as any).api.printer.getQueue()
                return res.success ? res.data : []
            } else {
                const res = await fetch(`${baseUrl}/api/print/queue`)
                return await res.json()
            }
        } catch (e) {
            return []
        }
    },

    // Abstract Print History
    async getPrintHistory(): Promise<any[]> {
        try {
            if (isElectron) {
                const res = await (window as any).api.printer.getHistory()
                return res.success ? res.data : []
            } else {
                const res = await fetch(`${baseUrl}/api/print/history`)
                return await res.json()
            }
        } catch (e) {
            return []
        }
    },

    // Save processed frame overlay (works in both Electron IPC and Remote Browser HTTP)
    async saveFrameOverlay(dataUrl: string, filename: string): Promise<string | null> {
        try {
            if (isElectron) {
                const res = await (window as any).api.system.saveFrameOverlay(dataUrl, filename)
                return res.success ? res.data : null
            } else {
                const res = await fetch(`${baseUrl}/api/frames/overlay`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dataUrl, filename })
                })
                const json = await res.json()
                return json.success ? json.filePath : null
            }
        } catch (e) {
            console.error('Failed to save frame overlay:', e)
            return null
        }
    }
}
