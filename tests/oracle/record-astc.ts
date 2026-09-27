// Record the ASTC fixtures and what astcenc decodes them to. See README.md.
//
//   npx ts-node tests/oracle/record-astc.ts ASTCENC
//
// Encodes the generated test images with astcenc at several block sizes and
// profiles into tests/resources/astc/, decodes each back with astcenc, and
// writes tests/golden/astc.json: the digest of astcenc's decoding of each
// fixture, which tests/astc.test.ts holds this package's decoding to — so
// that test compares with astcenc without needing it.
import { execFileSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PNG } from '../vendor/pngjs/lib/png'
import { decodeImage, decodeImageFloat, parseDDSHeader, parseKTXHeader } from '../../src'

const astcenc = process.argv[2]!
const run = (...args: string[]) => execFileSync(astcenc, args, { stdio: ['ignore', 'pipe', 'pipe'] })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astc-rec-'))

function random(seed: number): () => number {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return (t ^ (t >>> 14)) >>> 0
    }
}

// Gradients, noise and hard edges, with alpha; 48 × 40, so no block size
// divides it evenly and the edge blocks are partial.
const W = 48
const H = 40
const ldr = Buffer.alloc(W * H * 4)
{
    const next = random(3)
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const r = (x >> 4) + 3 * (y >> 4)
            const px = r % 3 === 0 ? [x * 5, y * 6, 255 - x * 3, 255 - y * 2] : r % 3 === 1 ? [next() & 255, next() & 255, next() & 255, next() & 255] : [(x ^ y) & 8 ? 240 : 20, 100, (x * y) & 255, x < 24 ? 255 : 70]
            ldr.set(px, (y * W + x) * 4)
        }
    fs.writeFileSync(path.join(dir, 'ldr.png'), PNG.sync.write({ width: W, height: H, data: ldr }))
}
{
    const next = random(5)
    const half = (v: number): number => {
        const b = new Uint32Array(new Float32Array([v]).buffer)[0]!
        const e = ((b >>> 23) & 0xff) - 127 + 15
        return v === 0 || e <= 0 ? 0 : e >= 31 ? 0x7bff : ((b >>> 16) & 0x8000) | (e << 10) | ((b >>> 13) & 0x3ff)
    }
    const px = Buffer.alloc(W * H * 8)
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const v = (x >> 3) % 2 ? [Math.pow(2, (x - 24) / 4), Math.pow(2, (y - 20) / 4), (next() % 900) / 13, (x % 5) / 4] : [(next() % 5000) / 90, y * 0.02, x * 1.3, 1]
            v.forEach((f, c) => px.writeUInt16LE(half(f), (y * W + x) * 8 + c * 2))
        }
    const header = Buffer.alloc(64)
    Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
    ;[0x04030201, 0x140b, 2, 0x1908, 0x881a, 0x1908, W, H, 0, 0, 1, 1, 0].forEach((v, i) => header.writeUInt32LE(v, 12 + i * 4))
    const size = Buffer.alloc(4)
    size.writeUInt32LE(px.length)
    fs.writeFileSync(path.join(dir, 'hdr.ktx'), Buffer.concat([header, size, px]))
}

export const FIXTURES: Array<[string, 'ldr' | 'srgb' | 'hdr']> = [
    ['4x4', 'ldr'],
    ['5x4', 'srgb'],
    ['6x6', 'hdr'],
    ['8x8', 'ldr'],
    ['10x5', 'hdr'],
    ['12x12', 'srgb'],
    ['6x5', 'ldr'],
    ['10x10', 'hdr'],
]

// A digest of decoded pixels, NaN as one value whatever its bits.
export function digestOf(values: Uint8Array | Float32Array): string {
    const copy = values instanceof Float32Array ? Float32Array.from(values, (v) => (Number.isNaN(v) ? -1e30 : v)) : values
    return crypto.createHash('sha256').update(new Uint8Array(copy.buffer, copy.byteOffset, copy.byteLength)).digest('hex')
}

const out: Record<string, string> = {}
fs.mkdirSync('tests/resources/astc', { recursive: true })
for (const [size, profile] of FIXTURES) {
    const name = `${size}-${profile}.astc`
    const fixture = path.join('tests/resources/astc', name)
    run(profile === 'hdr' ? '-cH' : profile === 'srgb' ? '-cs' : '-cl', path.join(dir, profile === 'hdr' ? 'hdr.ktx' : 'ldr.png'), fixture, size, '-medium', '-silent')
    const decoded = path.join(dir, `${name}.${profile === 'hdr' ? 'dds' : 'ktx'}`)
    run(profile === 'hdr' ? '-dH' : profile === 'srgb' ? '-ds' : '-dl', fixture, decoded, ...(profile === 'ldr' ? ['-decode_unorm8'] : []), '-silent')
    const bytes = new Uint8Array(fs.readFileSync(decoded))
    const info = (profile === 'hdr' ? parseDDSHeader(bytes) : parseKTXHeader(bytes))!
    if (info.format !== (profile === 'hdr' ? 'RGBA16F' : 'RGBA8')) throw new Error(`astcenc wrote ${info.format}`)
    out[name] = digestOf(profile === 'hdr' ? decodeImageFloat(bytes, info.format, info.layers[0]!) : decodeImage(bytes, info.format, info.layers[0]!))
    console.log(name, fs.statSync(fixture).size, 'bytes')
}
fs.writeFileSync('tests/golden/astc.json', JSON.stringify(out, null, 2) + '\n')
fs.rmSync(dir, { recursive: true })
