// Compare this package's ASTC decoder with astcenc's, the reference, block
// by block. See README.md.
//
//   npx ts-node tests/oracle/compare-astc.ts ASTCENC [BLOCKS]
//
// For each of the fourteen 2D block sizes and each profile — LDR, sRGB and
// HDR — it makes an .astc file of blocks four ways: random bytes; random
// bytes under a block mode valid for the size, so more of them reach the
// endpoint and weight decoding; void-extent blocks; and blocks astcenc
// itself encoded from a test image, which is where partitions, dual planes
// and the endpoint modes an encoder really uses come from. astcenc decodes
// the file to a KTX — 8-bit for LDR and sRGB, half floats for HDR — and
// every texel is compared with this package's decoding of the same block.
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PNG } from '../vendor/pngjs/lib/png'
import { parseDDSHeader, parseKTXHeader, decodeImage, decodeImageFloat } from '../../src'
import { decodeASTCBytes, decodeASTCFloat, describeASTCBlock, type AstcProfile } from '../../src/decode/astc'

const astcenc = process.argv[2]!
const COUNT = Number(process.argv[3] ?? 3000)
const SIZES: Array<[number, number]> = [
    [4, 4], [5, 4], [5, 5], [6, 5], [6, 6], [8, 5], [8, 6], [8, 8],
    [10, 5], [10, 6], [10, 8], [10, 10], [12, 10], [12, 12],
]

function random(seed: number): () => number {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return (t ^ (t >>> 14)) >>> 0
    }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astc-'))
const run = (...args: string[]) => execFileSync(astcenc, args, { stdio: ['ignore', 'pipe', 'pipe'] })

// An .astc file: astcenc's own container.
function astcFile(bw: number, bh: number, blocks: Uint8Array[], across: number): Buffer {
    const down = Math.ceil(blocks.length / across)
    const header = Buffer.alloc(16)
    header.writeUInt32LE(0x5ca1ab13, 0)
    header[4] = bw
    header[5] = bh
    header[6] = 1
    header.writeUIntLE(across * bw, 7, 3)
    header.writeUIntLE(down * bh, 10, 3)
    header.writeUIntLE(1, 13, 3)
    const data = Buffer.alloc(across * down * 16)
    blocks.forEach((b, i) => data.set(b, i * 16))
    return Buffer.concat([header, data])
}

// Test images for astcenc to encode: gradients, flats, noise and edges, with
// alpha. The HDR one, as half floats in a KTX, runs up to about 60.
function testPng(file: string): void {
    const w = 96
    const h = 96
    const next = random(7)
    const data = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4
            const region = (x >> 5) + 3 * (y >> 5)
            const noise = () => next() & 255
            const px =
                region % 3 === 0 ? [x * 2, y * 2, 255 - x, 255 - y] :
                region % 3 === 1 ? [noise(), noise(), noise(), noise()] :
                [(x ^ y) & 16 ? 250 : 10, 128, (x * y) & 255, x < 48 ? 255 : 90]
            data.set(px, o)
        }
    fs.writeFileSync(file, PNG.sync.write({ width: w, height: h, data }))
}

function half(v: number): number {
    const f = new Float32Array([v])
    const b = new Uint32Array(f.buffer)[0]!
    const e = ((b >>> 23) & 0xff) - 127 + 15
    if (v === 0) return 0
    if (e <= 0) return 0
    if (e >= 31) return 0x7bff
    return ((b >>> 16) & 0x8000) | (e << 10) | ((b >>> 13) & 0x3ff)
}

function testHdrKtx(file: string): void {
    const w = 64
    const h = 64
    const next = random(11)
    const px = Buffer.alloc(w * h * 8)
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const values = (x >> 4) % 2
                ? [Math.pow(2, (x - 32) / 6), Math.pow(2, (y - 32) / 6), (next() % 1000) / 17, ((x + y) % 7) / 6]
                : [(next() % 6000) / 100, 0.01 * y, x * 0.9, 1]
            values.forEach((v, c) => px.writeUInt16LE(half(v), (y * w + x) * 8 + c * 2))
        }
    const header = Buffer.alloc(64)
    Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
    ;[0x04030201, 0x140b, 2, 0x1908, 0x881a, 0x1908, w, h, 0, 0, 1, 1, 0].forEach((v, i) => header.writeUInt32LE(v, 12 + i * 4))
    const size = Buffer.alloc(4)
    size.writeUInt32LE(px.length)
    fs.writeFileSync(file, Buffer.concat([header, size, px]))
}

testPng(path.join(dir, 'ldr.png'))
testHdrKtx(path.join(dir, 'hdr.ktx'))

