// ASTC.
//
// The decoder was compared with astcenc, ARM's reference, texel by texel:
// every 2D block size in LDR, sRGB and HDR, on random blocks, blocks under a
// valid mode, void-extent blocks and blocks astcenc encoded — 90,000 valid
// blocks reaching every endpoint mode, 1 to 4 partitions and dual planes,
// and 170,000 not valid — and matched on every value (see tests/oracle).
//
// What stays here without astcenc:
// - fixtures astcenc encoded, held to the digest of astcenc's own decoding
//   of them (tests/golden/astc.json);
// - the seeded blocks of that comparison, held to digests of this package's
//   decoding once it matched;
// - the unquantization tables, which matched astcenc's entry for entry.
import * as crypto from 'crypto'
import * as fs from 'fs'
import {
    ASTC_SIZES,
    decodeImage,
    decodeImageFloat,
    parseASTCHeader,
    parseKTX2Header,
    parseKTXHeader,
    readImageInfo,
    inMemory,
    type ImageFormat,
} from '../src'
import {
    COLOUR_TABLES,
    WEIGHT_TABLES,
    decodeASTCBytes,
    decodeASTCFloat,
    lnsToHalf,
    unorm16ToHalf,
    type AstcProfile,
} from '../src/decode/astc'
import { ktx, ktx2 } from './helpers/make'

const golden: Record<string, string> = JSON.parse(fs.readFileSync('tests/golden/astc.json', 'utf8'))

function digestOf(values: Uint8Array | Float32Array): string {
    const copy = values instanceof Float32Array ? Float32Array.from(values, (v) => (Number.isNaN(v) ? -1e30 : v)) : values
    return crypto.createHash('sha256').update(new Uint8Array(copy.buffer, copy.byteOffset, copy.byteLength)).digest('hex')
}

