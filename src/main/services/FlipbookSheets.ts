import sharp from 'sharp'
import { mkdir } from 'fs/promises'
import { join } from 'path'

// Same 4R template as strips (1200x1800 @300dpi): PrinterHandler rotates it so the DNP 2-inch cut
// splits it into a left and a right strip. Each strip holds 2 slots (top/bottom) of 2x3 in.
const SHEET_W = 1200
const SLOT_W = 600
const SLOT_H = 900
const BIND = 120 // 0.4 in staple margin on the page's left edge (page number sits here, hidden once bound)
const PAGE_W = SLOT_H // pages are landscape, rotated into the portrait slot
const PAGE_H = SLOT_W

/**
 * 0-based page printed on sheet/col(0 left,1 right)/half(0 top,1 bottom).
 * Strips leave the printer in order, so after one horizontal cut through the pile
 * (bottom halves behind top halves) the pages read 0..n-1.
 */
export function flipbookPageAt(sheets: number, sheet: number, col: number, half: number): number {
    return half * sheets * 2 + sheet * 2 + col
}

/** Evenly pick `count` items, keeping first and last. */
export function sampleEvenly<T>(items: T[], count: number): T[] {
    if (!items.length || count <= 0) return []
    if (count === 1) return [items[0]]
    return Array.from({ length: count }, (_, k) => items[Math.round(k * (items.length - 1) / (count - 1))])
}

async function renderPage(src: string, pageNo: number, isCover: boolean): Promise<Buffer> {
    const area = await sharp(src)
        .resize(PAGE_W - BIND, PAGE_H, { fit: isCover ? 'contain' : 'cover', background: '#ffffff' })
        .toBuffer()
    const label = isCover ? '' : `<text x="${BIND / 2}" y="${PAGE_H - 30}" font-family="Arial" font-size="34" fill="#888" text-anchor="middle">${pageNo}</text>`
    const margin = `<svg width="${BIND}" height="${PAGE_H}"><line x1="${BIND - 1}" y1="0" x2="${BIND - 1}" y2="${PAGE_H}" stroke="#ddd" stroke-width="2"/>${label}</svg>`
    const page = await sharp({ create: { width: PAGE_W, height: PAGE_H, channels: 3, background: '#ffffff' } })
        .composite([
            { input: area, left: BIND, top: 0 },
            { input: Buffer.from(margin), left: 0, top: 0 }
        ])
        .png()
        .toBuffer()
    // Clockwise: the binding edge ends up on the slot's top edge, same on both halves so piles stack aligned
    return sharp(page).rotate(90).toBuffer()
}

/**
 * Build the print sheets for one flipbook. Page 1 is the cover (falls back to the first frame),
 * the remaining pages are `photoPaths` sampled evenly. Returns sheet paths in print order plus
 * small JPG previews of the animated pages (for the on-screen flip preview).
 */
export async function buildFlipbookSheets(opts: {
    photoPaths: string[]
    coverPath?: string
    sheets: number
    outDir: string
}): Promise<{ sheets: string[]; previews: string[] }> {
    const { photoPaths, sheets, outDir } = opts
    if (!photoPaths.length) throw new Error('Flipbook has no frames')
    if (sheets < 1) throw new Error('Flipbook needs at least 1 sheet')
    await mkdir(outDir, { recursive: true })

    const pages = [opts.coverPath || photoPaths[0], ...sampleEvenly(photoPaths, sheets * 4 - 1)]
    const cutLine = Buffer.from(`<svg width="${SHEET_W}" height="4"><line x1="0" y1="2" x2="${SHEET_W}" y2="2" stroke="#bbb" stroke-width="2" stroke-dasharray="16 12"/></svg>`)
    const out: string[] = []

    for (let sheet = 0; sheet < sheets; sheet++) {
        const layers: sharp.OverlayOptions[] = []
        for (let col = 0; col < 2; col++) {
            for (let half = 0; half < 2; half++) {
                const p = flipbookPageAt(sheets, sheet, col, half)
                layers.push({ input: await renderPage(pages[p], p + 1, p === 0), left: col * SLOT_W, top: half * SLOT_H })
            }
        }
        layers.push({ input: cutLine, left: 0, top: SLOT_H - 2 })
        // JPG: PrinterHandler.print() embeds the file with pdf-lib embedJpg
        const file = join(outDir, `flipbook-sheet-${String(sheet + 1).padStart(2, '0')}.jpg`)
        await sharp({ create: { width: SHEET_W, height: SLOT_H * 2, channels: 3, background: '#ffffff' } })
            .composite(layers)
            .jpeg({ quality: 95 })
            .toFile(file)
        out.push(file)
    }

    const previews: string[] = []
    for (let i = 1; i < pages.length; i++) {
        const file = join(outDir, `preview-${String(i).padStart(3, '0')}.jpg`)
        await sharp(pages[i]).resize(640).jpeg({ quality: 75 }).toFile(file)
        previews.push(file)
    }
    return { sheets: out, previews }
}
