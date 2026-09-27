// What each header says, read right — formats, channels, sRGB, cube maps,
// arrays, volumes — and each pixel format decoded to what it holds. Every
// file here is made byte by byte in tests/helpers/make.ts.
import * as fs from 'fs'
import {
    ImageInfo,
    decodeImage,
    decodeImageFloat,
    findLayer,
    parseDDSHeader,
    parseKTXHeader,
} from '../src'
import {
    CAPS2_CUBEMAP_ALL,
    CAPS2_VOLUME,
    DDPF_ALPHA,
    DDPF_ALPHAPIXELS,
    DDPF_LUMINANCE,
    DDPF_RGB,
    dds,
    f32s,
    half,
    ktx,
    u16s,
} from './helpers/make'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)
const first = (file: Uint8Array, info: ImageInfo | undefined): Uint8Array =>
    decodeImage(file, info!.format, info!.layers[0])
const firstFloat = (file: Uint8Array, info: ImageInfo | undefined): Float32Array =>
    decodeImageFloat(file, info!.format, info!.layers[0])

// DXGI format numbers
const DXGI = {
    RGBA32F: 2,
    RGBA16F: 10,
    RG16: 35,
    RG16_SNORM: 37,
    R8G8_SNORM: 51,
    R16: 56,
    R16_SNORM: 58,
    R8_SNORM: 63,
    R32F: 41,
    BC1_SRGB: 72,
    BC4_SNORM: 81,
    BC5_SNORM: 84,
    BC7_SRGB: 99,
    RGBA8_SRGB: 29,
}

describe('DDS written before DX10, told by its masks', () => {
    const two = (flags: number, bits: number, r: number, g: number, b: number, a: number, data: Uint8Array) => {
        const file = dds({ width: 2, height: 1, masks: { flags, bits, r, g, b, a }, data })
        return [file, parseDDSHeader(file)] as const
    }

    test('BGRA8, with its channels put in order', () => {
        const [file, info] = two(DDPF_RGB | DDPF_ALPHAPIXELS, 32, 0xff0000, 0xff00, 0xff, 0xff000000,
            bytes(10, 20, 30, 40, 50, 60, 70, 80))
        expect(info?.format).toBe('BGRA8')
        expect(Array.from(first(file, info))).toEqual([30, 20, 10, 40, 70, 60, 50, 80])
    })

    test('BGRX8: an alpha byte with no alpha flag means nothing', () => {
        const [file, info] = two(DDPF_RGB, 32, 0xff0000, 0xff00, 0xff, 0, bytes(10, 20, 30, 0, 50, 60, 70, 0))
        expect(info?.format).toBe('BGRX8')
        expect(Array.from(first(file, info))).toEqual([30, 20, 10, 255, 70, 60, 50, 255])
    })

    test('RGB8 and BGR8, three bytes a pixel', () => {
        const [a, rgb] = two(DDPF_RGB, 24, 0xff, 0xff00, 0xff0000, 0, bytes(1, 2, 3, 4, 5, 6))
        expect(rgb?.format).toBe('RGB8')
        expect(Array.from(first(a, rgb))).toEqual([1, 2, 3, 255, 4, 5, 6, 255])
        const [b, bgr] = two(DDPF_RGB, 24, 0xff0000, 0xff00, 0xff, 0, bytes(1, 2, 3, 4, 5, 6))
        expect(bgr?.format).toBe('BGR8')
        expect(Array.from(first(b, bgr))).toEqual([3, 2, 1, 255, 6, 5, 4, 255])
    })

    test('B5G6R5: pure red and pure green', () => {
        const [file, info] = two(DDPF_RGB, 16, 0xf800, 0x07e0, 0x001f, 0, u16s(0xf800, 0x07e0))
        expect(info?.format).toBe('B5G6R5')
        expect(Array.from(first(file, info))).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
    })

    test('L8 is grey, A8 is alpha alone', () => {
        const [l, lum] = two(DDPF_LUMINANCE, 8, 0xff, 0, 0, 0, bytes(0, 200))
        expect([lum?.format, lum?.channels]).toEqual(['L8', 'L'])
        expect(Array.from(first(l, lum))).toEqual([0, 0, 0, 255, 200, 200, 200, 255])
        const [a, alpha] = two(DDPF_ALPHA, 8, 0, 0, 0, 0xff, bytes(0, 128))
        expect([alpha?.format, alpha?.channels]).toEqual(['A8', 'A'])
        expect(Array.from(first(a, alpha))).toEqual([0, 0, 0, 0, 0, 0, 0, 128])
    })

    test('R8, G16R16 and L16: one and two channels', () => {
        const [r, r8] = two(DDPF_RGB, 8, 0xff, 0, 0, 0, bytes(7, 250))
        expect([r8?.format, r8?.channels]).toEqual(['R8', 'R'])
        expect(Array.from(first(r, r8))).toEqual([7, 0, 0, 255, 250, 0, 0, 255])
        const [g, rg16] = two(DDPF_RGB, 32, 0xffff, 0xffff0000, 0, 0, u16s(65535, 0, 0, 65535))
        expect([rg16?.format, rg16?.channels]).toEqual(['RG16', 'RG'])
        expect(Array.from(first(g, rg16))).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
        const [l, l16] = two(DDPF_LUMINANCE, 16, 0xffff, 0, 0, 0, u16s(0, 65535))
        expect(l16?.format).toBe('L16')
        expect(Array.from(first(l, l16))).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
    })

    test('a format it does not know is refused — not decoded as BC1', () => {
        // Every uncompressed file used to come back as BC1, and decode as noise.
        const [, info] = two(DDPF_RGB, 32, 0xff, 0xff, 0xff, 0, new Uint8Array(8))
        expect(info).toBeUndefined()
    })
})

