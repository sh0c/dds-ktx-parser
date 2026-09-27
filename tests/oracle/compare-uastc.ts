// Compare this package's UASTC decoder with KTX-Software's, block by block.
// See README.md.
//
//   KTX="path/to/ktx" npx ts-node tests/oracle/compare-uastc.ts
//   KTX="wsl -d Ubuntu-22.04 -- /path/to/ktx" npx ts-node tests/oracle/compare-uastc.ts
//
// `ktx create --encode uastc` encodes generated test images — colour and
// alpha, opaque, grey and alpha — at every quality level, linear and sRGB,
// with and without RDO; `ktx transcode --target rgba8` decodes them; and
// every texel is compared with this package's decoding of the same block.
// Then the same again with the blocks replaced by random ones of every
// valid mode.
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PNG } from '../vendor/pngjs/lib/png'
import { decodeImage, parseKTX2Header } from '../../src'
import { decodeUASTCBlock } from '../../src/decode/uastc'

const [tool, ...prefix] = (process.env.KTX ?? 'ktx').split(' ')
const viaWsl = tool === 'wsl'
// A Windows path as WSL sees it, when ktx runs there.
const toolPath = (p: string): string =>
    viaWsl ? p.replace(/^([A-Za-z]):/, (_, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/') : p
const ktx = (...args: string[]) =>
    execFileSync(tool!, [...prefix, ...args.map((a) => (a.includes(path.sep) || /^[A-Za-z]:/.test(a) ? toolPath(a) : a))], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })

function random(seed: number): () => number {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return (t ^ (t >>> 14)) >>> 0
    }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uastc-'))
const W = 64
const H = 64

type Kind = 'rgba' | 'opaque' | 'grey-alpha' | 'smooth'
function image(kind: Kind): string {
    const next = random(kind.length * 13)
    const data = Buffer.alloc(W * H * 4)
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const region = (x >> 4) + 4 * (y >> 4)
            let px: number[]
            if (kind === 'smooth') px = [x * 4, y * 4, 255 - (x + y) * 2, 255]
            else if (region % 3 === 0) px = [x * 4, y * 4, 255 - x * 2, 255 - y * 3]
            else if (region % 3 === 1) px = [next() & 255, next() & 255, next() & 255, next() & 255]
            else px = [(x ^ y) & 8 ? 230 : 25, 120, (x * y) & 255, x < 32 ? 255 : 60]
            if (kind === 'opaque') px[3] = 255
            if (kind === 'grey-alpha') px = [px[0]!, px[0]!, px[0]!, px[3]!]
            data.set(px, (y * W + x) * 4)
        }
    const file = path.join(dir, `${kind}.png`)
    fs.writeFileSync(file, PNG.sync.write({ width: W, height: H, data }))
    return file
}

// The blocks of level 0 of a KTX 2 written without supercompression.
function blocksOf(file: string): { bytes: Buffer; offset: number; length: number } {
    const bytes = fs.readFileSync(file)
    const offset = Number(bytes.readBigUInt64LE(80))
    const length = Number(bytes.readBigUInt64LE(88))
    if (bytes.readUInt32LE(44) !== 0) throw new Error('supercompressed; the harness reads stored levels')
    return { bytes, offset, length }
}

