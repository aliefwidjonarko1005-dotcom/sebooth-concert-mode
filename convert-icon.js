// Script to convert PNG icon to ICO format using sharp
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'resources', 'icon.png');
const outputIcoPath = path.join(__dirname, 'resources', 'icon.ico');

// ICO file format helper
function createIcoBuffer(pngBuffers) {
    // ICO header: 6 bytes
    const headerSize = 6;
    const entrySize = 16; // each directory entry
    const numImages = pngBuffers.length;
    
    // Calculate total size
    let dataOffset = headerSize + (entrySize * numImages);
    const entries = [];
    
    for (const { buffer, size } of pngBuffers) {
        entries.push({
            width: size >= 256 ? 0 : size, // 0 means 256
            height: size >= 256 ? 0 : size,
            dataSize: buffer.length,
            dataOffset: dataOffset,
            buffer: buffer
        });
        dataOffset += buffer.length;
    }
    
    // Build ICO file
    const totalSize = dataOffset;
    const ico = Buffer.alloc(totalSize);
    
    // Header
    ico.writeUInt16LE(0, 0);      // Reserved
    ico.writeUInt16LE(1, 2);      // Type: 1 = ICO
    ico.writeUInt16LE(numImages, 4); // Number of images
    
    // Directory entries
    let offset = headerSize;
    for (const entry of entries) {
        ico.writeUInt8(entry.width, offset);
        ico.writeUInt8(entry.height, offset + 1);
        ico.writeUInt8(0, offset + 2);   // Color palette
        ico.writeUInt8(0, offset + 3);   // Reserved
        ico.writeUInt16LE(1, offset + 4);  // Color planes
        ico.writeUInt16LE(32, offset + 6); // Bits per pixel
        ico.writeUInt32LE(entry.dataSize, offset + 8);
        ico.writeUInt32LE(entry.dataOffset, offset + 12);
        offset += entrySize;
    }
    
    // Image data
    for (const entry of entries) {
        entry.buffer.copy(ico, entry.dataOffset);
    }
    
    return ico;
}

async function main() {
    const sizes = [256, 128, 64, 48, 32, 16];
    const pngBuffers = [];
    
    for (const size of sizes) {
        const buffer = await sharp(inputPath)
            .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
        pngBuffers.push({ buffer, size });
        console.log(`  Generated ${size}x${size} (${buffer.length} bytes)`);
    }
    
    const icoBuffer = createIcoBuffer(pngBuffers);
    fs.writeFileSync(outputIcoPath, icoBuffer);
    console.log(`\nICO file created: ${outputIcoPath} (${icoBuffer.length} bytes)`);
}

main().catch(console.error);
