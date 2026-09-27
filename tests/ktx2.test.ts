// KTX 2: every KTX 1 fixture wrapped again as KTX 2 — stored as it is, and
// supercompressed with Zstandard and with zlib — decodes to exactly what the
// KTX 1 does; the formats KTX 2 brings; reading by range; and files that lie.
//
// The Zstandard and zlib data here is made with Node's own zlib, in the
// tests only. The package decompresses with the code vendored under
// src/vendor, which has nothing to do with Node's.
import * as fs from 'fs'
import * as zlib from 'zlib'
import {
    ImageInfo,
    decodeImage,
    decodeImageFloat,
    describeKTX2,
    detectContainer,
    findLayer,
    inMemory,
    parseDDSHeader,
    parseKTX2Header,
    parseKTXHeader,
    readImageInfo,
    readLayer,
} from '../src'
import { counting, dds, f32s, half, ktx2, u16s } from './helpers/make'

const zstd = (bytes: Uint8Array): Uint8Array => new Uint8Array((zlib as any).zstdCompressSync(bytes))
const deflate = (bytes: Uint8Array): Uint8Array => new Uint8Array(zlib.deflateSync(bytes))

const vkOf: Record<string, number> = { BC1: 131, BC2: 135, BC3: 137, BC4: 139, BC5: 141, BC6H: 143, BC7: 145 }

async function decodeAll(file: Uint8Array, info: ImageInfo): Promise<Uint8Array[]> {
    const out: Uint8Array[] = []
    for (const layer of info.layers)
        out.push(decodeImage(await readLayer(inMemory(file), layer), info.format, { ...layer, offset: 0 }))
    return out
}

const schemes: Array<[string, number, ((b: Uint8Array) => Uint8Array) | undefined]> = [
    ['stored', 0, undefined],
    ['Zstandard', 2, zstd],
    ['zlib', 3, deflate],
]

for (const name of fs.readdirSync('tests/resources/ktx').sort()) {
    for (const [label, scheme, compress] of schemes) {
        test(`${name} as KTX 2, ${label}: every level as the KTX 1 decodes it`, async () => {
            const one = new Uint8Array(fs.readFileSync(`tests/resources/ktx/${name}`))
            const first = parseKTXHeader(one)!
            const levels = first.layers.map((l) => one.slice(l.offset, l.offset + l.length))
            const file = ktx2({
                vkFormat: vkOf[first.format],
                width: first.shape.width,
                height: first.shape.height,
                levels,
                scheme,
                compress,
            })
            const info = (await readImageInfo(inMemory(file), file.length))!
            expect(info.container).toBe('ktx2')
            expect(info.format).toBe(first.format)
            expect(info.supercompression).toBe(['none', '', 'zstd', 'zlib'][scheme])
            const want = first.layers.map((l) => decodeImage(one, first.format, l))
            const got = await decodeAll(file, info)
            expect(got.length).toBe(want.length)
            // Buffer.compare, not toEqual: Jest walks a typed array an element
            // at a time, which took eight seconds a fixture.
            got.forEach((level, i) => expect(Buffer.compare(level, want[i])).toBe(0))
        })
    }
}

describe('what a KTX 2 file is read with', () => {
    // A texture of more levels than fit in the first read, so that its level
    // index needs a second.
    const levels = [16, 8, 4, 2, 1].map((size) => new Uint8Array(size * size * 4).fill(size))
    const file = ktx2({ vkFormat: 37, width: 16, height: 16, levels })

    test('the header and level index, and one level: no more', async () => {
        const reader = counting(file)
        const info = (await readImageInfo(reader.read, file.length))!
        expect(info.levels).toBe(5)
        expect(reader.asked).toEqual([[0, 148], [0, 80 + 5 * 24]])
        reader.asked.length = 0
        const layer = findLayer(info, 3)!
        expect(Array.from(await readLayer(reader.read, layer))).toEqual(Array.from(levels[3]))
        expect(reader.asked).toEqual([[layer.offset, 2 * 2 * 4]])
    })

    test('a supercompressed level is read whole, stored size only, and decompressed', async () => {
        const packed = ktx2({ vkFormat: 37, width: 16, height: 16, levels, scheme: 2, compress: zstd })
        const reader = counting(packed)
        const info = (await readImageInfo(reader.read, packed.length))!
        reader.asked.length = 0
        const layer = findLayer(info, 0)!
        expect(await readLayer(reader.read, layer)).toEqual(levels[0])
        expect(reader.asked).toEqual([[layer.source!.offset, layer.source!.length]])
        expect(layer.source!.length).toBeLessThan(levels[0].length)
    })
})

