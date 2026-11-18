// MUST be first import — loads .env before any module reads process.env
import './lib/env'
// MUST come before anything that registers IPC (ConfigService does so on import): wraps ipcMain.handle
import './guard/gate'

import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerCameraHandlers } from './ipc/camera.ipc'
import { registerPrinterHandlers } from './ipc/printer.ipc'
import { registerSystemHandlers } from './ipc/system.ipc'
import { registerImageHandlers } from './ipc/image.ipc'
import { registerEmailHandlers } from './ipc/email.ipc'
import { registerDriveHandlers } from './ipc/drive.ipc'
import { registerCloudHandlers } from './ipc/cloud.ipc'
import { registerQueueHandlers } from './ipc/queue.ipc'
import { registerPaymentHandlers } from './ipc/payment.ipc'
import './services/ConfigService' // Boot ConfigService natively
import { initGuard, onGuardChange, startGuardLoop } from './guard/client'

// Global safeguard to prevent Photobooth crash on USB/Hardware random disconnects
process.on('uncaughtException', (error) => {
    console.error('[System Fault] Prevented crash from uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[System Fault] Prevented crash from unhandled rejection. Reason:', reason);
});

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        autoHideMenuBar: true,
        fullscreen: false,
        frame: true,
        resizable: true,
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false // Allow loading local file:// images
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show()
    })

    // Forward renderer console logs to the main process terminal for easier debugging
    mainWindow.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
        const levels: Record<string, string> = { debug: 'DEBUG', info: 'INFO', warning: 'WARN', error: 'ERROR' };
        const file = sourceId.split('/').pop()?.split('\\').pop() || sourceId;
        console.log(`[Renderer ${levels[level] || 'LOG'}] (${file}:${lineNumber}) ${message}`);
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // Load the renderer
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

// App lifecycle
app.whenReady().then(async () => {
    // Booth Guard first: the IPC gate must know the lock state before the renderer makes its first call.
    await initGuard()
    // Lock or unlock: reload so every page (and any open camera stream) restarts under the new state.
    let lastLocked: boolean | null = null
    onGuardChange((view) => {
        const flipped = lastLocked !== null && lastLocked !== view.locked
        lastLocked = view.locked
        for (const win of BrowserWindow.getAllWindows()) {
            if (flipped) win.webContents.reload()
            else win.webContents.send('guard:state', view)
        }
    })

    // Set app user model id for windows
    electronApp.setAppUserModelId('com.sebooth.app')

    // Watch for shortcuts in development
    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    // Register all IPC handlers
    registerCameraHandlers(ipcMain)
    registerPrinterHandlers(ipcMain)
    registerSystemHandlers(ipcMain)
    registerImageHandlers(ipcMain)
    registerEmailHandlers(ipcMain)
    registerDriveHandlers(ipcMain)
    registerCloudHandlers()
    registerQueueHandlers()
    registerPaymentHandlers(ipcMain)
    
    // Auto-sweep old heavy media off SSD
    import('./services/Janitor').then(({ janitor }) => janitor.runCleanup())

    // Launch background sharing web server (port 5050)
    import('./server').then(({ startLocalServer }) => {
        startLocalServer(5050)
    }).catch(err => console.error('Failed to start local sharing server:', err))

    createWindow()
    startGuardLoop()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// Handle fullscreen toggle
ipcMain.handle('window:toggle-fullscreen', () => {
    if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen())
        return mainWindow.isFullScreen()
    }
    return false
})

ipcMain.handle('window:toggle-kiosk', () => {
    if (mainWindow) {
        mainWindow.setKiosk(!mainWindow.isKiosk())
        return mainWindow.isKiosk()
    }
    return false
})
