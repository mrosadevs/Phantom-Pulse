import { createPublicKey, verify as edVerify } from 'crypto'

/**
 * Offline licence verification.
 *
 * A licence key is an Ed25519-signed claim that a named machine may run this
 * app.  Only the holder of the private key (kept out of this repo, in keys/)
 * can mint one, so keys cannot be forged or hand-edited — but note that this
 * verification runs client-side, so a determined user can still patch the
 * check out of the packaged app.  The goal is to make keys unforgeable and
 * non-shareable, not to defeat tampering.
 *
 * Format:  PP1.<base64url(payload JSON)>.<base64url(signature)>
 */

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxo+au9yFdeEzxNpuDsc5AgfoYNFJ41XqS+pO3zp/OwQ=
-----END PUBLIC KEY-----`

const PREFIX = 'PP1'

export interface LicensePayload {
  v: number
  /** Machine fingerprint this key is bound to. */
  machine: string
  /** Who it was issued to — shown in Settings. */
  name: string
  /** ISO date of issue. */
  issued: string
  /** ISO date, or null for a perpetual key. */
  expires: string | null
}

export type VerifyResult =
  | { valid: true; payload: LicensePayload }
  | { valid: false; reason: string }

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * Verify a key's signature and confirm it names this machine.
 * `thisMachine` is passed in rather than imported so the same routine can be
 * unit-tested and reused by the key generator.
 */
export function verifyLicense(key: string, thisMachine: string): VerifyResult {
  const trimmed = key.trim().replace(/\s+/g, '')
  if (!trimmed) return { valid: false, reason: 'No licence key entered.' }

  const parts = trimmed.split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { valid: false, reason: 'That does not look like a Phantom Pulse licence key.' }
  }

  const [, payloadB64, sigB64] = parts

  let signatureOk = false
  try {
    signatureOk = edVerify(
      null,
      Buffer.from(payloadB64, 'utf8'),
      createPublicKey(PUBLIC_KEY_PEM),
      b64urlToBuffer(sigB64)
    )
  } catch {
    return { valid: false, reason: 'Licence key is malformed.' }
  }
  if (!signatureOk) return { valid: false, reason: 'Licence key signature is invalid.' }

  let payload: LicensePayload
  try {
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'))
  } catch {
    return { valid: false, reason: 'Licence key payload is unreadable.' }
  }

  if (payload.machine !== thisMachine) {
    return {
      valid: false,
      reason: 'This licence key was issued for a different machine.'
    }
  }

  if (payload.expires && new Date(payload.expires).getTime() < Date.now()) {
    return { valid: false, reason: `Licence expired on ${payload.expires}.` }
  }

  return { valid: true, payload }
}
