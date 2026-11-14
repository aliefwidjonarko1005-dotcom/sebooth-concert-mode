import { ipcMain } from 'electron'
import { isGuardLocked, noteIpc } from './runtime'

// Must be imported before anything registers an IPC handler (src/main/index.ts, right after ./lib/env):
// ConfigService registers config:* as soon as it is imported.
// While the booth is locked every handler except these answers { success: false, error: 'LOCKED' },
// so a patched or devtools-driven renderer still cannot reach the camera, printer, uploads or payments.
const ALLOWED_WHILE_LOCKED = /^(guard:|window:|config:get$)/

const rawHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = ((channel: string, listener: (...args: any[]) => unknown) =>
    rawHandle(channel, (event, ...args) => {
        if (isGuardLocked() && !ALLOWED_WHILE_LOCKED.test(channel)) return { success: false, error: 'LOCKED' }
        noteIpc(channel)
        return listener(event, ...args)
    })) as typeof ipcMain.handle
