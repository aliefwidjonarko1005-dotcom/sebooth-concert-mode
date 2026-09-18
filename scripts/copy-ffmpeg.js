/**
 * Pre-build script: Copy FFmpeg binary to resources/bin/
 * 
 * This script is run before electron-builder packages the app.
 * It copies the platform-specific ffmpeg binary from node_modules
 * into resources/bin/ so it gets bundled via extraResources.
 * 
 * Usage: node scripts/copy-ffmpeg.js
 */
const fs = require('fs');
const path = require('path');

try {
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
    const srcPath = ffmpegInstaller.path;
    const destDir = path.join(__dirname, '..', 'resources', 'bin');
    const destPath = path.join(destDir, path.basename(srcPath));

    // Create destination directory
    fs.mkdirSync(destDir, { recursive: true });

    // Copy the binary
    fs.copyFileSync(srcPath, destPath);

    console.log(`✅ FFmpeg binary copied successfully`);
    console.log(`   From: ${srcPath}`);
    console.log(`   To:   ${destPath}`);
    console.log(`   Size: ${(fs.statSync(destPath).size / 1024 / 1024).toFixed(1)} MB`);
} catch (error) {
    console.error('❌ Failed to copy FFmpeg binary:', error.message);
    process.exit(1);
}
