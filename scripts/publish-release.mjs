// Booth remote-update releases (feed: build.publish in package.json, GCS bucket releases/win/).
//
//   node scripts/publish-release.mjs keygen <file>
//       Offline release key. Keep <file> off this repo (USB / password manager). Pin the printed
//       RELEASE_PUBLIC_KEY in src/shared/guardPins.ts.
//   npm run build:win && node scripts/publish-release.mjs publish <release-key.pem>
//       Signs dist/Sebooth-Setup-<version>.exe and uploads installer, blockmap, .sig, then latest.yml
//       (last, so booths never see a version whose files are missing). Uses the GCS key from
//       GCS_KEY_PATH or ./google-key.json. Then send "Update" from Admin -> Booth Guard.
//   node scripts/publish-release.mjs sign <release-key.pem>     sign only (no upload)

import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, createReadStream } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [cmd, arg] = process.argv.slice(2)

if (cmd === 'keygen') {
    if (!arg) fail('Usage: keygen <file>')
    if (existsSync(arg)) fail(`Refusing to overwrite ${arg}`)
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    writeFileSync(arg, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
    console.log(`Release private key written to ${arg}`)
    console.log('RELEASE_PUBLIC_KEY=' + publicKey.export({ format: 'der', type: 'spki' }).toString('base64'))
    process.exit(0)
}
if (cmd !== 'sign' && cmd !== 'publish') fail('Usage: keygen <file> | sign <key.pem> | publish <key.pem>')
if (!arg) fail('Missing release key file')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const feed = pkg.build?.publish?.[0]?.url
const name = `Sebooth-Setup-${version}.exe`
const dist = join(root, 'dist')
const installer = join(dist, name)
const latest = join(dist, 'latest.yml')
for (const f of [installer, latest]) if (!existsSync(f)) fail(`${f} not found. Run npm run build:win first.`)

const sha512 = await new Promise((ok, ko) => {
    const h = createHash('sha512')
    createReadStream(installer).on('data', (c) => h.update(c)).on('error', ko).on('end', () => ok(h.digest('base64')))
})
const yml = readFileSync(latest, 'utf8')
if (!yml.includes(`version: ${version}`) || !yml.includes(sha512)) fail('latest.yml does not describe this installer (version/sha512 mismatch). Rebuild.')

const signature = sign(null, Buffer.from(`SEBOOTH-RELEASE-V1\n${version}\n${sha512}`), createPrivateKey(readFileSync(arg))).toString('base64')
writeFileSync(`${installer}.sig`, signature)
console.log(`Signed ${name} (v${version})`)
if (cmd === 'sign') process.exit(0)

const m = /^https:\/\/storage\.googleapis\.com\/([^/]+)\/(.+)$/.exec(feed || '')
if (!m) fail(`build.publish[0].url is not a storage.googleapis.com URL: ${feed}`)
const [, bucketName, prefix] = m
const keyFile = process.env.GCS_KEY_PATH || join(root, 'google-key.json')
if (!existsSync(keyFile)) fail(`GCS key not found at ${keyFile} (set GCS_KEY_PATH)`)

const { Storage } = await import('@google-cloud/storage')
const bucket = new Storage({ keyFilename: keyFile }).bucket(bucketName)
const put = async (file, dest, cacheControl, onlyNew) => {
    await bucket.upload(file, { destination: `${prefix}/${dest}`, metadata: { cacheControl }, ...(onlyNew ? { preconditionOpts: { ifGenerationMatch: 0 } } : {}) })
    console.log(`  uploaded ${prefix}/${dest}`)
}
try {
    await put(installer, name, 'public, max-age=31536000', true) // a version is published once; bump it to republish
    if (existsSync(`${installer}.blockmap`)) await put(`${installer}.blockmap`, `${name}.blockmap`, 'public, max-age=31536000', true)
    await put(`${installer}.sig`, `${name}.sig`, 'no-cache', false)
    await put(latest, 'latest.yml', 'no-cache', false)
} catch (e) {
    fail(`Upload failed: ${e.message}${e.code === 412 ? ' (this version already exists in the bucket; bump the version)' : ''}`)
}
console.log(`Published v${version}. Send "Update" with version ${version} from Admin -> Booth Guard.`)

function fail(msg) {
    console.error(msg)
    process.exit(1)
}
