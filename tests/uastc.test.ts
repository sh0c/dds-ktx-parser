// UASTC.
//
// The decoder was compared with KTX-Software's `ktx transcode --target
// rgba8` on files its `ktx create --encode uastc` wrote — colour and alpha,
// opaque, grey and alpha, smooth; linear and sRGB; quality 0, 2, 4 and RDO —
// and on random blocks of every mode, and matched on every value (see
// tests/oracle). Here, fixtures `ktx` encoded are held to the digest of
// `ktx`'s own decoding of them (tests/golden/uastc.json).
import * as crypto from 'crypto'
import * as fs from 'fs'
import { decodeImage, inMemory, readImageInfo } from '../src'
import { decodeUASTCBlock } from '../src/decode/uastc'

const golden: Record<string, string> = JSON.parse(fs.readFileSync('tests/golden/uastc.json', 'utf8'))

describe('fixtures ktx encoded decode as ktx decodes them', () => {
    for (const [name, digest] of Object.entries(golden)) {
        test(name, async () => {
            const bytes = new Uint8Array(fs.readFileSync(`tests/resources/uastc/${name}`))
            const info = (await readImageInfo(inMemory(bytes), bytes.length))!
            expect(info.format).toBe(name.startsWith('rgb-') ? 'UASTC_RGB' : 'UASTC_RGBA')
            expect(info.srgb).toBe(name.includes('srgb'))
            const decoded = decodeImage(bytes, info.format, info.layers[0])
            expect(crypto.createHash('sha256').update(decoded).digest('hex')).toBe(digest)
        })
    }
})

test('an opaque file is opaque, whatever its blocks say', async () => {
    const bytes = new Uint8Array(fs.readFileSync('tests/resources/uastc/rgb-srgb.ktx2'))
    const info = (await readImageInfo(inMemory(bytes), bytes.length))!
    const decoded = decodeImage(bytes, info.format, info.layers[0])
    for (let i = 3; i < decoded.length; i += 4) expect(decoded[i]).toBe(255)
})

test('a solid-colour block, and the reserved mode, which is the error colour', () => {
    // Mode 8 is code 0b10111 in five bits, then R, G, B and A.
    const solid = new Uint8Array(16)
    let bits = 0x17 | (10 << 5) | (20 << 13) | (30 << 21)
    for (let i = 0; i < 4; i++) solid[i] = (bits >>> (i * 8)) & 0xff
    solid[3] |= (40 << 5) & 0xff
    solid[4] = 40 >> 3
    const out = decodeUASTCBlock(solid, false)
    expect(Array.from(out.subarray(0, 4))).toEqual([10, 20, 30, 40])
    // Code 0x45 in seven bits is kept for future use.
    const reserved = new Uint8Array(16)
    reserved[0] = 0x45
    expect(Array.from(decodeUASTCBlock(reserved, false).subarray(0, 4))).toEqual([255, 0, 255, 255])
    void bits
})
