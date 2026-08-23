#!/usr/bin/env node
/**
 * Mint a Phantom Pulse licence key.
 *
 *   npm run gen-key -- --machine ABCD-1234-EF56-7890 --name "Mom"
 *   npm run gen-key -- --machine ABCD-... --name "Trial" --expires 2027-01-01
 *
 * Requires keys/license-private.pem, which is gitignored and must never be
 * committed or shipped — anyone holding it can mint keys for any machine.
 * The app verifies with the matching public key baked into src/main/license/verify.ts.
 */
import { createPrivateKey, sign as edSign } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRIVATE_KEY_PATH = join(root, 'keys', 'license-private.pem')

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const machine = arg('machine')
const name = arg('name') ?? 'Unnamed'
const expires = arg('expires') ?? null

if (!machine) {
  console.error('Usage: npm run gen-key -- --machine <ID> --name "<who>" [--expires YYYY-MM-DD]')
  console.error('Get <ID> from the app\'s activation screen (Settings → Licence once activated).')
  process.exit(1)
}

if (!/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/i.test(machine)) {
  console.error(`Machine ID "${machine}" is not in the expected XXXX-XXXX-XXXX-XXXX form.`)
  process.exit(1)
}

if (!existsSync(PRIVATE_KEY_PATH)) {
  console.error(`Missing ${PRIVATE_KEY_PATH}`)
  console.error('Run: npm run gen-keypair   (once — then keep that file safe and backed up)')
  process.exit(1)
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const payload = {
  v: 1,
  machine: machine.toUpperCase(),
  name,
  issued: new Date().toISOString().slice(0, 10),
  expires
}

const payloadB64 = b64url(JSON.stringify(payload))
const privateKey = createPrivateKey(readFileSync(PRIVATE_KEY_PATH))
const signature = edSign(null, Buffer.from(payloadB64, 'utf8'), privateKey)

console.log('')
console.log(`  Issued to : ${payload.name}`)
console.log(`  Machine   : ${payload.machine}`)
console.log(`  Expires   : ${payload.expires ?? 'never'}`)
console.log('')
console.log('  Licence key (send this to the user):')
console.log('')
console.log(`PP1.${payloadB64}.${b64url(signature)}`)
console.log('')
