import { IpcMain, dialog, shell } from 'electron'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import * as fs from 'fs'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { parseIIF, generateIIF, generateDepositIIF } from '../files/iif'
import Store from 'electron-store'

const store = new Store()

export function registerFileHandlers(ipcMain: IpcMain): void {
  // Open file dialog
  ipcMain.handle('files:openDialog', async (_, options) => {
    const result = await dialog.showOpenDialog(options)
    return result
  })

  // Save file dialog
  ipcMain.handle('files:saveDialog', async (_, options) => {
    const result = await dialog.showSaveDialog(options)
    return result
  })

  // Parse uploaded file (Excel, CSV, IIF, TXT)
  ipcMain.handle('files:parse', async (_, filePath: string) => {
    try {
      const ext = path.extname(filePath).toLowerCase()

      if (ext === '.iif') {
        const content = fs.readFileSync(filePath, 'utf-8')
        return { success: true, data: parseIIF(content) }
      }

      if (ext === '.csv' || ext === '.txt') {
        const content = fs.readFileSync(filePath, 'utf-8')
        const result = Papa.parse(content, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false
        })
        return {
          success: true,
          data: {
            headers: result.meta.fields || [],
            rows: result.data as Record<string, string>[]
          }
        }
      }

      // Excel files: xls, xlsx, xlsm
      if (['.xls', '.xlsx', '.xlsm'].includes(ext)) {
        // cellDates:true lets SheetJS detect date cells; we also catch bare
        // Excel serial numbers (e.g. 46007 → 02/27/2026) in the post-pass.
        const workbook = XLSX.readFile(filePath, { cellDates: true })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
          defval: '',
          raw: false,
          dateNF: 'MM/DD/YYYY'
        })

        // Normalise every cell to a string; convert Date objects and bare
        // Excel serial-date numbers to MM/DD/YYYY so formatDate() can use them.
        const toMMDDYYYY = (d: Date): string => {
          const m = d.getUTCMonth() + 1
          const day = d.getUTCDate()
          const y = d.getUTCFullYear()
          return `${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}/${y}`
        }

        const rows: Record<string, string>[] = json.map((row) => {
          const out: Record<string, string> = {}
          for (const [key, val] of Object.entries(row)) {
            if (val instanceof Date) {
              out[key] = toMMDDYYYY(val)
            } else if (typeof val === 'number' && Number.isInteger(val) && val > 40_000 && val < 60_000) {
              // Bare Excel serial date number — convert via epoch offset
              out[key] = toMMDDYYYY(new Date((val - 25569) * 86400 * 1000))
            } else {
              out[key] = val == null ? '' : String(val)
            }
          }
          return out
        })

        const headers = rows.length > 0 ? Object.keys(rows[0]) : []
        return { success: true, data: { headers, rows } }
      }

      return { success: false, error: `Unsupported file type: ${ext}` }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Export to Excel
  ipcMain.handle(
    'files:exportExcel',
    async (_, data: Record<string, unknown>[], headers: string[], filePath: string) => {
      try {
        const worksheet = XLSX.utils.json_to_sheet(data, { header: headers })
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions')
        XLSX.writeFile(workbook, filePath)
        return { success: true }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Generate IIF file content (generic)
  ipcMain.handle(
    'files:generateIIF',
    async (_, transactions: Record<string, string>[], type: string) => {
      try {
        const content = generateIIF(transactions, type)
        return { success: true, content }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Generate Deposit-specific IIF — places NAME on both TRNS (bank/debit) and SPL
  // (income/credit) lines so QB shows the payee on both sides of the GL.
  // This is the only way to match what QB's Batch Enter Transactions produces
  // because QBXML DepositAdd has no header-level EntityRef.
  ipcMain.handle(
    'files:generateDepositIIF',
    async (_, transactions: Record<string, string>[]) => {
      try {
        const content = generateDepositIIF(transactions)
        return { success: true, content }
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Save IIF file
  ipcMain.handle('files:saveIIF', async (_, content: string, filePath: string) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Show a file highlighted in Windows Explorer (used for IIF deposits)
  ipcMain.handle('files:showInFolder', async (_, filePath: string) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })

  // Parse a QuickBooks General Ledger PDF and extract accounts/customers/vendors.
  // Spawns the bundled Python script (parse_gl.py) which uses pypdf.
  ipcMain.handle('files:parseGLPdf', async (_, pdfPath: string) => {
    try {
      // Locate the Python script — works in dev (src/) and production (resources/)
      const scriptCandidates = [
        path.join(__dirname, '../../src/main/files/parse_gl.py'),  // dev
        path.join(process.resourcesPath ?? '', 'parse_gl.py'),      // production
        path.join(__dirname, 'parse_gl.py')                         // same dir
      ]
      const scriptPath = scriptCandidates.find((p) => fs.existsSync(p))
      if (!scriptPath) {
        return { success: false, error: 'parse_gl.py not found — ensure Python & pypdf are installed.' }
      }

      // Try python3 first, fall back to python
      for (const cmd of ['python3', 'python']) {
        const result = spawnSync(cmd, [scriptPath, pdfPath], {
          encoding: 'utf-8',
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024
        })
        if (result.status === 0 && result.stdout) {
          try {
            const data = JSON.parse(result.stdout)
            if (data.error) return { success: false, error: data.error }
            return { success: true, data }
          } catch {
            return { success: false, error: 'Invalid JSON from GL parser.' }
          }
        }
        if (result.status !== null && result.status !== 0) {
          // Python found but script errored — surface the stderr message
          const msg = result.stderr?.trim() || `Exit code ${result.status}`
          return { success: false, error: msg }
        }
        // status null = command not found, try next
      }
      return {
        success: false,
        error: 'Python not found. Install Python 3 and run: pip install pypdf'
      }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // History handlers
  ipcMain.handle('history:getAll', async () => {
    return store.get('history', [])
  })

  ipcMain.handle('history:add', async (_, entry: unknown) => {
    const history = (store.get('history', []) as unknown[])
    const newEntry = { ...(entry as object), id: Date.now(), timestamp: new Date().toISOString() }
    store.set('history', [newEntry, ...history].slice(0, 500))
    return { success: true }
  })

  ipcMain.handle('history:clear', async () => {
    store.set('history', [])
    return { success: true }
  })
}
