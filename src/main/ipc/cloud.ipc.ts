import { ipcMain } from 'electron';
import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';
import { uploadQueue } from '../services/UploadQueue';
import { getGCSKeyPath } from '../lib/paths';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, GCS_BUCKET_NAME } from '@shared/supabaseConfig';

// dotenv is loaded centrally in lib/env.ts (imported first by index.ts)

// GCS Key Configuration — production-safe path resolution
const keyPath = getGCSKeyPath();

let storage: Storage | null = null;

try {
  if (keyPath && fs.existsSync(keyPath)) {
    storage = new Storage({ keyFilename: keyPath });
    console.log(`[Cloud Storage] Initialized successfully with: ${path.basename(keyPath)}`);
  } else {
    console.warn(`[Cloud Storage] Missing Google Cloud key. Cloud upload will be disabled.`);
    console.warn('[Cloud Storage] Place gcs-key.json in resources/ or set GCS_KEY_PATH in .env.');
  }
} catch (error) {
  console.error('[Cloud Storage] Failed to initialize:', error);
}


const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

export function isCloudUploadReady(): boolean {
  return storage !== null;
}

// Background worker: drains the persisted queue in order (files before the DB rows that reference them).
let isDraining = false;
async function drainQueue(): Promise<void> {
  if (isDraining) return;
  const pending = uploadQueue.getPendingQueue();
  if (pending.length === 0) return;
  isDraining = true;

  try {
    for (const item of pending) {
      if (item.kind === 'db') {
        const { error } = await supabase.from(item.table!).upsert(item.row!, item.onConflict ? { onConflict: item.onConflict } : undefined);
        if (!error) {
          uploadQueue.markSuccessful(item.id);
          continue;
        }
        // shortcut: an error with a Postgres code means the server answered (bad row), so drop it instead of blocking the queue forever
        if (error.code) {
          console.error(`[Cloud Queue] Dropping DB row for ${item.table}:`, error.message);
          uploadQueue.markSuccessful(item.id);
          continue;
        }
        uploadQueue.incrementRetry(item.id);
        break; // offline: keep order, try again next tick
      }

      if (!storage) break;
      if (!fs.existsSync(item.filePath)) {
        console.warn(`[Cloud Queue] Queue item file missing, removing from queue: ${item.filePath}`);
        uploadQueue.markSuccessful(item.id);
        continue;
      }
      try {
        await storage.bucket(item.bucketName).upload(item.filePath, {
          destination: item.destinationPath,
          metadata: {
            contentType: item.mimeType,
            cacheControl: 'public, max-age=31536000'
          }
        });
        console.log(`[Cloud Queue] Uploaded: ${item.destinationPath}`);
        uploadQueue.markSuccessful(item.id);
      } catch (error) {
        console.error(`[Cloud Queue] Upload failed for ${item.destinationPath}, will retry`);
        uploadQueue.incrementRetry(item.id);
        break;
      }
    }
  } finally {
    isDraining = false;
  }
}

setInterval(() => { drainQueue().catch(e => console.error('[Cloud Queue] Drain error:', e)) }, 10000);

/** Queue a finished session's media + Supabase rows. Never touches the network itself. */
export function enqueueSessionUpload(params: {
  sessionId: string;
  eventName: string;
  frameName: string;
  files: { path: string; destName: string; mimeType: string; type: 'photo' | 'gif' | 'live'; isStrip?: boolean }[];
}): void {
  const { sessionId } = params;
  uploadQueue.enqueueRow('sessions', {
    id: sessionId,
    event_name: params.eventName,
    frame_name: params.frameName,
    is_claimed: false,
    created_at: new Date().toISOString()
  }, 'id');

  for (const f of params.files) {
    const destinationPath = `${sessionId}/${f.destName}`;
    uploadQueue.enqueue({ bucketName: GCS_BUCKET_NAME, destinationPath, filePath: f.path, mimeType: f.mimeType });
    uploadQueue.enqueueRow('media', {
      session_id: sessionId,
      type: f.type,
      url: `https://storage.googleapis.com/${GCS_BUCKET_NAME}/${destinationPath}`,
      metadata: f.isStrip ? { is_strip: true } : {}
    });
  }
  drainQueue().catch(e => console.error('[Cloud Queue] Drain error:', e));
}

export function registerCloudHandlers(): void {
  ipcMain.handle('cloud:upload-file', async (_, params: {
    bucketName: string;
    destinationPath: string; // e.g. sessionId/photo.png
    filePath?: string;
    base64Data?: string;
    mimeType: string;
  }) => {
    if (!storage) {
       return { success: false, error: 'Google Cloud API Key not found' };
    }
    
    // Generate Public URL (assuming the bucket has public read access)
    // We return this immediately so UI doesn't block if we must fallback to queue
    const publicUrl = `https://storage.googleapis.com/${params.bucketName}/${params.destinationPath}`;

    try {
      const bucket = storage.bucket(params.bucketName);
      const file = bucket.file(params.destinationPath);

      if (params.filePath) {
        if (!fs.existsSync(params.filePath)) {
           return { success: false, error: `File not found locally: ${params.filePath}` };
        }
        await bucket.upload(params.filePath, {
          destination: params.destinationPath,
          metadata: { 
              contentType: params.mimeType,
              cacheControl: 'public, max-age=31536000' // Phase 2: Cache Control Header
          }
        });
      } else if (params.base64Data) {
        const base64Content = params.base64Data.replace(/^data:([A-Za-z-+/]+);base64,/, '');
        const buffer = Buffer.from(base64Content, 'base64');
        await file.save(buffer, {
          metadata: { 
              contentType: params.mimeType,
              cacheControl: 'public, max-age=31536000' // Phase 2: Cache Control Header
          },
          resumable: false
        });
      } else {
        return { success: false, error: 'No data provided for upload (need filePath or base64Data)' };
      }

      return { success: true, url: publicUrl, status: 'uploaded' };

    } catch (error: any) {
      console.warn('[Cloud Storage] Upload failed, pushing to offline queue:', error.message);
      
      uploadQueue.enqueue({
        bucketName: params.bucketName,
        destinationPath: params.destinationPath,
        filePath: params.filePath || '',
        mimeType: params.mimeType
      }, params.base64Data);

      // Return success with 'queued' status so frontend proceeds to generate QR anyway
      return { success: true, url: publicUrl, status: 'queued', message: 'Saved offline, will sync when internet returns.' };
    }
  });

  ipcMain.handle('cloud:get-queue', () => {
    return { success: true, data: uploadQueue.getPendingQueue() };
  });
}