// Compare every block of @encoded with ktx's transcoding of it.
function compare(label: string, encoded: string, srgb: boolean): number {
    const rgba = encoded.replace(/\.ktx2$/, '.rgba.ktx2')
    ktx('transcode', '--target', 'rgba8', encoded, rgba)
    const theirsFile = new Uint8Array(fs.readFileSync(rgba))
    const theirsInfo = parseKTX2Header(theirsFile)!
    const theirs = decodeImage(theirsFile, theirsInfo.format, theirsInfo.layers[0]!)
    const { bytes, offset, length } = blocksOf(encoded)
    const file = new Uint8Array(bytes)
    const info = parseKTX2Header(file)!
    if (!/^UASTC_/.test(info.format)) throw new Error(`read as ${info.format}`)
    // The transfer function does not change how UASTC decodes: Basis's own
    // transcoder decodes sRGB and linear alike, and so does this package.
    void srgb
    const all = decodeImage(file, info.format, info.layers[0]!)
    let wrong = 0
    for (let b = 0; b < length / 16; b++) {
        const block = new Uint8Array(bytes.subarray(offset + b * 16, offset + b * 16 + 16))
        const bx0 = (b % (W / 4)) * 4
        const by0 = Math.floor(b / (W / 4)) * 4
        const ours = new Uint8Array(64)
        for (let i = 0; i < 16; i++) ours.set(all.subarray(((by0 + (i >> 2)) * W + bx0 + (i & 3)) * 4, ((by0 + (i >> 2)) * W + bx0 + (i & 3)) * 4 + 4), i * 4)
        const bx = (b % (W / 4)) * 4
        const by = Math.floor(b / (W / 4)) * 4
        for (let i = 0; i < 16; i++)
            for (let c = 0; c < 4; c++) {
                const t = theirs[((by + (i >> 2)) * W + bx + (i & 3)) * 4 + c]
                if (ours[i * 4 + c] !== t) {
                    if (wrong++ < 3) console.log(`  ${label} block ${b} texel ${i} channel ${c}: ours ${ours[i * 4 + c]} theirs ${t}  ${Buffer.from(block).toString('hex')}`)
                }
            }
    }
    console.log(`${label.padEnd(40)} ${info.format.padEnd(10)} ${info.channels.padEnd(4)} ${length / 16} blocks: ${wrong === 0 ? 'identical' : `${wrong} values DIFFERENT`}`)
    return wrong
}

let failures = 0
const encodedFiles: Array<[string, boolean]> = []
for (const kind of ['rgba', 'opaque', 'grey-alpha', 'smooth'] as Kind[]) {
    const png = image(kind)
    for (const srgb of [false, true])
        for (const quality of ['0', '2', '4', 'rdo']) {
            const out = path.join(dir, `${kind}-${srgb ? 'srgb' : 'linear'}-${quality}.ktx2`)
            ktx(
                'create',
                '--format', srgb ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM',
                '--assign-tf', srgb ? 'srgb' : 'linear',
                '--encode', 'uastc',
                ...(quality === 'rdo' ? ['--uastc-quality', '2', '--uastc-rdo'] : ['--uastc-quality', quality]),
                png, out,
            )
            encodedFiles.push([out, srgb])
            failures += compare(`${kind} ${srgb ? 'sRGB' : 'linear'} quality ${quality}`, out, srgb)
        }
}

// Random blocks of every mode, in place of an encoded file's.
const MODE_CODES: Array<[number, number]> = [
    [0x1, 4], [0x35, 6], [0x1d, 5], [0x3, 5], [0x13, 5], [0xb, 5], [0x1b, 5], [0x7, 5], [0x17, 5], [0xf, 5],
    [0x2, 3], [0x0, 2], [0x6, 3], [0x1f, 5], [0xd, 5], [0x5, 7], [0x15, 6], [0x25, 6], [0x9, 4],
]
for (const [template, srgb] of encodedFiles.filter((_, i) => i % 4 === 0)) {
    const { bytes, offset, length } = blocksOf(template)
    const next = random(length + (srgb ? 1 : 0))
    const copy = Buffer.from(bytes)
    for (let b = 0; b < length / 16; b++) {
        const block = copy.subarray(offset + b * 16, offset + b * 16 + 16)
        for (let i = 0; i < 16; i += 4) block.writeUInt32LE(next(), i)
        const [code, bits] = MODE_CODES[b % MODE_CODES.length]!
        block[0] = (block[0]! & ~((1 << bits) - 1)) | code
        // Keep a pattern number in range: the mode's pattern bits come
        // straight after its hints, and a random one is often too large.
        // A block the transcoder refuses would fail the whole file.
        const ours = decodeUASTCBlock(new Uint8Array(block), srgb)
        if (ours[0] === 255 && ours[1] === 0 && ours[2] === 255 && ours[3] === 255) block.fill(0).writeUInt8(0x17, 0) // mode 8, solid
    }
    const file = template.replace(/\.ktx2$/, '.random.ktx2')
    fs.writeFileSync(file, copy)
    failures += compare(`random blocks of every mode, ${srgb ? 'sRGB' : 'linear'}`, file, srgb)
}

fs.rmSync(dir, { recursive: true })
process.exit(failures ? 1 : 0)
