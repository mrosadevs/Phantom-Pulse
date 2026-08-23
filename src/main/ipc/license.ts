import type { IpcMain } from 'electron'
import Store from 'electron-store'
import { getMachineId } from '../license/machineId'
import { verifyLicense, type LicensePayload } from '../license/verify'

/**
 * Licence activation and gating.
 *
 * The stored key is re-verified from scratch on every launch rather than
 * trusting a saved "activated" flag, so copying the config file onto another
 * machine gains nothing — the key names a machine, and the check runs against
 * the machine it is running on.
 */

const store = new Store({ name: 'license' })
const KEY = 'licenseKey'

export interface LicenseStatus {
  activated: boolean
  machineId: string
  name?: string
  issued?: string
  expires?: string | null
  /** Why an existing stored key stopped working — surfaced in Settings. */
  reason?: string
}

function currentStatus(): LicenseStatus {
  const machineId = getMachineId()
  const stored = store.get(KEY) as string | undefined

  if (!stored) return { activated: false, machineId }

  const result = verifyLicense(stored, machineId)
  if (!result.valid) {
    return { activated: false, machineId, reason: result.reason }
  }

  const p: LicensePayload = result.payload
  return {
    activated: true,
    machineId,
    name: p.name,
    issued: p.issued,
    expires: p.expires
  }
}

export function isActivated(): boolean {
  return currentStatus().activated
}

export function registerLicenseHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('license:status', (): LicenseStatus => currentStatus())

  ipcMain.handle('license:machineId', (): string => getMachineId())

  ipcMain.handle('license:activate', (_e, key: string) => {
    const machineId = getMachineId()
    const result = verifyLicense(key ?? '', machineId)
    if (!result.valid) return { success: false, error: result.reason }

    store.set(KEY, key.trim().replace(/\s+/g, ''))
    return { success: true, status: currentStatus() }
  })

  ipcMain.handle('license:deactivate', () => {
    store.delete(KEY)
    return { success: true }
  })
}