describe('fixtures astcenc encoded decode as astcenc decodes them', () => {
    for (const [name, digest] of Object.entries(golden)) {
        test(name, () => {
            const bytes = new Uint8Array(fs.readFileSync(`tests/resources/astc/${name}`))
            const info = parseASTCHeader(bytes)!
            const profile = name.replace(/^.*-|\.astc$/g, '')
            // An .astc file does not say sRGB or HDR; the name does.
            const format = `${info.format}${profile === 'srgb' ? '_SRGB' : profile === 'hdr' ? '_HDR' : ''}` as ImageFormat
            const decoded = profile === 'hdr' ? decodeImageFloat(bytes, format, info.layers[0]) : decodeImage(bytes, format, info.layers[0])
            expect(digestOf(decoded)).toBe(digest)
        })
    }
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

// The comparison's three kinds of generated block, 200 of each, for a size
// and profile, decoded, as one digest.
function seeded(bw: number, bh: number, profile: AstcProfile): string {
    const next = random(bw * 100 + bh * 7 + profile.length)
    const hash = crypto.createHash('sha256')
    const block = () => {
        const b = new Uint8Array(16)
        for (let i = 0; i < 16; i += 4) new DataView(b.buffer).setUint32(i, next())
        return b
    }
    const blocks: Uint8Array[] = []
    for (let i = 0; i < 200; i++) blocks.push(block())
    for (let i = 0; i < 200; i++) {
        const b = block()
        const mode = [0x042, 0x053, 0x066, 0x0c2, 0x1e2, 0x4d2, 0x063, 0x142][i & 7]
        b[0] = mode & 0xff
        b[1] = (b[1] & 0xf8) | (mode >> 8)
        blocks.push(b)
    }
    for (let i = 0; i < 50; i++) {
        const b = block()
        b[0] = 0xfc
        b[1] = (b[1] & 0xf0) | 0x0d | (i & 1 ? 0x02 : 0)
        if (i % 5 === 0) for (let j = 2; j < 8; j++) b[j] = 0xff
        if (i % 7 === 0) b[1] = b[1] & 0xf1
        blocks.push(b)
    }
    for (const b of blocks) {
        const d = profile === 'hdr' ? decodeASTCFloat(b, bw, bh, profile) : decodeASTCBytes(b, bw, bh, profile)
        const f = d instanceof Float32Array ? Float32Array.from(d, (v) => (Number.isNaN(v) ? -1e30 : v)) : d
        hash.update(new Uint8Array(f.buffer, f.byteOffset, f.byteLength))
    }
    return hash.digest('hex')
}

// Recorded once the comparison with astcenc matched on every value.
const SEEDED = 'c0fff170d0b12d49bb8ad4d6b31105f0f3bd8511bd3d0d3dafcd968a7ec3ebd2'

test('generated blocks, every size and profile, decode as when compared with astcenc', () => {
    const all = crypto.createHash('sha256')
    for (const size of ASTC_SIZES) {
        const [w, h] = size.split('x').map(Number)
        for (const profile of ['ldr', 'srgb', 'hdr'] as AstcProfile[]) all.update(seeded(w, h, profile))
    }
    expect(all.digest('hex')).toBe(SEEDED)
})

test('the unquantization tables, which matched astcenc entry for entry', () => {
    // A few rows by value, and all of them by digest.
    expect(COLOUR_TABLES[4]).toEqual([0, 255, 51, 204, 102, 153])
    expect(COLOUR_TABLES[5]).toEqual([0, 36, 73, 109, 146, 182, 219, 255])
    expect(WEIGHT_TABLES[1]).toEqual([0, 32, 64])
    expect(WEIGHT_TABLES[2]).toEqual([0, 21, 43, 64])
    expect(crypto.createHash('sha256').update(JSON.stringify([COLOUR_TABLES, WEIGHT_TABLES])).digest('hex')).toBe('ae06a64d0d141edbc9fdfb4843d11de5a86337eaed99b7884ba7b254c17f91ae')
})

test('half-float conversions', () => {
    expect(unorm16ToHalf(0xffff)).toBe(0x3c00) // 1.0
    expect(unorm16ToHalf(0x8000)).toBe(0x3800) // 0.5
    expect(unorm16ToHalf(0)).toBe(0)
    expect(lnsToHalf(0)).toBe(0)
    // LNS saturates at the largest finite half.
    expect(lnsToHalf(0xffff)).toBe(0x7bff)
})

describe('in files', () => {
    const block = new Uint8Array(fs.readFileSync('tests/resources/astc/4x4-ldr.astc').subarray(16, 32))

    test('KTX 1: LDR from 0x93B0, sRGB from 0x93D0', () => {
        const a = parseKTXHeader(ktx({ internalFormat: 0x93b0, width: 4, height: 4, levels: [block] }))
        expect([a?.format, a?.srgb]).toEqual(['ASTC_4x4', false])
        const b = parseKTXHeader(ktx({ internalFormat: 0x93dd, width: 12, height: 12, levels: [block] }))
        expect([b?.format, b?.srgb]).toEqual(['ASTC_12x12_SRGB', true])
    })

    test('KTX 2: UNORM and SRGB in turn from 157, SFLOAT from 1000066000', () => {
        const cases: Array<[number, string, boolean]> = [
            [157, 'ASTC_4x4', false],
            [158, 'ASTC_4x4_SRGB', true],
            [171, 'ASTC_8x8', false],
            [184, 'ASTC_12x12_SRGB', true],
            [1000066000, 'ASTC_4x4_HDR', false],
            [1000066013, 'ASTC_12x12_HDR', false],
        ]
        for (const [vk, format, srgb] of cases) {
            const [w, h] = format.replace(/^ASTC_|_.*$/g, '').split('x').map(Number)
            const info = parseKTX2Header(ktx2({ vkFormat: vk, width: w, height: h, levels: [block] }))
            expect([info?.format, info?.srgb]).toEqual([format, srgb])
        }
    })

    test('an .astc file, read by range as the others are', async () => {
        const bytes = new Uint8Array(fs.readFileSync('tests/resources/astc/8x8-ldr.astc'))
        const info = (await readImageInfo(inMemory(bytes), bytes.length))!
        expect([info.container, info.format, info.shape]).toEqual(['astc', 'ASTC_8x8', { width: 48, height: 40 }])
        // 48 × 40 in 8 × 8 blocks: 6 × 5 of them.
        expect(info.layers[0].length).toBe(6 * 5 * 16)
    })

    test('an .astc file that says more than it holds is refused', () => {
        const bytes = new Uint8Array(fs.readFileSync('tests/resources/astc/8x8-ldr.astc'))
        const lying = bytes.slice()
        lying[7] = 0xff // wider than the blocks there are
        expect(parseASTCHeader(lying)).toBeUndefined()
        const odd = bytes.slice()
        odd[4] = 7 // 7 × 8 is not an ASTC block size
        expect(parseASTCHeader(odd)).toBeUndefined()
    })
})