describe('formats', () => {
    const one = async (vkFormat: number, width: number, data: Uint8Array) => {
        const file = ktx2({ vkFormat, width, height: 1, levels: [data] })
        const info = (await readImageInfo(inMemory(file), file.length))!
        return [file, info] as const
    }

    test('sRGB RGBA8 and BGRA8', async () => {
        const [a, rgba] = await one(43, 1, new Uint8Array([1, 2, 3, 4]))
        expect([rgba.format, rgba.srgb]).toEqual(['RGBA8', true])
        expect(Array.from(decodeImage(a, rgba.format, rgba.layers[0]))).toEqual([1, 2, 3, 4])
        const [b, bgra] = await one(44, 1, new Uint8Array([1, 2, 3, 4]))
        expect(Array.from(decodeImage(b, bgra.format, bgra.layers[0]))).toEqual([3, 2, 1, 4])
    })

    test('RGB16F, three halves a pixel', async () => {
        const [file, info] = await one(90, 1, u16s(half(2), half(0.5), half(-1)))
        expect([info.format, info.channels]).toEqual(['RGB16F', 'RGB'])
        expect(Array.from(decodeImageFloat(file, info.format, info.layers[0]))).toEqual([2, 0.5, -1, 1])
    })

    test('B10G11R11, packed unsigned floats', async () => {
        // red 1.0 (exponent 15), green 0.5 (14), blue 2.0 (16)
        const v = (15 << 6) | ((14 << 6) << 11) | ((16 << 5) << 22)
        const bytes = new Uint8Array(4)
        new DataView(bytes.buffer).setUint32(0, v >>> 0, true)
        const [file, info] = await one(122, 1, bytes)
        expect(info.format).toBe('RG11B10F')
        expect(Array.from(decodeImageFloat(file, info.format, info.layers[0]))).toEqual([1, 0.5, 2, 1])
        expect(Array.from(decodeImage(file, info.format, info.layers[0]))).toEqual([255, 128, 255, 255])
    })

    test('E5B9G9R9, three mantissas and one exponent', async () => {
        // exponent 16: a mantissa of 256 is 1.0
        const v = 256 | (128 << 9) | (64 << 18) | (16 << 27)
        const bytes = new Uint8Array(4)
        new DataView(bytes.buffer).setUint32(0, v >>> 0, true)
        const [file, info] = await one(123, 1, bytes)
        expect(info.format).toBe('RGB9E5')
        expect(Array.from(decodeImageFloat(file, info.format, info.layers[0]))).toEqual([1, 0.5, 0.25, 1])
    })

    test('R16_SNORM and RG16F', async () => {
        const [a, r] = await one(71, 2, u16s(0x8001, 0x7fff))
        expect([r.format, r.channels]).toEqual(['R16_SNORM', 'R'])
        expect(Array.from(decodeImageFloat(a, r.format, r.layers[0]))).toEqual([-1, 0, 0, 1, 1, 0, 0, 1])
        const [b, rg] = await one(83, 1, u16s(half(0.25), half(4)))
        expect(Array.from(decodeImageFloat(b, rg.format, rg.layers[0]))).toEqual([0.25, 4, 0, 1])
    })

    test('the same HDR formats in a DDS', () => {
        const r11 = new Uint8Array(4)
        new DataView(r11.buffer).setUint32(0, ((15 << 6) | ((14 << 6) << 11) | ((16 << 5) << 22)) >>> 0, true)
        for (const [format, data, want] of [
            [26, r11, [1, 0.5, 2, 1]],
            [67, new Uint8Array(new Uint32Array([(256 | (128 << 9) | (64 << 18) | (16 << 27)) >>> 0]).buffer), [1, 0.5, 0.25, 1]],
            [6, f32s(3, -2, 0.5), [3, -2, 0.5, 1]],
        ] as const) {
            const file = dds({ width: 1, height: 1, dx10: { format }, data })
            const info = parseDDSHeader(file)!
            expect(Array.from(decodeImageFloat(file, info.format, info.layers[0]))).toEqual(want)
        }
    })
})

