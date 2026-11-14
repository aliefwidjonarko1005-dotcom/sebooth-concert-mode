// Self-check for the Booth Guard owner-signature verifier: node scripts/check-guard-protocol.mjs
// Builds real WebAuthn-shaped assertions with a local P-256 key (and an Ed25519 recovery key) and
// checks that only the exact owner-signed command passes.

import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import {
    canonicalJSON, commandChallenge, parseBoothCommand, verifyOwnerAssertion,
    signDeviceRequest, verifyServerResponse, verifyReleaseSignature, SERVER_SIG_PREFIX
} from '../src/main/guard/protocol.ts'

const sha = (d) => createHash('sha256').update(d).digest()
const b64u = (b) => Buffer.from(b).toString('base64url')

const rpId = 'sebooth.in'
const origin = 'https://www.sebooth.in'
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pin = { credentialId: 'cred-1', jwk: publicKey.export({ format: 'jwk' }), alg: -7, rpId, origins: [origin] }

const now = Date.now()
const cmd = { v: 1, id: randomUUID(), deviceId: randomUUID(), action: 'unlock', params: {}, issuedAt: now, expiresAt: now + 3600_000 }

function assertionFor(command, { flags = 0x05, o = origin, rp = rpId, challenge, type = 'webauthn.get', key = privateKey } = {}) {
    const clientData = Buffer.from(JSON.stringify({ type, challenge: challenge ?? commandChallenge(command), origin: o }))
    const authData = Buffer.concat([sha(rp), Buffer.from([flags]), Buffer.alloc(4)])
    const signature = sign('sha256', Buffer.concat([authData, sha(clientData)]), key)
    return { type: 'passkey', credentialId: 'cred-1', authenticatorData: b64u(authData), clientDataJSON: b64u(clientData), signature: b64u(signature) }
}

// canonical form is key-order independent
assert.equal(canonicalJSON({ b: 1, a: [2, { d: 1, c: null }] }), canonicalJSON({ a: [2, { c: null, d: 1 }], b: 1 }))
assert.ok(parseBoothCommand(cmd))
assert.equal(parseBoothCommand({ ...cmd, action: 'format_disk' }), null)
assert.equal(parseBoothCommand({ ...cmd, expiresAt: now + 30 * 86400_000 }), null)

// valid passkey assertion
assert.equal(verifyOwnerAssertion(cmd, assertionFor(cmd), [pin], []), null)
// key-order of the command must not matter
const reordered = JSON.parse(JSON.stringify({ expiresAt: cmd.expiresAt, params: {}, action: cmd.action, deviceId: cmd.deviceId, id: cmd.id, issuedAt: cmd.issuedAt, v: 1 }))
assert.equal(verifyOwnerAssertion(reordered, assertionFor(cmd), [pin], []), null)

// every tampering is rejected
assert.match(verifyOwnerAssertion({ ...cmd, action: 'approve' }, assertionFor(cmd), [pin], []), /challenge/)
assert.match(verifyOwnerAssertion({ ...cmd, deviceId: randomUUID() }, assertionFor(cmd), [pin], []), /challenge/)
assert.match(verifyOwnerAssertion(cmd, assertionFor(cmd, { o: 'https://evil.example' }), [pin], []), /origin/)
assert.match(verifyOwnerAssertion(cmd, assertionFor(cmd, { rp: 'evil.example' }), [pin], []), /rpId/)
assert.match(verifyOwnerAssertion(cmd, assertionFor(cmd, { flags: 0x01 }), [pin], []), /verification/)
assert.match(verifyOwnerAssertion(cmd, assertionFor(cmd, { type: 'webauthn.create' }), [pin], []), /type/)
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
assert.match(verifyOwnerAssertion(cmd, assertionFor(cmd, { key: other }), [pin], []), /signature/)
assert.match(verifyOwnerAssertion(cmd, assertionFor(cmd), [], []), /not an owner key/)
assert.match(verifyOwnerAssertion(cmd, { type: 'passkey', credentialId: 'cred-1', authenticatorData: '', clientDataJSON: 'x', signature: '' }, [pin], []), /malformed/)

// recovery key
const rec = generateKeyPairSync('ed25519')
const recPub = rec.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const recSig = sign(null, Buffer.from(`SEBOOTH-OWNER-V1\n${canonicalJSON(cmd)}`), rec.privateKey).toString('base64')
assert.equal(verifyOwnerAssertion(cmd, { type: 'recovery', signature: recSig }, [], [recPub]), null)
assert.match(verifyOwnerAssertion({ ...cmd, action: 'approve' }, { type: 'recovery', signature: recSig }, [], [recPub]), /recovery/)
assert.match(verifyOwnerAssertion(cmd, { type: 'recovery', signature: recSig }, [], []), /recovery/)

// server response signature
const srv = generateKeyPairSync('ed25519')
const srvPub = srv.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const raw = JSON.stringify({ status: 'approved' })
const srvSig = sign(null, Buffer.from(`${SERVER_SIG_PREFIX}\n/api/booth/heartbeat\n${raw}`), srv.privateKey).toString('base64')
assert.ok(verifyServerResponse(srvPub, '/api/booth/heartbeat', raw, srvSig))
assert.ok(!verifyServerResponse(srvPub, '/api/booth/heartbeat', raw.replace('approved', 'locked'), srvSig))
assert.ok(!verifyServerResponse(srvPub, '/api/booth/register', raw, srvSig))
assert.ok(!verifyServerResponse(recPub, '/api/booth/heartbeat', raw, srvSig))
assert.ok(signDeviceRequest(rec.privateKey, '/x', '{}').length > 0)

// release signature (same message format as scripts/publish-release.mjs)
const rel = generateKeyPairSync('ed25519')
const relPub = rel.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const instSha = createHash('sha512').update('installer bytes').digest('base64')
const relSig = sign(null, Buffer.from(`SEBOOTH-RELEASE-V1\n1.2.3\n${instSha}`), rel.privateKey).toString('base64')
assert.ok(verifyReleaseSignature(relPub, '1.2.3', instSha, relSig + '\n'))
assert.ok(!verifyReleaseSignature(relPub, '1.2.4', instSha, relSig))
assert.ok(!verifyReleaseSignature(relPub, '1.2.3', createHash('sha512').update('tampered').digest('base64'), relSig))
assert.ok(!verifyReleaseSignature(recPub, '1.2.3', instSha, relSig))
assert.ok(!verifyReleaseSignature('', '1.2.3', instSha, relSig))

console.log('guard protocol: all checks passed')
