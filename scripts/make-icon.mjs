/**
 * Generate resources/icon.ico with no image dependencies.
 *
 * Draws a rounded-square app mark — the brand indigo→violet gradient with a
 * white pulse trace — at every size Windows asks for, encodes each as PNG,
 * and wraps them in an ICO container (PNG-in-ICO, supported since Vista).
 *
 * Run: npm run make-icon
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SIZES = [16, 24, 32, 48, 64, 128, 256]

// ── PNG encoding ────────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  // 10..12 = compression / filter / interlace, all 0

  // Raw scanlines, each prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── The mark ────────────────────────────────────────────────────────────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/** Distance from p to segment ab, all in normalised units. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / lenSq)
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

// ECG-style pulse trace
const TRACE = [
  [0.14, 0.5], [0.33, 0.5], [0.40, 0.31], [0.50, 0.71], [0.60, 0.40], [0.67, 0.5], [0.86, 0.5]
]

function renderMark(size) {
  const buf = Buffer.alloc(size * size * 4)
  const aa = 1.2 / size // ~1px feather
  const radius = 0.22 // rounded-square corner radius, normalised

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size

      // Rounded-square signed distance, centred
      const dx = Math.abs(u - 0.5) - (0.5 - radius)
      const dy = Math.abs(v - 0.5) - (0.5 - radius)
      const outside =
        Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius
      const shape = 1 - smoothstep(-aa, aa, outside)

      // Brand gradient #6366F1 → #8B5CF6 along the diagonal
      const g = clamp01((u + v) / 2)
      let r = Math.round(99 + (139 - 99) * g)
      let gr = Math.round(102 + (92 - 102) * g)
      let b = Math.round(241 + (246 - 241) * g)

      // Pulse trace in white
      let best = Infinity
      for (let i = 0; i < TRACE.length - 1; i++) {
        const d = distToSegment(u, v, TRACE[i][0], TRACE[i][1], TRACE[i + 1][0], TRACE[i + 1][1])
        if (d < best) best = d
      }
      const stroke = 1 - smoothstep(0.036, 0.036 + aa * 1.6, best)
      r = Math.round(r + (255 - r) * stroke)
      gr = Math.round(gr + (255 - gr) * stroke)
      b = Math.round(b + (255 - b) * stroke)

      const o = (y * size + x) * 4
      buf[o] = r
      buf[o + 1] = gr
      buf[o + 2] = b
      buf[o + 3] = Math.round(shape * 255)
    }
  }
  return buf
}

// ── ICO container ───────────────────────────────────────────────────────────
const pngs = SIZES.map((s) => ({ size: s, data: encodePng(s, renderMark(s)) }))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type 1 = icon
header.writeUInt16LE(pngs.length, 4)

const DIR_ENTRY = 16
let offset = header.length + pngs.length * DIR_ENTRY
const entries = pngs.map(({ size, data }) => {
  const e = Buffer.alloc(DIR_ENTRY)
  e[0] = size >= 256 ? 0 : size // 0 means 256
  e[1] = size >= 256 ? 0 : size
  e[2] = 0 // palette colours
  e[3] = 0 // reserved
  e.writeUInt16LE(1, 4) // colour planes
  e.writeUInt16LE(32, 6) // bits per pixel
  e.writeUInt32LE(data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += data.length
  return e
})

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'resources'), { recursive: true })
const out = join(root, 'resources', 'icon.ico')
writeFileSync(out, Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]))

console.log(`Wrote ${out}`)
console.log(`  ${pngs.length} sizes: ${SIZES.join(', ')}`)
