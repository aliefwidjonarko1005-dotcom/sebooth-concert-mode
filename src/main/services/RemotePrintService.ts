import http from 'http'
import https from 'https'
import { URL } from 'url'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export interface RemotePrintRequest {
    imageData: string      // base64 data URL
    copies: number
    sessionId: string
    deviceName: string
    label?: string
}

export interface RemotePrintResponse {
    success: boolean
    jobId?: string
    error?: string
    queued?: boolean // server unreachable: saved to disk, resent in the background
}

export interface PrintServerStatus {
    online: boolean
    printerName?: string
    printerConnected?: boolean
    queueLength?: number
    error?: string
}

/**
 * RemotePrintService — Sends print jobs to a remote Sebooth Print Server over LAN.
 * Used by Device B (Print Client) to print on Device A's (Print Server) physically connected printer.
 */
export class RemotePrintService {
    private serverUrl: string = ''

    public setServerUrl(url: string): void {
        // Normalize: remove trailing slash
        this.serverUrl = url.replace(/\/+$/, '')
    }

    /**
     * Send a print job to the remote print server
     */
    public async sendPrintJob(request: RemotePrintRequest): Promise<RemotePrintResponse> {
        if (!this.serverUrl) {
            return { success: false, error: 'Print Server URL not configured' }
        }

        const endpoint = `${this.serverUrl}/api/remote-print`
        console.log(`[RemotePrintService] Sending print job to ${endpoint}`)
        console.log(`[RemotePrintService] Session: ${request.sessionId}, Device: ${request.deviceName}, Copies: ${request.copies}`)

        try {
            const result = await this.httpPost(endpoint, request)
            console.log(`[RemotePrintService] Response:`, result)
            return result
        } catch (err: any) {
            console.error(`[RemotePrintService] Failed to send print job:`, err)

            // Retry once after 1 second
            console.log(`[RemotePrintService] Retrying in 1 second...`)
            await new Promise(resolve => setTimeout(resolve, 1000))

            try {
                const retryResult = await this.httpPost(endpoint, request)
                console.log(`[RemotePrintService] Retry response:`, retryResult)
                return retryResult
            } catch (retryErr: any) {
                console.error(`[RemotePrintService] Retry also failed:`, retryErr)
                return {
                    success: false,
                    error: `Gagal mengirim ke Print Server: ${retryErr.message || 'Connection failed'}`
                }
            }
        }
    }

    private pendingDir(): string {
        const dir = path.join(app.getPath('userData'), 'pending_prints')
        fs.mkdirSync(dir, { recursive: true })
        return dir
    }

    /**
     * Send once; if the server can't be reached, persist the job and let flushPending() resend it.
     * The server drops duplicates by sessionId, so resending is safe.
     */
    public async sendOrQueue(request: RemotePrintRequest): Promise<RemotePrintResponse> {
        try {
            const result = await this.httpPost(`${this.serverUrl}/api/remote-print`, request, 15000)
            if (result?.success) return result
            console.warn(`[RemotePrintService] Server rejected job, queueing:`, result?.error)
        } catch (err: any) {
            console.warn(`[RemotePrintService] Print server unreachable, queueing job ${request.sessionId}:`, err.message)
        }
        try {
            fs.writeFileSync(path.join(this.pendingDir(), `${request.sessionId}.json`), JSON.stringify(request))
            return { success: true, queued: true }
        } catch (e: any) {
            return { success: false, error: `Gagal menyimpan antrean cetak: ${e.message}` }
        }
    }

    private isFlushing = false

