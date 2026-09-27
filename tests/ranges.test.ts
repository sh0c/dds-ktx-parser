// Reading a texture a piece at a time: the header, then only the level
// wanted — which is what lets a viewer show a large texture without reading
// all of it.
import * as fs from 'fs'
import {
    DDS_HEADER_BYTES,
    decodeImage,
    detectContainer,
    parseDDSHeader,
    parseKTXHeader,
    readImageInfo,
} from '../src'
import { KTX2, counting, ktx } from './helpers/make'

const fixtures = ['dds/bc1.dds', 'dds/bc7.dds', 'ktx/bc3.ktx', 'ktx/bc6h.ktx']
const load = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(`tests/resources/${name}`))

test('a DDS header parses from its first bytes alone', () => {
    const bytes = load('dds/bc7.dds')
    const whole = parseDDSHeader(bytes)
    expect(parseDDSHeader(bytes.subarray(0, DDS_HEADER_BYTES), bytes.length)).toEqual(whole)
})

test('a DDS is read in one piece: its header', async () => {
    const bytes = load('dds/bc1.dds')
    const reader = counting(bytes)
    expect(await readImageInfo(reader.read, bytes.length)).toEqual(parseDDSHeader(bytes))
    expect(reader.asked).toEqual([[0, DDS_HEADER_BYTES]])
})

test('a KTX is read as its header and four bytes a level', async () => {
    const bytes = load('ktx/bc7.ktx')
    const whole = parseKTXHeader(bytes)!
    const reader = counting(bytes)
    expect(await readImageInfo(reader.read, bytes.length)).toEqual(whole)
    expect(reader.asked.length).toBe(1 + whole.levels)
    expect(reader.asked.slice(1).every(([, length]) => length === 4)).toBe(true)
})

test('KTX from too few bytes is refused, not thrown', () => {
    // It used to throw "Invalid typed array length" from inside a view.
    expect(parseKTXHeader(load('ktx/bc7.ktx').subarray(0, 128))).toBeUndefined()
})

for (const name of fixtures) {
    test(`${name}: every level decodes from its own bytes, as in place`, async () => {
        const bytes = load(name)
        const info = (await readImageInfo(counting(bytes).read, bytes.length))!
        for (const layer of info.layers) {
            const own = bytes.slice(layer.offset, layer.offset + layer.length)
            const alone = decodeImage(own, info.format, { ...layer, offset: 0 })
            expect(Buffer.compare(alone, decodeImage(bytes, info.format, layer))).toBe(0)
        }
    })
}

test('bytes that do not start on a four-byte boundary decode the same', () => {
    // A Uint32Array view over them used to throw.
    const bytes = load('dds/bc7.dds')
    for (const shift of [1, 2, 3]) {
        const moved = new Uint8Array(bytes.length + shift).subarray(shift)
        moved.set(bytes)
        const info = parseDDSHeader(moved)!
        const shifted = decodeImage(moved, info.format, info.layers[1])
        expect(Buffer.compare(shifted, decodeImage(bytes, info.format, info.layers[1]))).toBe(0)
    }
})

test('decoding from too few bytes says so', () => {
    const bytes = load('dds/bc1.dds')
    const info = parseDDSHeader(bytes)!
    expect(() => decodeImage(bytes.subarray(0, 1000), info.format, info.layers[0])).toThrow(RangeError)
})

test('the kind of file is told from its first bytes, KTX 2 included', async () => {
    expect(detectContainer(load('dds/bc1.dds'))).toBe('dds')
    expect(detectContainer(load('ktx/bc1.ktx'))).toBe('ktx')
    const two = ktx({ internalFormat: 0x8058, width: 1, height: 1, levels: [new Uint8Array(4)], magic: KTX2 })
    expect(detectContainer(two)).toBe('ktx2')
    expect(await readImageInfo(counting(two).read, two.length)).toBeUndefined()
    expect(detectContainer(load('logo.png'))).toBeUndefined()
})

test('a KTX whose sizes lie is refused, having read no further', async () => {
    const level = new Uint8Array(4)
    const lying = ktx({ internalFormat: 0x8058, width: 1, height: 1, levels: [level], imageSizes: [1 << 30] })
    const reader = counting(lying)
    expect(await readImageInfo(reader.read, lying.length)).toBeUndefined()
    expect(reader.asked.length).toBe(2)
})