let failures = 0
// What the comparison reached, over every size and profile.
const reached = { void: 0, error: 0, normal: 0, dual: 0, partitions: [0, 0, 0, 0, 0], cems: new Array(16).fill(0) }
for (const [bw, bh] of SIZES) {
    for (const profile of ['ldr', 'srgb', 'hdr'] as AstcProfile[]) {
        const next = random(bw * 100 + bh * 7 + profile.length)
        const blocks: Uint8Array[] = []
        const block = () => {
            const b = new Uint8Array(16)
            for (let i = 0; i < 16; i += 4) new DataView(b.buffer).setUint32(i, next())
            return b
        }
        // Random.
        for (let i = 0; i < COUNT; i++) blocks.push(block())
        // Random under a block mode with its low bits from real encodings'
        // favourites, so more of them are valid.
        for (let i = 0; i < COUNT; i++) {
            const b = block()
            const mode = [0x042, 0x053, 0x066, 0x0c2, 0x1e2, 0x4d2, 0x063, 0x142][i & 7]!
            b[0] = mode & 0xff
            b[1] = (b[1]! & 0xf8) | (mode >> 8)
            blocks.push(b)
        }
        // Void extent: LDR, HDR, with valid, invalid and all-ones extents.
        for (let i = 0; i < COUNT / 4; i++) {
            const b = block()
            b[0] = 0xfc
            b[1] = (b[1]! & 0xf0) | 0x0d | (i & 1 ? 0x02 : 0) // 0x1fc, bit 9 HDR, bits 10-11 = 11
            if (i % 5 === 0) for (let j = 2; j < 8; j++) b[j] = 0xff
            if (i % 7 === 0) b[1] = (b[1]! & 0xf1) // reserved bits wrong
            blocks.push(b)
        }
        // Encoded by astcenc.
        const encoded = path.join(dir, `enc-${bw}x${bh}-${profile}.astc`)
        const source = profile === 'hdr' ? path.join(dir, 'hdr.ktx') : path.join(dir, 'ldr.png')
        run(profile === 'hdr' ? '-cH' : profile === 'srgb' ? '-cs' : '-cl', source, encoded, `${bw}x${bh}`, '-medium', '-silent')
        const enc = fs.readFileSync(encoded).subarray(16)
        for (let i = 0; i + 16 <= enc.length; i += 16) blocks.push(new Uint8Array(enc.subarray(i, i + 16)))

        const across = 32
        const file = path.join(dir, `in-${bw}x${bh}-${profile}.astc`)
        // HDR as a DDS: astcenc writes its half floats there as RGBA always,
        // where a KTX gets as few channels as the image seems to need.
        const out = path.join(dir, `out-${bw}x${bh}-${profile}.${profile === 'hdr' ? 'dds' : 'ktx'}`)
        fs.writeFileSync(file, astcFile(bw, bh, blocks, across))
        const flag = profile === 'hdr' ? '-dH' : profile === 'srgb' ? '-ds' : '-dl'
        run(flag, file, out, ...(profile === 'ldr' ? ['-decode_unorm8'] : []), '-silent')

        const ktx = new Uint8Array(fs.readFileSync(out))
        const info = profile === 'hdr' ? parseDDSHeader(ktx) : parseKTXHeader(ktx)
        if (!info) throw new Error(`astcenc's output ${out} is not a file this package reads`)
        if (info.format !== (profile === 'hdr' ? 'RGBA16F' : 'RGBA8'))
            throw new Error(`astcenc wrote ${info.format}, not four channels: the comparison would be wrong`)
        const width = info.shape.width
        const theirs8 = profile === 'hdr' ? null : decodeImage(ktx, info.format, info.layers[0]!)
        const theirsF = profile === 'hdr' ? decodeImageFloat(ktx, info.format, info.layers[0]!) : null

        let wrong = 0
        let shown = 0
        blocks.forEach((b, n) => {
            const about = describeASTCBlock(b, bw, bh)
            reached[about.kind]++
            if (about.kind === 'normal') {
                reached.partitions[about.partitions!]++
                if (about.dual) reached.dual++
                for (const cem of about.cems!) reached.cems[cem]++
            }
            const bx = (n % across) * bw
            const by = Math.floor(n / across) * bh
            const ours8 = profile === 'hdr' ? null : decodeASTCBytes(b, bw, bh, profile)
            const oursF = profile === 'hdr' ? decodeASTCFloat(b, bw, bh, profile) : null
            for (let y = 0; y < bh; y++)
                for (let x = 0; x < bw; x++) {
                    const o = (y * bw + x) * 4
                    const t = ((by + y) * width + bx + x) * 4
                    for (let c = 0; c < 4; c++) {
                        const ok = oursF
                            ? Object.is(oursF[o + c], theirsF![t + c]) || (Number.isNaN(oursF[o + c]!) && Number.isNaN(theirsF![t + c]!))
                            : ours8![o + c] === theirs8![t + c]
                        if (!ok) {
                            wrong++
                            if (shown++ < 3)
                                console.log(`  ${bw}x${bh} ${profile} block ${n} texel ${x},${y} channel ${c}: ours ${oursF ? oursF[o + c] : ours8![o + c]} theirs ${oursF ? theirsF![t + c] : theirs8![t + c]}  ${Buffer.from(b).toString('hex')}`)
                        }
                    }
                }
        })
        console.log(`${`${bw}x${bh}`.padEnd(6)} ${profile.padEnd(5)} ${blocks.length} blocks (${enc.length / 16} encoded): ${wrong === 0 ? 'identical' : `${wrong} values DIFFERENT`}`)
        failures += wrong
    }
}
fs.rmSync(dir, { recursive: true })
console.log(`
reached: ${reached.normal} valid blocks, ${reached.error} not valid, ${reached.void} void extent`)
console.log(`  partitions 1-4: ${reached.partitions.slice(1).join(', ')}; dual plane: ${reached.dual}`)
console.log(`  endpoint modes 0-15: ${reached.cems.join(', ')}`)
process.exit(failures ? 1 : 0)
