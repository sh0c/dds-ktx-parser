// ETC1S, supercompressed with BasisLZ.
//
// The decoder was compared with KTX-Software's `ktx transcode --target
// rgba8` on files its `ktx create --encode basis-lz` wrote — colour and
// alpha, opaque, grey, grey and alpha; linear and sRGB; quality 1 to 255;
// mipmaps from odd sizes, arrays, cube maps; long palettes and short — and
// matched on every value (see tests/oracle). Here, fixtures `ktx` encoded are
// held to the digest of `ktx`'s own decoding of each of their images
// (tests/golden/etc1s.json).
import * as crypto from 'crypto'
import * as fs from 'fs'
import { ReadRange, decodeImage, findLayer, inMemory, readImageInfo, readLayer } from '../src'

const golden: Record<string, string[]> = JSON.parse(fs.readFileSync('tests/golden/etc1s.json', 'utf8'))
const load = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(`tests/resources/etc1s/${name}`))

// A reader that notes what it was asked for.
function counting(bytes: Uint8Array): { read: ReadRange; asked: Array<[number, number]> } {
    const asked: Array<[number, number]> = []
    const inner = inMemory(bytes)
    return { asked, read: (offset, length) => (asked.push([offset, length]), inner(offset, length)) }
}

describe('fixtures ktx encoded decode as ktx decodes them, every image', () => {
    for (const [name, digests] of Object.entries(golden)) {
        test(name, async () => {
            const bytes = load(name)
            const info = (await readImageInfo(inMemory(bytes), bytes.length))!
            expect(info.supercompression).toBe('basislz')
            expect(info.srgb).toBe(name.includes('srgb'))
            expect(info.layers.length).toBe(digests.length)
            for (let i = 0; i < digests.length; i++) {
                const layer = info.layers[i]!
                const decoded = decodeImage(await readLayer(inMemory(bytes), layer), info.format, { ...layer, offset: 0 })
                expect(decoded.length).toBe(layer.shape.width * layer.shape.height * 4)
                expect(crypto.createHash('sha256').update(decoded).digest('hex')).toBe(digests[i])
            }
        })
    }
})

test('formats and channels, from the data format descriptor', async () => {
    const expected: Record<string, [string, string]> = {
        'rgba-linear-mipmaps.ktx2': ['ETC1S_RGBA', 'RGBA'],
        'rgb-srgb.ktx2': ['ETC1S_RGB', 'RGB'],
        'grey-alpha-linear.ktx2': ['ETC1S_RGBA', 'LA'],
        'grey-srgb.ktx2': ['ETC1S_RGB', 'L'],
    }
    for (const [name, [format, channels]] of Object.entries(expected)) {
        const bytes = load(name)
        const info = (await readImageInfo(inMemory(bytes), bytes.length))!
        expect([info.format, info.channels]).toEqual([format, channels])
    }
})

test('an image is read by range: the palettes and its own slices, not its level', async () => {
    const bytes = load('rgba-linear-mipmaps.ktx2')
    const info = (await readImageInfo(inMemory(bytes), bytes.length))!
    const layer = findLayer(info, 1)!
    const { read, asked } = counting(bytes)
    await readLayer(read, layer)
    expect(asked.length).toBe(2)
    const source = layer.source!
    expect(asked[0]).toEqual([source.offset, source.length])
    const level = (source as { level: { offset: number; length: number } }).level
    expect(asked[1]![0]).toBeGreaterThanOrEqual(level.offset)
    expect(asked[1]![0] + asked[1]![1]).toBeLessThanOrEqual(level.offset + level.length)
})

test('an opaque file is opaque; a grey one is grey', async () => {
    for (const name of ['rgb-srgb.ktx2', 'grey-srgb.ktx2']) {
        const bytes = load(name)
        const info = (await readImageInfo(inMemory(bytes), bytes.length))!
        const layer = info.layers[0]!
        const decoded = decodeImage(await readLayer(inMemory(bytes), layer), info.format, { ...layer, offset: 0 })
        for (let i = 0; i < decoded.length; i += 4) {
            expect(decoded[i + 3]).toBe(255)
            if (name.startsWith('grey')) expect([decoded[i + 1], decoded[i + 2]]).toEqual([decoded[i], decoded[i]])
        }
    }
})

test('a damaged image throws, and does not run on', async () => {
    const bytes = load('rgb-srgb.ktx2')
    const info = (await readImageInfo(inMemory(bytes), bytes.length))!
    const layer = info.layers[0]!
    const packed = await readLayer(inMemory(bytes), layer)
    // Cut short: the header says more than there is.
    expect(() => decodeImage(packed.subarray(0, packed.length - 8), info.format, { ...layer, offset: 0 })).toThrow(RangeError)
    // The tables scrambled: the stream no longer makes sense.
    const scrambled = packed.slice()
    for (let i = 28; i < scrambled.length; i++) scrambled[i] ^= 0x5a
    expect(() => decodeImage(scrambled, info.format, { ...layer, offset: 0 })).toThrow()
})

test('a video frame, which needs the one before it, is refused', async () => {
    const bytes = load('rgb-srgb.ktx2').slice()
    const info = (await readImageInfo(inMemory(bytes), bytes.length))!
    const layer = info.layers[0]!
    // The first image's flags: after the global data's 20-byte header.
    bytes[layer.source!.offset + 20] |= 2
    await expect(readLayer(inMemory(bytes), layer)).rejects.toThrow(/video/)
})
