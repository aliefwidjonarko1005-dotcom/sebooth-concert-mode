import { PrinterDevice, PrintResult } from '@shared/types'
import { BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { PDFDocument, degrees } from 'pdf-lib'
import { exec } from 'child_process'
import { promisify } from 'util'

// Printer drivers (e.g. DNP status monitor) can still pop a window: give the keyboard back to the kiosk
function refocusKiosk(): void {
    try {
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
        if (!win) return
        if (win.isMinimized()) win.restore()
        // Windows blocks plain focus() from a background app; a brief always-on-top lets it take the foreground
        win.setAlwaysOnTop(true)
        win.show()
        win.focus()
        win.webContents.focus()
        setTimeout(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(false) }, 300)
    } catch (e) {
        console.warn('[PrinterHandler] Could not refocus the kiosk window:', (e as Error).message)
    }
}

const execAsync = promisify(exec)

/**
 * PrinterHandler - Manages silent printing operations
 * Generates verification PDFs and uses native Windows System.Drawing for absolute compatibility with dye-sub printers
 */
export class PrinterHandler {
    constructor() { }

    /**
     * Get list of available printers
     */
    async listPrinters(): Promise<PrinterDevice[]> {
        try {
            const tempWin = new BrowserWindow({ show: false })
            const printers = await tempWin.webContents.getPrintersAsync()
            tempWin.destroy()

            return printers.map(p => ({
                name: p.name,
                isDefault: p.isDefault
            }))
        } catch (error) {
            console.error('Failed to list printers:', error)
            return []
        }
    }

    /**
     * Get the default printer
     */
    async getDefaultPrinter(): Promise<PrinterDevice | null> {
        const printers = await this.listPrinters()
        return printers.find(p => p.isDefault) || printers[0] || null
    }

    /**
     * Print an image file silently
     * Generates a PDF for logging, but uses native Windows PowerShell for flawless dye-sub physical printing
     * @param copies Number of 4R pages to generate (each page = 2 strips)
     */
    async print(filePath: string, printerName?: string, copies: number = 1): Promise<PrintResult> {
        console.log(`[PrinterHandler] Starting print job for file: ${filePath}, printer: ${printerName}, copies: ${copies}`)
        
        try {
            // 1. Generate PDF for session logging purposes
            const pdfDoc = await PDFDocument.create()
            const imageBytes = fs.readFileSync(filePath)
            const image = await pdfDoc.embedJpg(imageBytes)

            const pt4 = 288 // 4 inches
            const pt6 = 432 // 6 inches

            const pageWidth = pt4
            const pageHeight = pt6

            const numPages = Math.max(1, copies)
            for (let i = 0; i < numPages; i++) {
                const page = pdfDoc.addPage([pageWidth, pageHeight])
                page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight })
            }

            const pdfBytes = await pdfDoc.save()
            const pdfPath = path.join(
                path.dirname(filePath),
                path.basename(filePath, '.jpg') + `_4R_${numPages}pages.pdf`
            )
            fs.writeFileSync(pdfPath, pdfBytes)
            console.log(`Saved PDF (${pageWidth}x${pageHeight}pt, ${numPages} pages) to:`, pdfPath)

            // 2. Trigger physical printer silently via Native Windows Spooler (C# System.Drawing.Printing inside PS)
            // This is infinitely more reliable for strict dye-sub printers (DNP RX1) than SumatraPDF
            if (printerName && printerName.toLowerCase() !== 'print to pdf') {
                console.log(`[PrinterHandler] Executing PowerShell print command for printer: ${printerName}`)
                
                try {
                    // Create a PowerShell script string that compiles and executes a C# print job.
                    // This bypasses any third-party PDF renderer quirks.
                    const psCommand = `
$code = @"
using System;
using System.Drawing;
using System.Drawing.Printing;
public class ImagePrinter {
    public static void Print(string file, string printer, int copies) {
        PrintDocument pd = new PrintDocument();
        // No "Printing..." status dialog: by default .NET wraps the job in a WinForms dialog that steals focus from the kiosk
        pd.PrintController = new StandardPrintController();
        pd.PrinterSettings.PrinterName = printer;
        pd.PrinterSettings.Copies = (short)copies;

        // We handle the rotation ourselves (Rotate90FlipNone), so tell Windows this is Portrait
        // to prevent Auto-Rotate interference.
        pd.DefaultPageSettings.Landscape = false;
        
        pd.PrintPage += (sender, args) => {
            using (Image img = Image.FromFile(file)) {
                // To trigger the 2-inch split cut on DNP RX1 and similar dye-sub printers,
                // the driver strictly requires the image to be oriented as Landscape 6x4.
                // We rotate the Portrait 1200x1800 template 90 degrees to become 1800x1200.
                img.RotateFlip(RotateFlipType.Rotate90FlipNone);
                
                args.Graphics.DrawImage(img, args.PageBounds);
            }
        };
        pd.Print();
    }
}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing
[ImagePrinter]::Print('${filePath.replace(/'/g, "''")}', '${printerName.replace(/'/g, "''")}', ${numPages})
`
                    
                    // Encode command to base64 (UTF-16LE) to avoid syntax/escaping issues with multiline strings
                    const base64Command = Buffer.from(psCommand, 'utf16le').toString('base64')
                    
                    console.log(`Sending native print job to ${printerName} for ${numPages} copies...`)
                    console.log(`[PrinterHandler] PowerShell command length: ${base64Command.length}`)
                    
                    // windowsHide: a visible PowerShell console steals keyboard focus from the kiosk,
                    // so the physical buttons (keys 1/2/3) stop reaching the app after every print
                    try {
                        await execAsync(`powershell -EncodedCommand ${base64Command}`, { windowsHide: true })
                    } finally {
                        refocusKiosk()
                        setTimeout(refocusKiosk, 1500) // driver status windows can appear just after the job
                    }
                    
                    console.log(`[PrinterHandler] Print job completed successfully`)
                    return { success: true }
                } catch (printErr: any) {
                    console.error('Physical print execution failed:', printErr)
                    return { success: false, error: printErr.message }
                }
            } else {
                return { success: true, error: 'Saved PDF verification only' }
            }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    }

    /**
     * Print with specific options
     */
    async printWithOptions(
        filePath: string,
        options: {
            printer?: string
            copies?: number
            scale?: 'fit' | 'noscale'
        }
    ): Promise<PrintResult> {
        try {
            const copies = options.copies || 1
            return await this.print(filePath, options.printer, copies)
        } catch (error) {
            const err = error as Error
            return {
                success: false,
                error: err.message
            }
        }
    }
}

// Singleton instance
export const printerHandler = new PrinterHandler()
