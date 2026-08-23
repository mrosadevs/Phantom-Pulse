/**
 * Round-trip test for the licence system: mint with the private key, verify
 * with the shipping verify.ts, and confirm the rejection paths actually reject.
 * Run: npm run test:license
 */
import { createPrivateKey, sign as edSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { verifyLicense } from '../src/main/license/verify.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const priv = createPrivateKey(readFileSync(join(root, 'keys', 'license-private.pem')))
const b64url = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const MACHINE = 'AAAA-BBBB-CCCC-DDDD'
const OTHER = 'FFFF-EEEE-DDDD-CCCC'

function mint(payload) {
  const p = b64url(JSON.stringify(payload))
  return `PP1.${p}.${b64url(edSign(null, Buffer.from(p, 'utf8'), priv))}`
}

const base = { v: 1, machine: MACHINE, name: 'Test', issued: '2026-08-23', expires: null }
let pass = 0, fail = 0
const check = (label, cond) => {
  if (cond) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; console.log(`  FAIL ${label}`) }
}

check('valid key on its own machine is accepted', verifyLicense(mint(base), MACHINE).valid === true)
check('same key on a different machine is rejected', verifyLicense(mint(base), OTHER).valid === false)
check('expired key is rejected',
  verifyLicense(mint({ ...base, expires: '2020-01-01' }), MACHINE).valid === false)
check('future expiry is accepted',
  verifyLicense(mint({ ...base, expires: '2099-01-01' }), MACHINE).valid === true)

// Tamper: swap the machine in the payload without re-signing
const good = mint(base)
const [, payloadB64, sig] = good.split('.')
const tamperedPayload = b64url(JSON.stringify({ ...base, machine: OTHER }))
check('payload tampering breaks the signature',
  verifyLicense(`PP1.${tamperedPayload}.${sig}`, OTHER).valid === false)

check('garbage input is rejected', verifyLicense('not-a-key', MACHINE).valid === false)
check('empty input is rejected', verifyLicense('', MACHINE).valid === false)
check('wrong prefix is rejected', verifyLicense(good.replace('PP1', 'XX9'), MACHINE).valid === false)
check('whitespace in a pasted key is tolerated',
  verifyLicense(`  ${good.slice(0, 20)} ${good.slice(20)}  `, MACHINE).valid === true)
check('name survives the round trip', verifyLicense(mint(base), MACHINE).payload?.name === 'Test')

console.log(`\n  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
