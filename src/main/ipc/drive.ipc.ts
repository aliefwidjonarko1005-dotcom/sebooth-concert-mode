import { IpcMain } from 'electron'
import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import url from 'url'
import { app } from 'electron'

// dotenv is loaded centrally in lib/env.ts (imported first by index.ts)

const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || ''

interface UploadSessionParams {
    sessionId: string
    files: {
        path: string
        filename: string
        mimeType: string
    }[]
}

export function registerDriveHandlers(ipcMain: IpcMain): void {
    ipcMain.handle('drive:upload-session', async (_event, params: UploadSessionParams) => {
        try {
            if (!GOOGLE_DRIVE_FOLDER_ID) {
                return { success: false, error: 'GOOGLE_DRIVE_FOLDER_ID is not configured in .env' }
            }

            // Look for credentials.json in the app directory root
            const credentialsPath = app.isPackaged
                ? path.join(process.resourcesPath, 'credentials.json')
                : path.join(app.getAppPath(), 'credentials.json')

            if (!fs.existsSync(credentialsPath)) {
                return { success: false, error: `credentials.json not found at ${credentialsPath}` }
            }

            // Authenticate using the service account credentials
            const auth = new google.auth.GoogleAuth({
                keyFile: credentialsPath,
                scopes: ['https://www.googleapis.com/auth/drive.file']
            })

            const drive = google.drive({ version: 'v3', auth })

            // 1. Create a subfolder for this session inside the main folder
            const folderMetadata = {
                name: `Session_${params.sessionId}`,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [GOOGLE_DRIVE_FOLDER_ID]
            }

            console.log(`Creating Drive folder: ${folderMetadata.name}...`)
            const folderRes = await drive.files.create({
                requestBody: folderMetadata,
                fields: 'id, webViewLink',
                supportsAllDrives: true
            })

            const sessionFolderId = folderRes.data.id
            const folderUrl = folderRes.data.webViewLink

            if (!sessionFolderId) {
                return { success: false, error: 'Failed to create session folder in Google Drive' }
            }

            // 2. Grant "Anyone with the link can view" permission to the newly created folder
            console.log(`Setting permissions for folder ${sessionFolderId}...`)
            try {
                await drive.permissions.create({
                    fileId: sessionFolderId,
                    requestBody: {
                        role: 'reader',
                        type: 'anyone'
                    },
                    supportsAllDrives: true
                })
            } catch (permError) {
                console.warn('Failed to set public viewing permission. This might be restricted by your Google Workspace organization settings. Uploading will continue.', permError)
            }

            // 3. Upload all files parallelly to the new folder
            console.log(`Uploading ${params.files.length} files to folder ${sessionFolderId}...`)

            const uploadPromises = params.files.map(async (file) => {
                // Normalize path to handle "file://C:/..." format from the frontend
                let filePath = file.path
                if (filePath.startsWith('file:///')) {
                    try {
                        filePath = url.fileURLToPath(filePath)
                    } catch (e) {
                        // Fallback manually stripping if URL parsing fails
                        filePath = filePath.replace('file:///', '')
                        if (process.platform !== 'win32') {
                            filePath = '/' + filePath
                        }
                    }
                }

                if (!fs.existsSync(filePath)) {
                    console.warn(`File not found for upload: ${filePath} (original: ${file.path})`)
                    return null
                }

                const fileMetadata = {
                    name: file.filename,
                    parents: [sessionFolderId]
                }
                const media = {
                    mimeType: file.mimeType,
                    body: fs.createReadStream(filePath)
                }

                const uploadRes = await drive.files.create({
                    requestBody: fileMetadata,
                    media: media,
                    fields: 'id, webViewLink',
                    supportsAllDrives: true
                })
                return { filename: file.filename, url: uploadRes.data.webViewLink, id: uploadRes.data.id }
            })

            const uploadedFiles = await Promise.all(uploadPromises)
            console.log('Successfully uploaded all files to Google Drive:', folderUrl)

            return {
                success: true,
                folderUrl,
                folderId: sessionFolderId,
                files: uploadedFiles.filter(Boolean)
            }
        } catch (error) {
            console.error('Google Drive Upload Error:', error)
            return { success: false, error: (error as Error).message }
        }
    })
}