    /** Resend persisted jobs in arrival order. Stops at the first failure (server still down). */
    public async flushPending(): Promise<void> {
        if (this.isFlushing || !this.serverUrl) return
        this.isFlushing = true
        try {
            const dir = this.pendingDir()
            const files = fs.readdirSync(dir)
                .filter(f => f.endsWith('.json'))
                .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
                .sort((a, b) => a.t - b.t)
            for (const { f } of files) {
                const full = path.join(dir, f)
                const request = JSON.parse(fs.readFileSync(full, 'utf8')) as RemotePrintRequest
                try {
                    const result = await this.httpPost(`${this.serverUrl}/api/remote-print`, request, 15000)
                    if (!result?.success) break
                    fs.unlinkSync(full)
                    console.log(`[RemotePrintService] Delivered queued job ${request.sessionId}`)
                } catch {
                    break
                }
            }
        } catch (e) {
            console.error('[RemotePrintService] flushPending error:', e)
        } finally {
            this.isFlushing = false
        }
    }

    /** Tell the print server this booth is alive and how many prints are still waiting here. Best effort. */
    public async sendHeartbeat(deviceName: string, boothCode?: string): Promise<void> {
        if (!this.serverUrl) return
        try {
            await this.httpPost(`${this.serverUrl}/api/print/heartbeat`, { deviceName, boothCode, pending: this.pendingCount() }, 5000)
        } catch {
            // server offline: the loket will show this booth as not seen recently
        }
    }

    public pendingCount(): number {
        try {
            return fs.readdirSync(this.pendingDir()).filter(f => f.endsWith('.json')).length
        } catch {
            return 0
        }
    }

    /**
     * Check if the remote print server is online and ready
     */
    public async checkServerStatus(): Promise<PrintServerStatus> {
        if (!this.serverUrl) {
            return { online: false, error: 'Print Server URL not configured' }
        }

        const endpoint = `${this.serverUrl}/api/remote-print/status`
        console.log(`[RemotePrintService] Checking print server status at ${endpoint}`)

        try {
            const result = await this.httpGet(endpoint, 5000) // 5s timeout for health check
            return result
        } catch (err: any) {
            console.error(`[RemotePrintService] Health check failed:`, err)
            return {
                online: false,
                error: `Tidak dapat terhubung ke Print Server: ${err.message || 'Connection refused'}`
            }
        }
    }

    /**
     * HTTP POST helper using native Node.js http/https
     */
    private httpPost(url: string, body: any, timeoutMs: number = 30000): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                const parsed = new URL(url)
                const isHttps = parsed.protocol === 'https:'
                const transport = isHttps ? https : http

                const postData = JSON.stringify(body)

                const options = {
                    hostname: parsed.hostname,
                    port: parsed.port || (isHttps ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    },
                    timeout: timeoutMs
                }

                const req = transport.request(options, (res) => {
                    let data = ''
                    res.on('data', (chunk) => { data += chunk })
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data)
                            resolve(json)
                        } catch {
                            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`))
                        }
                    })
                })

                req.on('error', (err) => reject(err))
                req.on('timeout', () => {
                    req.destroy()
                    reject(new Error('Request timed out'))
                })

                req.write(postData)
                req.end()
            } catch (err) {
                reject(err)
            }
        })
    }

    /**
     * HTTP GET helper
     */
    private httpGet(url: string, timeoutMs: number = 10000): Promise<any> {
        return new Promise((resolve, reject) => {
            try {
                const parsed = new URL(url)
                const isHttps = parsed.protocol === 'https:'
                const transport = isHttps ? https : http

                const options = {
                    hostname: parsed.hostname,
                    port: parsed.port || (isHttps ? 443 : 80),
                    path: parsed.pathname + parsed.search,
                    method: 'GET',
                    timeout: timeoutMs
                }

                const req = transport.request(options, (res) => {
                    let data = ''
                    res.on('data', (chunk) => { data += chunk })
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data)
                            resolve(json)
                        } catch {
                            reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`))
                        }
                    })
                })

                req.on('error', (err) => reject(err))
                req.on('timeout', () => {
                    req.destroy()
                    reject(new Error('Request timed out'))
                })

                req.end()
            } catch (err) {
                reject(err)
            }
        })
    }
}

// Singleton
export const remotePrintService = new RemotePrintService()