describe('DX10 formats', () => {
    const one = (format: number, width: number, data: Uint8Array) => {
        const file = dds({ width, height: 1, dx10: { format }, data })
        return [file, parseDDSHeader(file)] as const
    }

    test('RGBA16F: HDR clamps in 8 bits and is whole in floats', () => {
        const [file, info] = one(DXGI.RGBA16F, 1, u16s(half(1.5), half(0.5), half(0), half(1)))
        expect(info?.format).toBe('RGBA16F')
        expect(Array.from(first(file, info))).toEqual([255, 128, 0, 255])
        expect(Array.from(firstFloat(file, info))).toEqual([1.5, 0.5, 0, 1])
    })

    test('R32F and RGBA32F', () => {
        const [a, r] = one(DXGI.R32F, 2, f32s(0.25, 2))
        expect([r?.format, r?.channels]).toEqual(['R32F', 'R'])
        expect(Array.from(firstFloat(a, r))).toEqual([0.25, 0, 0, 1, 2, 0, 0, 1])
        const [b, rgba] = one(DXGI.RGBA32F, 1, f32s(-1, 0.5, 3, 1))
        expect(Array.from(first(b, rgba))).toEqual([0, 128, 255, 255])
    })

    test('R16 and RG16 unsigned', () => {
        const [a, r] = one(DXGI.R16, 2, u16s(0, 65535))
        expect([r?.format, r?.channels]).toEqual(['R16', 'R'])
        expect(Array.from(first(a, r))).toEqual([0, 0, 0, 255, 255, 0, 0, 255])
        const [b, rg] = one(DXGI.RG16, 1, u16s(65535, 32768))
        expect([rg?.format, rg?.channels]).toEqual(['RG16', 'RG'])
        expect(Array.from(first(b, rg))).toEqual([255, 128, 0, 255])
    })

    test('signed R and RG: -1 is 0 and 1 is 255 in bytes, and exact in floats', () => {
        const [a, r8] = one(DXGI.R8_SNORM, 3, bytes(0x81, 0x7f, 0x80))
        expect([r8?.format, r8?.channels]).toEqual(['R8_SNORM', 'R'])
        expect(Array.from(first(a, r8)).filter((_, i) => i % 4 === 0)).toEqual([0, 255, 0])
        expect(Array.from(firstFloat(a, r8)).filter((_, i) => i % 4 === 0)).toEqual([-1, 1, -1])
        const [b, rg8] = one(DXGI.R8G8_SNORM, 1, bytes(0x7f, 0x00))
        expect(Array.from(first(b, rg8))).toEqual([255, 128, 0, 255])
        const [c, r16] = one(DXGI.R16_SNORM, 1, u16s(0x8001))
        expect(Array.from(firstFloat(c, r16))).toEqual([-1, 0, 0, 1])
        const [d, rg16] = one(DXGI.RG16_SNORM, 1, u16s(0x7fff, 0x8001))
        expect([rg16?.format, rg16?.channels]).toEqual(['RG16_SNORM', 'RG'])
        expect(Array.from(firstFloat(d, rg16))).toEqual([1, -1, 0, 1])
    })

    test('sRGB is said, and the blocks are the same format as linear', () => {
        const [, bc7] = one(DXGI.BC7_SRGB, 4, new Uint8Array(16))
        expect([bc7?.format, bc7?.srgb]).toEqual(['BC7', true])
        // BC1_UNORM_SRGB was missing from the table altogether.
        const [, bc1] = one(DXGI.BC1_SRGB, 4, new Uint8Array(8))
        expect([bc1?.format, bc1?.srgb]).toEqual(['BC1', true])
        const [, rgba] = one(DXGI.RGBA8_SRGB, 1, new Uint8Array(4))
        expect([rgba?.format, rgba?.srgb]).toEqual(['RGBA8', true])
        const [, fixture] = [null, parseDDSHeader(fs.readFileSync('tests/resources/dds/bc7.dds'))]
        expect(fixture?.srgb).toBe(false)
    })
})