describe('cube maps and arrays', () => {
    // two elements of six faces, one pixel each: face f of element a is
    // filled with 10 * a + f
    const level = new Uint8Array(2 * 6 * 4)
    for (let i = 0; i < 12; i++) level.fill(10 * Math.floor(i / 6) + (i % 6), i * 4, i * 4 + 4)

    for (const [label, scheme, compress] of schemes) {
        test(`a cube array, ${label}: faces times elements, each where it should be`, async () => {
            const file = ktx2({ vkFormat: 37, width: 1, height: 1, layers: 2, faces: 6, levels: [level], scheme, compress })
            const info = (await readImageInfo(inMemory(file), file.length))!
            expect([info.faces, info.arraySize, info.layers.length]).toEqual([6, 2, 12])
            const layer = findLayer(info, 0, 4, 1)!
            expect(Array.from(await readLayer(inMemory(file), layer))).toEqual([14, 14, 14, 14])
        })
    }
})

describe('what is not read, and why', () => {
    test('Basis Universal is described, not parsed', async () => {
        const basis = ktx2({ vkFormat: 0, width: 64, height: 64, levels: [new Uint8Array(16)], scheme: 1 })
        expect(detectContainer(basis)).toBe('ktx2')
        expect(await readImageInfo(inMemory(basis), basis.length)).toBeUndefined()
        expect(describeKTX2(basis)).toMatchObject({ vkFormat: 0, supercompression: 'basislz', width: 64 })
    })

    test('a format with no decoder here — PVRTC — is described, not parsed', () => {
        // VK_FORMAT_PVRTC1_4BPP_UNORM_BLOCK_IMG
        const pvrtc = ktx2({ vkFormat: 1000054000, width: 4, height: 4, levels: [new Uint8Array(8)] })
        expect(parseKTX2Header(pvrtc)).toBeUndefined()
        expect(describeKTX2(pvrtc)?.vkFormat).toBe(1000054000)
    })
})

describe('files that lie are refused', () => {
    const levels = [new Uint8Array(4 * 4 * 4), new Uint8Array(2 * 2 * 4), new Uint8Array(4)]
    const base = { vkFormat: 37, width: 4, height: 4, levels }

    test('the honest one is read', () => {
        expect(parseKTX2Header(ktx2(base))).toBeDefined()
    })
    test('a stored level whose length is not what its size needs', () => {
        expect(parseKTX2Header(ktx2({ ...base, lie: { level: 1, byteLength: 20 } }))).toBeUndefined()
    })
    test('a level past the end of the file', () => {
        expect(parseKTX2Header(ktx2({ ...base, lie: { level: 0, byteOffset: 1 << 30 } }))).toBeUndefined()
    })
    test('a compressed level that claims the wrong size uncompressed', () => {
        expect(parseKTX2Header(ktx2({ ...base, scheme: 2, compress: zstd, lie: { level: 0, uncompressed: 12 } }))).toBeUndefined()
    })
    test('three faces, and more levels than halving allows', () => {
        expect(parseKTX2Header(ktx2({ ...base, faces: 3 }))).toBeUndefined()
        const many = Array.from({ length: 8 }, () => new Uint8Array(4))
        expect(parseKTX2Header(ktx2({ vkFormat: 37, width: 4, height: 4, levels: many }))).toBeUndefined()
    })
    test('an offset past what a number can hold exactly', () => {
        const file = ktx2(base)
        new DataView(file.buffer).setUint32(80 + 4, 0x00400000, true) // high word of level 0's offset
        expect(parseKTX2Header(file)).toBeUndefined()
    })
    test('compressed data that is not what it says: refused when read', async () => {
        const garbage = ktx2({ ...base, scheme: 2, compress: (b) => new Uint8Array(b.length).fill(7) })
        const info = parseKTX2Header(garbage)!
        await expect(readLayer(inMemory(garbage), info.layers[0])).rejects.toThrow()
        const broken = ktx2({
            ...base,
            scheme: 3,
            compress: (b) => {
                const packed = deflate(b)
                packed[packed.length - 1] ^= 0xff // the Adler-32
                return packed
            },
        })
        await expect(readLayer(inMemory(broken), parseKTX2Header(broken)!.layers[0])).rejects.toThrow(/checksum/)
    })
})
