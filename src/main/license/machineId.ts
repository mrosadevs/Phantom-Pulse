import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { hostname, cpus, arch } from 'os'

/**
 * Stable per-machine fingerprint.
 *
 * Primary source is Windows' MachineGuid, written once at OS install and
 * untouched by hardware swaps, app reinstalls, or user changes — the most
 * stable identifier available without admin rights.  A wiped/reinstalled
 * Windows produces a new GUID, which is the intended behaviour: that is a
 * different machine as far as a licence is concerned, and needs a new key.
 *
 * The GUID is hashed rather than used raw so the value shown in the UI (and
 * emailed around) is not a real system identifier.
 */

const SALT = 'phantom-pulse.v1'

function readMachineGuid(): string | null {
  try {
    // /reg:64 so a 32-bit Node process still reads the 64-bit hive
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    )
    const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/)
    return match ? match[1].toLowerCase() : null
  } catch {
    return null
  }
}

/** Weaker fallback for non-Windows or a locked-down registry. */
function fallbackSeed(): string {
  const cpu = cpus()[0]?.model ?? 'unknown-cpu'
  return `${hostname()}|${cpu}|${arch()}`
}

let cached: string | null = null

/** Formatted as XXXX-XXXX-XXXX-XXXX for display and for pasting into a key request. */
export function getMachineId(): string {
  if (cached) return cached
  const seed = readMachineGuid() ?? fallbackSeed()
  const hex = createHash('sha256').update(`${SALT}|${seed}`).digest('hex').toUpperCase()
  cached = (hex.slice(0, 16).match(/.{4}/g) as string[]).join('-')
  return cached
}