describe('signed BC4 and BC5', () => {
    // Endpoints 127 and -127; the codes pick 127, -127, and the six between.
    const block = (): Uint8Array => {
        const b = new Uint8Array(8)
        b[0] = 0x7f
        b[1] = 0x81
        // codes 0, 1, 2, 3, ... for pixels 0 to 7, three bits each, packed
        // from the lowest bit of byte 2 up
        for (let i = 0; i < 16; i++) {
            const code = i % 8
            for (let bit = 0; bit < 3; bit++) {
                const at = 3 * i + bit
                if ((code >> bit) & 1) b[2 + (at >> 3)] |= 1 << (at & 7)
            }
        }
        return b
    }

    test('BC4_SNORM runs from 1 to -1 in sevenths, signed', () => {
        const file = dds({ width: 4, height: 4, dx10: { format: DXGI.BC4_SNORM }, data: block() })
        const info = parseDDSHeader(file)
        expect([info?.format, info?.channels]).toEqual(['BC4_SNORM', 'R'])
        const red = Array.from(firstFloat(file, info)).filter((_, i) => i % 4 === 0).slice(0, 8)
        const want = [1, -1, 5 / 7, 3 / 7, 1 / 7, -1 / 7, -3 / 7, -5 / 7]
        red.forEach((v, i) => expect(v).toBeCloseTo(want[i], 5))
        // In bytes, -1 is 0 and 1 is 255.
        const bytesOut = first(file, info)
        expect([bytesOut[0], bytesOut[4]]).toEqual([255, 0])
    })

    test('BC5_SNORM decodes two signed channels', () => {
        const data = new Uint8Array(16)
        data.set(block(), 0)
        data.set(block(), 8)
        data[8] = 0x81 // green's endpoints the other way round
        data[9] = 0x7f
        const file = dds({ width: 4, height: 4, dx10: { format: DXGI.BC5_SNORM }, data })
        const info = parseDDSHeader(file)
        expect([info?.format, info?.channels]).toEqual(['BC5_SNORM', 'RG'])
        const px = firstFloat(file, info)
        expect([px[0], px[1], px[2], px[3]]).toEqual([1, -1, 0, 1])
    })
})

