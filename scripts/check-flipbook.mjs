// Self-check for flipbook page order: node scripts/check-flipbook.mjs [outDir]
// Simulates the operator: strips in print order → one horizontal cut → bottom pile behind top pile.
// With outDir, also renders sample sheets from generated dummy frames.
import { buildSync } from 'esbuild'
import { createRequire } from 'module'
import { join } from 'path'
import { mkdirSync } from 'fs'
import assert from 'assert'

const bundle = join('node_modules', '.cache', 'flipbook-check.cjs') // inside node_modules so `sharp` resolves

buildSync({ entryPoints: ['src/main/services/FlipbookSheets.ts'], bundle: true, platform: 'node', external: ['sharp'], outfile: bundle, logLevel: 'error' })
const require = createRequire(import.meta.url)
const { flipbookPageAt, sampleEvenly, buildFlipbookSheets } = require(join(process.cwd(), bundle))

for (const sheets of [1, 2, 6, 10]) {
    const strips = []
    for (let s = 0; s < sheets; s++) for (let c = 0; c < 2; c++) strips.push([flipbookPageAt(sheets, s, c, 0), flipbookPageAt(sheets, s, c, 1)])
    const stacked = [...strips.map(([top]) => top), ...strips.map(([, bottom]) => bottom)]
    assert.deepStrictEqual(stacked, [...Array(sheets * 4).keys()], `order broken for ${sheets} sheets`)
}
assert.deepStrictEqual(sampleEvenly([0, 1, 2, 3, 4], 3), [0, 2, 4])
assert.deepStrictEqual(sampleEvenly([7], 4), [7, 7, 7, 7])
console.log('page order OK')

const outDir = process.argv[2]
if (outDir) {
    const sharp = require('sharp')
    mkdirSync(outDir, { recursive: true })
    const frames = []
    for (let i = 0; i < 20; i++) {
        const f = join(outDir, `frame-${i}.png`)
        const svg = `<svg width="1500" height="1000"><rect width="1500" height="1000" fill="hsl(${i * 18},70%,60%)"/><circle cx="${200 + i * 55}" cy="500" r="150" fill="#fff"/><text x="750" y="900" font-size="120" text-anchor="middle" font-family="Arial">F${i}</text></svg>`
        await sharp(Buffer.from(svg)).png().toFile(f)
        frames.push(f)
    }
    console.log(await buildFlipbookSheets({ photoPaths: frames, sheets: 2, outDir }))
}
