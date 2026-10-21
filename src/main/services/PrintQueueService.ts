import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { printerHandler } from '../handlers/PrinterHandler'

export interface PrintJob {
    id: string
    sessionId: string
    filePath: string
    printerName: string
    copies: number
    status: 'QUEUED' | 'PRINTING' | 'COMPLETED' | 'FAILED'
    createdAt: number
    completedAt?: number
    errorMessage?: string
    sourceDevice?: string // e.g. 'Booth A', 'Booth B' — identifies which device sent the job
    label?: string // pickup code shown at the counter, e.g. 'B2-037'
    pickedUpAt?: number // staff handed the strip to the customer
    reprintedAt?: number // a new job was queued for this one (so a failure counts as handled)
}

// Newest-first; a concert can run a few hundred sessions per booth, keep enough to find late pickups
const HISTORY_LIMIT = 2000

export class PrintQueueService {
    private queue: PrintJob[] = []
    private history: PrintJob[] = []
    private isProcessing: boolean = false
    /** Bumped on every queue/history change so HTTP pollers (/loket) only refetch the lists when needed */
    public version = 0
    private historyPath: string
    private queuePath: string

    constructor() {
        const userDataPath = app.getPath('userData')
        this.historyPath = path.join(userDataPath, 'sebooth_print_history.json')
        this.queuePath = path.join(userDataPath, 'sebooth_print_queue.json')
        this.loadHistory()
        this.loadQueue()
    }

    /** Restore jobs that were still waiting when the app closed or crashed. */
    private loadQueue() {
        try {
            if (!fs.existsSync(this.queuePath)) return
            const saved: PrintJob[] = JSON.parse(fs.readFileSync(this.queuePath, 'utf8')) || []
            for (const job of saved) {
                if (job.status === 'PRINTING') {
                    // It may or may not have reached the paper: let staff check and reprint instead of printing twice
                    job.status = 'FAILED'
                    job.completedAt = Date.now()
                    job.errorMessage = 'Terputus saat mencetak (aplikasi tertutup). Cek printer, cetak ulang bila perlu.'
                    this.history.unshift(job)
                } else {
                    this.queue.push(job)
                }
            }
            this.saveHistory()
            this.saveQueue()
            if (this.queue.length > 0) {
                console.log(`[PrintQueueService] Restored ${this.queue.length} queued job(s) from disk.`)
                setTimeout(() => { if (!this.isProcessing) this.processQueue() }, 3000)
            }
        } catch (e) {
            console.error('[PrintQueueService] Failed to load queue:', e)
        }
    }

    private saveQueue() {
        try {
            fs.writeFileSync(this.queuePath, JSON.stringify(this.queue), 'utf8')
        } catch (e) {
            console.error('[PrintQueueService] Failed to save queue:', e)
        }
    }

    private loadHistory() {
        try {
            if (fs.existsSync(this.historyPath)) {
                const data = fs.readFileSync(this.historyPath, 'utf8')
                this.history = JSON.parse(data)
                
                // History is newest-first: keep the newest items to prevent unbounded file growth
                if (this.history.length > HISTORY_LIMIT) {
                    this.history = this.history.slice(0, HISTORY_LIMIT)
                }
            }
        } catch (e) {
            console.error('[PrintQueueService] Failed to load history:', e)
        }
    }

    private saveHistory() {
        try {
            fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf8')
        } catch (e) {
            console.error('[PrintQueueService] Failed to save history:', e)
        }
    }

    /** Non-failed job already received for this session (used to drop duplicate remote sends). */
    public findActiveBySession(sessionId: string): PrintJob | undefined {
        return [...this.queue, ...this.history].find(j => j.sessionId === sessionId && j.status !== 'FAILED')
    }