describe('what else the header says', () => {
    test('a DDS without mip levels has one, not none', () => {
        // A mipmap count of 0 used to give no layers at all.
        const file = dds({ width: 4, height: 4, fourCC: 'DXT1', data: new Uint8Array(8) })
        expect(parseDDSHeader(file)?.layers.length).toBe(1)
    })

    test('a cube map written before DX10 has six faces, each with its levels', () => {
        // The cube flags were read from dwCaps, which never has them.
        const levelBytes = 8 + 8 // 4×4 and 2×2 of BC1
        const file = dds({ width: 4, height: 4, levels: 2, fourCC: 'DXT1', caps2: CAPS2_CUBEMAP_ALL,
            data: new Uint8Array(6 * levelBytes) })
        const info = parseDDSHeader(file)!
        expect([info.faces, info.layers.length]).toEqual([6, 12])
        expect(findLayer(info, 1, 5)?.offset).toBe(128 + 5 * levelBytes + 8)
    })

    test('a DX10 cube array has faces times elements', () => {
        const file = dds({ width: 4, height: 4, levels: 1,
            dx10: { format: 71, misc: 0x4, arraySize: 2 }, data: new Uint8Array(12 * 8) })
        const info = parseDDSHeader(file)!
        expect([info.faces, info.arraySize, info.layers.length]).toEqual([6, 2, 12])
        expect(findLayer(info, 0, 3, 1)?.offset).toBe(148 + (6 + 3) * 8)
    })

    test('a volume texture has its slices, halving with the levels', () => {
        const data = new Uint8Array(2 * 2 * 4 * 4 + 1 * 1 * 2 * 4)
        data.set([9, 8, 7, 6], 3 * 16) // slice 3's first pixel
        const file = dds({ width: 2, height: 2, depth: 4, levels: 2, caps2: CAPS2_VOLUME,
            masks: { flags: DDPF_RGB | DDPF_ALPHAPIXELS, bits: 32, r: 0xff, g: 0xff00, b: 0xff0000, a: 0xff000000 },
            data })
        const info = parseDDSHeader(file)!
        expect(info.layers.map((l) => l.depth)).toEqual([4, 2])
        expect(Array.from(decodeImage(file, info.format, info.layers[0], 3).subarray(0, 4))).toEqual([9, 8, 7, 6])
        expect(() => decodeImage(file, info.format, info.layers[0], 4)).toThrow(RangeError)
    })
})

describe('headers that cannot be right are refused', () => {
    test('100,000 square in a kilobyte', () => {
        expect(parseDDSHeader(dds({ width: 100000, height: 100000, fourCC: 'DXT1', data: new Uint8Array(1000) }))).toBeUndefined()
    })
    test('a size of nothing', () => {
        expect(parseDDSHeader(dds({ width: 0, height: 4, fourCC: 'DXT1', data: new Uint8Array(8) }))).toBeUndefined()
    })
    test('more levels than halving allows', () => {
        expect(parseDDSHeader(dds({ width: 4, height: 4, levels: 40, fourCC: 'DXT1', data: new Uint8Array(64) }))).toBeUndefined()
    })
    test('levels past the end of the file', () => {
        expect(parseDDSHeader(dds({ width: 64, height: 64, levels: 1, fourCC: 'DXT1', data: new Uint8Array(100) }))).toBeUndefined()
    })
    test('a limit of the caller\'s own', () => {
        const file = dds({ width: 64, height: 64, fourCC: 'DXT1', data: new Uint8Array(2048) })
        expect(parseDDSHeader(file, file.length, { maxDimension: 32 })).toBeUndefined()
        expect(parseDDSHeader(file, file.length, { maxDimension: 64 })).toBeDefined()
    })
})

