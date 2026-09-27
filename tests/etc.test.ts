// ETC1, ETC2 and EAC.
//
// Random blocks reach every ETC mode — any 64 bits are a valid block — so
// the decoders were compared with etcdec, an independent C decoder, on
// 200,000 random blocks of each format, and matched on every pixel (see
// tests/oracle). The digests here are of this package's output on the same
// seeded blocks, so the decoders stay what was compared, without etcdec.
//
// Signed EAC is checked against the specification instead: etcdec decodes
// it as unsigned and reinterprets the bits, which the specification does not.
import * as crypto from 'crypto'
import {
    decodeImage,
    decodeImageFloat,
    parseKTX2Header,
    parseKTXHeader,
} from '../src'
import {
    decodeEACR11Block,
    decodeEACRG11Block,
    decodeETC2A1Block,
    decodeETC2Block,
    decodeETC2RGBABlock,
} from '../src/decode/etc'
import { ktx, ktx2 } from './helpers/make'

// The same generator as tests/oracle/compare-etc.ts.
function random(seed: number): () => number {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) & 0xff
    }
}

const COUNT = 20000

function digest(mode: string, size: number): string {
    const next = random(0x5eed + size + mode.length)
    const hash = crypto.createHash('sha256')
    const block = new Uint8Array(size)
    for (let b = 0; b < COUNT; b++) {
        for (let i = 0; i < size; i++) block[i] = next()
        if (mode === 'r11' || mode === 'rg11') {
            const f = mode === 'r11' ? decodeEACR11Block(block, false) : decodeEACRG11Block(block, false)
            // The 11-bit values, as they were compared.
            hash.update(new Uint8Array(Uint16Array.from(f, (v) => Math.round(v * 2047)).buffer))
        } else {
            const px = mode === 'rgb' ? decodeETC2Block(block) : mode === 'a1' ? decodeETC2A1Block(block) : decodeETC2RGBABlock(block)
            hash.update(px)
        }
    }
    return hash.digest('hex')
}

// Recorded from the decoders once they matched etcdec on every block.
const recorded: Record<string, string> = {
    rgb: '25e7d0504f4c269a89453a58c5725cccd1b4e2e0fd3f6cb152c86ff93254379e',
    a1: '28390d42f2d790d58f30ef37b99684f1423c9e9bec581ac0ebf428123d519909',
    rgba: 'b7299d566e61b8694c12389399ebeb4bced83063e53ac07c62cd7567259adde3',
    r11: '473a854777b6bd89f4cce5990f75b1295ca5ec3229547445f54b89877c028827',
    rg11: 'b72dcf344cd6c9fb38317957b36164ca0ec11f65da88b647d5d0167471731a5a',
}

for (const [mode, size] of [['rgb', 8], ['a1', 8], ['rgba', 16], ['r11', 8], ['rg11', 16]] as const) {
    test(`${mode}: ${COUNT} random blocks decode as they did when compared with etcdec`, () => {
        expect(digest(mode, size)).toBe(recorded[mode])
    })
}

describe('signed EAC, by the specification', () => {
    // base (signed byte), multiplier and table in the first two bytes, then
    // sixteen 3-bit indices, pixel 0 in the top bits.
    const block = (base: number, multiplier: number, table: number, indices: number[]): Uint8Array => {
        const b = new Uint8Array(8)
        b[0] = base & 0xff
        b[1] = (multiplier << 4) | table
        let bits = 0
        let at = 2
        let count = 0
        for (const index of indices) {
            bits = (bits << 3) | index
            count += 3
            while (count >= 8) {
                count -= 8
                b[at++] = (bits >> count) & 0xff
            }
        }
        return b
    }
    const TABLE_0 = [-3, -6, -9, -15, 2, 5, 8, 14]
    const expected = (base: number, multiplier: number, index: number): number => {
        const b = base === -128 ? -127 : base
        const v = b * 8 + TABLE_0[index] * (multiplier ? multiplier * 8 : 1)
        return Math.max(-1023, Math.min(1023, v)) / 1023
    }
    const indices = Array.from({ length: 16 }, (_, k) => k % 8)

    for (const [base, multiplier] of [[0, 1], [-50, 3], [100, 15], [-128, 7], [127, 15], [-127, 0], [5, 0]]) {
        test(`base ${base}, multiplier ${multiplier}`, () => {
            const out = decodeEACR11Block(block(base, multiplier, 0, indices), true)
            for (let k = 0; k < 16; k++) {
                // pixel k is at column k >> 2, row k & 3
                const at = ((k & 3) * 4 + (k >> 2)) * 4
                expect(out[at]).toBeCloseTo(expected(base, multiplier, indices[k]), 6)
                expect(out[at + 3]).toBe(1)
            }
        })
    }

    test('RG11: red from the first half, green from the second', () => {
        const both = new Uint8Array(16)
        both.set(block(-100, 2, 0, indices), 0)
        both.set(block(60, 4, 0, indices), 8)
        const out = decodeEACRG11Block(both, true)
        expect(out[0]).toBeCloseTo(expected(-100, 2, 0), 6)
        expect(out[1]).toBeCloseTo(expected(60, 4, 0), 6)
    })
})