    public addJob(sessionId: string, filePath: string, printerName: string, copies: number = 1, sourceDevice?: string, label?: string): PrintJob {
        const job: PrintJob = {
            id: `print_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            sessionId,
            filePath,
            printerName,
            copies,
            status: 'QUEUED',
            createdAt: Date.now(),
            sourceDevice: sourceDevice || 'Local',
            label
        }
        
        this.queue.push(job)
        this.saveQueue()
        console.log(`[PrintQueueService] Job ${job.id} added to queue.`)
        console.log(`[PrintQueueService] Queue length: ${this.queue.length}`)
        console.log(`[PrintQueueService] Job details:`, job)
        
        // Broadcast via WebContents
        this.broadcastState()

        // Kick off processing if idle
        if (!this.isProcessing) {
            this.processQueue()
        }

        return job
    }

    /** Queue a finished or failed job again (same file, copies and pickup code). */
    public reprint(jobId: string): PrintJob | undefined {
        const job = this.history.find(j => j.id === jobId)
        if (!job) return undefined
        job.reprintedAt = Date.now()
        this.saveHistory()
        return this.addJob(job.sessionId, job.filePath, job.printerName, job.copies, job.sourceDevice, job.label)
    }

    /** Reprint every failed job nobody has handled yet (e.g. after refilling paper). */
    public reprintFailed(): PrintJob[] {
        return this.history
            .filter(j => j.status === 'FAILED' && !j.reprintedAt && !j.pickedUpAt)
            .reverse() // oldest first, so customers who waited longest get theirs first
            .map(j => this.reprint(j.id)!)
    }

    public setPickedUp(jobId: string, pickedUp: boolean): PrintJob | undefined {
        const job = this.history.find(j => j.id === jobId)
        if (!job) return undefined
        job.pickedUpAt = pickedUp ? Date.now() : undefined
        this.saveHistory()
        this.broadcastState()
        return job
    }

    public findJob(jobId: string): PrintJob | undefined {
        return this.queue.find(j => j.id === jobId) || this.history.find(j => j.id === jobId)
    }

    public getQueue(): PrintJob[] {
        return [...this.queue]
    }

    public getHistory(): PrintJob[] {
        return [...this.history]
    }

    private broadcastState() {
        this.version++
        try {
            const windows = require('electron').BrowserWindow.getAllWindows()
            for (const win of windows) {
                win.webContents.send('printer:queue-updated', this.queue)
                win.webContents.send('printer:history-updated', this.history)
            }
        } catch (e) {
            // Ignore if invoked outside proper context
        }
    }

    private async processQueue() {
        if (this.queue.length === 0) {
            console.log('[PrintQueueService] Queue is empty, stopping processing')
            this.isProcessing = false
            return
        }

        this.isProcessing = true
        const job = this.queue[0] // take the first
        job.status = 'PRINTING'
        this.saveQueue()
        this.broadcastState()

        console.log(`[PrintQueueService] Processing job ${job.id}...`)
        console.log(`[PrintQueueService] Job details:`, job)

        try {
            const result = await printerHandler.print(job.filePath, job.printerName, job.copies)
            
            console.log(`[PrintQueueService] Print result for job ${job.id}:`, result)
            
            job.completedAt = Date.now()
            if (result.success) {
                job.status = 'COMPLETED'
            } else {
                job.status = 'FAILED'
                job.errorMessage = result.error
            }
        } catch (err: any) {
            console.log(`[PrintQueueService] Exception during print job ${job.id}:`, err)
            job.status = 'FAILED'
            job.completedAt = Date.now()
            job.errorMessage = err.message
        }

        console.log(`[PrintQueueService] Job ${job.id} finished with status: ${job.status}`)

        // Move to history
        this.queue.shift() // remove from queue
        this.history.unshift(job) // add to front of history
        this.saveQueue()
        
        // Enforce limit
        if (this.history.length > HISTORY_LIMIT) {
            this.history = this.history.slice(0, HISTORY_LIMIT)
        }
        this.saveHistory()
        this.broadcastState()

        // Give Spooler a tiny 1s breath, then process next
        setTimeout(() => {
            this.processQueue()
        }, 1000)
    }
}

export const printQueueService = new PrintQueueService()