describe('KTX', () => {
    const GL = {
        RGBA8: 0x8058,
        RGB8: 0x8051,
        R16: 0x822a,
        RG8_SNORM: 0x8f95,
        SRGB_BPTC: 0x8e8d,
        SIGNED_RED_RGTC1: 0x8dbc,
        SIGNED_BPTC_FLOAT: 0x8e8e,
    }

    test('RGBA8, one pixel', () => {
        const file = ktx({ internalFormat: GL.RGBA8, width: 1, height: 1, levels: [bytes(1, 2, 3, 4)] })
        const info = parseKTXHeader(file)
        expect(info?.format).toBe('RGBA8')
        expect(Array.from(first(file, info))).toEqual([1, 2, 3, 4])
    })

    test('RGB8 with rows padded to four bytes', () => {
        // 3 pixels a row is 9 bytes, stored as 12.
        const level = new Uint8Array(24)
        level.set([1, 2, 3, 4, 5, 6, 7, 8, 9], 0)
        level.set([10, 11, 12, 13, 14, 15, 16, 17, 18], 12)
        const file = ktx({ internalFormat: GL.RGB8, width: 3, height: 2, levels: [level] })
        const info = parseKTXHeader(file)!
        expect(info.layers[0].rowPitch).toBe(12)
        const px = first(file, info)
        expect(Array.from(px.subarray(12, 16))).toEqual([10, 11, 12, 255])
    })

    test('R16 and RG8_SNORM', () => {
        const a = ktx({ internalFormat: GL.R16, width: 2, height: 1, levels: [u16s(0, 65535)] })
        expect(parseKTXHeader(a)?.channels).toBe('R')
        expect(Array.from(first(a, parseKTXHeader(a))).filter((_, i) => i % 4 === 0)).toEqual([0, 255])
        const b = ktx({ internalFormat: GL.RG8_SNORM, width: 1, height: 1, levels: [bytes(0x81, 0x7f, 0, 0)] })
        expect(Array.from(firstFloat(b, parseKTXHeader(b)))).toEqual([-1, 1, 0, 1])
    })

    test('sRGB and signed compressed formats are known', () => {
        const srgb = parseKTXHeader(ktx({ internalFormat: GL.SRGB_BPTC, width: 4, height: 4, levels: [new Uint8Array(16)] }))
        expect([srgb?.format, srgb?.srgb]).toEqual(['BC7', true])
        // Signed RGTC used to be read as unsigned BC4.
        const signed = parseKTXHeader(ktx({ internalFormat: GL.SIGNED_RED_RGTC1, width: 4, height: 4, levels: [new Uint8Array(8)] }))
        expect(signed?.format).toBe('BC4_SNORM')
        const hdr = parseKTXHeader(ktx({ internalFormat: GL.SIGNED_BPTC_FLOAT, width: 4, height: 4, levels: [new Uint8Array(16)] }))
        expect(hdr?.format).toBe('BC6H_SF16')
    })

    test('a cube map that is not an array: imageSize is one face', () => {
        const faces = new Uint8Array(6 * 4)
        faces.set([1, 2, 3, 4], 5 * 4)
        const file = ktx({ internalFormat: GL.RGBA8, width: 1, height: 1, faces: 6, levels: [faces], imageSizes: [4] })
        const info = parseKTXHeader(file)!
        expect(info.layers.length).toBe(6)
        expect(Array.from(decodeImage(file, info.format, findLayer(info, 0, 5)!))).toEqual([1, 2, 3, 4])
    })

    test('refused: big-endian, three faces, key/value data past the end, a wrong imageSize', () => {
        const base = { internalFormat: GL.RGBA8, width: 1, height: 1, levels: [new Uint8Array(4)] }
        expect(parseKTXHeader(ktx(base))).toBeDefined()
        expect(parseKTXHeader(ktx({ ...base, endianness: 0x01020304 }))).toBeUndefined()
        expect(parseKTXHeader(ktx({ ...base, faces: 3 }))).toBeUndefined()
        const long = ktx(base)
        new DataView(long.buffer).setUint32(60, 1 << 30, true)
        expect(parseKTXHeader(long)).toBeUndefined()
        expect(parseKTXHeader(ktx({ ...base, imageSizes: [8] }))).toBeUndefined()
    })
})

describe('BC6H', () => {
    test('bytes are the floats clamped, for every pixel of a fixture', () => {
        const file = new Uint8Array(fs.readFileSync('tests/resources/dds/bc6h.dds'))
        const info = parseDDSHeader(file)!
        const layer = info.layers[1]
        const asBytes = decodeImage(file, info.format, layer)
        const asFloats = decodeImageFloat(file, info.format, layer)
        let over = 0
        for (let i = 0; i < asFloats.length; i++) {
            const v = Math.min(255, Math.max(0, Math.floor(asFloats[i] * 255 + 0.5)))
            expect(asBytes[i]).toBe(v)
            if (asFloats[i] > 1) over++
        }
        // This fixture has values past 1.0 in its smaller levels; they used
        // to wrap round to dark.
        expect(over).toBeGreaterThan(0)
    })
})
