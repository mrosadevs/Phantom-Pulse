/**
 * Print this machine's Phantom Pulse machine ID.
 *
 * Handy when issuing a key for a PC you have shell access to, and as a check
 * that the MachineGuid lookup in machineId.ts is actually working — if the
 * registry read fails it silently falls back to a weaker hostname/CPU seed.
 *
 * Run: node scripts/show-machine-id.mjs
 */
import { getMachineId } from '../src/main/license/machineId.ts'
import { execFileSync } from 'node:child_process'

let viaRegistry = false
try {
  const out = execFileSync(
    'reg',
    ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
    { encoding: 'utf8', windowsHide: true, timeout: 5000 }
  )
  viaRegistry = /MachineGuid\s+REG_SZ\s+[0-9a-fA-F-]{36}/.test(out)
} catch {
  viaRegistry = false
}

console.log(`  Machine ID : ${getMachineId()}`)
console.log(`  Source     : ${viaRegistry ? 'Windows MachineGuid (stable)' : 'fallback seed (weaker)'}`)