describe('in a file', () => {
    // One ETC2 RGB block in differential mode: base colour 16,8,31 (5-bit),
    // no difference, table 0, every pixel index 0 — the colour plus 2.
    const etc2 = new Uint8Array([16 << 3, 8 << 3, 31 << 3, 0b10, 0, 0, 0, 0])
    const colour = [(16 << 3 | 16 >> 2) + 2, (8 << 3 | 8 >> 2) + 2, 255]

    test('KTX 1, as GL_COMPRESSED_RGB8_ETC2', () => {
        const file = ktx({ internalFormat: 0x9274, width: 4, height: 4, levels: [etc2] })
        const info = parseKTXHeader(file)!
        expect([info.format, info.channels]).toEqual(['ETC2_RGB', 'RGB'])
        expect(Array.from(decodeImage(file, info.format, info.layers[0]).subarray(0, 4))).toEqual([...colour, 255])
    })

    test('KTX 2, as ETC2_R8G8B8_SRGB_BLOCK', () => {
        const file = ktx2({ vkFormat: 148, width: 4, height: 4, levels: [etc2] })
        const info = parseKTX2Header(file)!
        expect([info.format, info.srgb]).toEqual(['ETC2_RGB', true])
        expect(Array.from(decodeImage(file, info.format, info.layers[0]).subarray(0, 4))).toEqual([...colour, 255])
    })

    test('every ETC and EAC format is known in both', () => {
        const gl: Array<[number, string, boolean]> = [
            [0x8d64, 'ETC1', false],
            [0x9275, 'ETC2_RGB', true],
            [0x9276, 'ETC2_RGB_A1', false],
            [0x9277, 'ETC2_RGB_A1', true],
            [0x9278, 'ETC2_RGBA', false],
            [0x9279, 'ETC2_RGBA', true],
            [0x9270, 'EAC_R11', false],
            [0x9271, 'EAC_R11_SNORM', false],
            [0x9272, 'EAC_RG11', false],
            [0x9273, 'EAC_RG11_SNORM', false],
        ]
        for (const [internalFormat, format, srgb] of gl) {
            const size = /RGBA$|RG11/.test(format) ? 16 : 8
            const info = parseKTXHeader(ktx({ internalFormat, width: 4, height: 4, levels: [new Uint8Array(size)] }))
            expect([info?.format, info?.srgb]).toEqual([format, srgb])
        }
        for (let vk = 147; vk <= 156; vk++) {
            const size = [151, 152, 155, 156].includes(vk) ? 16 : 8
            expect(parseKTX2Header(ktx2({ vkFormat: vk, width: 4, height: 4, levels: [new Uint8Array(size)] }))).toBeDefined()
        }
    })

    test('signed EAC in a file is signed', () => {
        const file = ktx2({ vkFormat: 154, width: 4, height: 4, levels: [new Uint8Array([0x81, 0x10, 0, 0, 0, 0, 0, 0])] })
        const info = parseKTX2Header(file)!
        expect(decodeImageFloat(file, info.format, info.layers[0])[0]).toBeLessThan(-0.9)
    })
})
