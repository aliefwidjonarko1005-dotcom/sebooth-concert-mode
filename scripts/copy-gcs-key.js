/**
 * Pre-build script: Copy GCS service account key to resources/
 * 
 * Copies the Google Cloud Storage key JSON file into the resources
 * directory so it gets bundled via extraResources as gcs-key.json.
 * 
 * Usage: node scripts/copy-gcs-key.js
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env to get GCS_KEY_PATH
dotenv.config();

const keyName = process.env.GCS_KEY_PATH || 'google-key.json';
const srcPath = path.isAbsolute(keyName) ? keyName : path.join(__dirname, '..', keyName);
const destPath = path.join(__dirname, '..', 'resources', 'gcs-key.json');

try {
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`✅ GCS key copied successfully`);
        console.log(`   From: ${srcPath}`);
        console.log(`   To:   ${destPath}`);
    } else {
        console.warn(`⚠️  GCS key not found at: ${srcPath}`);
        console.warn(`   Cloud storage features will not work in the built app.`);
        console.warn(`   Set GCS_KEY_PATH in .env or place google-key.json in the project root.`);
    }
} catch (error) {
    console.error('❌ Failed to copy GCS key:', error.message);
    // Don't exit with error - app can still work without GCS
}
