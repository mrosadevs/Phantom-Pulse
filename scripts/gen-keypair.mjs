#!/usr/bin/env node
/**
 * One-time signing keypair generation.
 *
 * Run this ONCE.  The private key stays in keys/ (gitignored); the printed
 * public key goes into PUBLIC_KEY_PEM in src/main/license/verify.ts.
 *
 * Regenerating invalidates every key ever issued, so back up keys/ somewhere
 * safe — losing it means you can never mint another key for the current build.
 */
import { generateKeyPairSync } from 'node:crypto'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const keysDir = join(root, 'keys')
const privPath = join(keysDir, 'license-private.pem')

if (existsSync(privPath) && !process.argv.includes('--force')) {
  console.error(`Refusing to overwrite ${privPath}`)
  console.error('That would invalidate every licence key you have already issued.')
  console.error('Pass --force only if you are certain.')
  process.exit(1)
}

mkdirSync(keysDir, { recursive: true })
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ type: 'spki', format: 'pem' })

writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
writeFileSync(join(keysDir, 'license-public.pem'), pub)

console.log(`Private key written to ${privPath}  (gitignored — back this up)`)
console.log('\nPaste this into PUBLIC_KEY_PEM in src/main/license/verify.ts:\n')
console.log(pub)
