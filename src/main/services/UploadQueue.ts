import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';

export interface QueuedUpload {
  id: string;
  // 'db' items are Supabase rows, processed in order after the files queued before them
  kind?: 'file' | 'db';
  table?: string;
  row?: Record<string, unknown>;
  onConflict?: string;
  bucketName: string;
  destinationPath: string;
  filePath: string;
  mimeType: string;
  addedAt: number;
  retries: number;
}

export class UploadQueueService {
  private queueFilePath: string;
  private queue: QueuedUpload[] = [];

  constructor() {
    const userDataPath = app.getPath('userData');
    this.queueFilePath = path.join(userDataPath, 'upload_queue.json');
    this.loadQueue();
  }

  private loadQueue() {
    try {
        if (fs.existsSync(this.queueFilePath)) {
            const data = fs.readFileSync(this.queueFilePath, 'utf-8');
            this.queue = JSON.parse(data) || [];
        } else {
            this.queue = [];
        }
    } catch (e) {
        console.error('[UploadQueue] Failed to load offline queue:', e);
        this.queue = [];
    }
  }

  private saveQueue() {
    try {
        fs.writeFileSync(this.queueFilePath, JSON.stringify(this.queue, null, 2));
    } catch (e) {
        console.error('[UploadQueue] Failed to save offline queue:', e);
    }
  }

  public enqueue(item: Omit<QueuedUpload, 'id' | 'addedAt' | 'retries'>, base64Data?: string): void {
      let finalFilePath = item.filePath;

      // If we only have base64 data, save it to a temporary offline file first to avoid bloated JSON
      if (base64Data && !finalFilePath) {
          const sessionsDir = path.join(app.getPath('documents'), 'Sebooth', 'OfflineCache');
          if (!fs.existsSync(sessionsDir)) {
              fs.mkdirSync(sessionsDir, { recursive: true });
          }
          finalFilePath = path.join(sessionsDir, `offline_${crypto.randomUUID()}.tmp`);
          const pureBase64 = base64Data.replace(/^data:([A-Za-z-+/]+);base64,/, '');
          fs.writeFileSync(finalFilePath, pureBase64, 'base64');
      }

      if (!finalFilePath) return;

      const uploadItem: QueuedUpload = {
          id: crypto.randomUUID(),
          bucketName: item.bucketName,
          destinationPath: item.destinationPath,
          filePath: finalFilePath,
          mimeType: item.mimeType,
          addedAt: Date.now(),
          retries: 0
      };

      this.queue.push(uploadItem);
      this.saveQueue();
      console.log(`[UploadQueue] Enqueued offline item: ${uploadItem.destinationPath}. Total pending: ${this.queue.length}`);
  }

  public enqueueRow(table: string, row: Record<string, unknown>, onConflict?: string): void {
      this.queue.push({
          id: crypto.randomUUID(),
          kind: 'db',
          table,
          row,
          onConflict,
          bucketName: '',
          destinationPath: `${table}`,
          filePath: '',
          mimeType: '',
          addedAt: Date.now(),
          retries: 0
      });
      this.saveQueue();
  }

  public getPendingQueue(): QueuedUpload[] {
      return [...this.queue];
  }

  public markSuccessful(id: string): void {
      // Find and remove if successful
      const idx = this.queue.findIndex(q => q.id === id);
      if (idx !== -1) {
          const item = this.queue[idx];
          this.queue.splice(idx, 1);
          this.saveQueue();

          // Cleanup temp file if it was generated purely for offline cache
          if (item.filePath && item.filePath.includes('OfflineCache') && fs.existsSync(item.filePath)) {
              fs.unlinkSync(item.filePath);
          }
          console.log(`[UploadQueue] Successfully removed ${id} from queue.`);
      }
  }

  public incrementRetry(id: string): void {
      const idx = this.queue.findIndex(q => q.id === id);
      if (idx !== -1) {
          this.queue[idx].retries += 1;
          this.saveQueue();
      }
  }
}

export const uploadQueue = new UploadQueueService();
