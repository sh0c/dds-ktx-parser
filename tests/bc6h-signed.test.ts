// BC6H_SF16 — signed half floats — checked against the format's own
// arithmetic, since there is no reference file for it to be checked against.
//
// This test has its own small copy of the formulas the BC6H specification
// gives (the Direct3D 11 functional specification, "BC6H"), written from
// the specification and not from the decoder: unquantize an endpoint,
// interpolate between two by a weight, and "finish" the result into a half
// float. It builds blocks bit by bit in mode 11 — one region, two 10-bit
// endpoints a channel, no deltas, 4-bit indices — and checks each pixel.
//
// The same blocks are decoded as unsigned first. That path is already held
// to the fixtures, so its agreeing here shows the blocks are built as the
// decoder reads them; only then do the signed results mean anything.
import { decodeImageFloat, parseDDSHeader } from '../src'
import { dds } from './helpers/make'
import { halfToFloat } from '../src/bytes'

const PRECISION = 10
const WEIGHTS = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]

// ---- the specification's arithmetic --------------------------------------

function unquantizeUnsigned(x: number): number {
    if (x === 0) return 0
    if (x === (1 << PRECISION) - 1) return 0xffff
    return ((x << 15) + 0x4000) >> (PRECISION - 1)
}

function unquantizeSigned(x: number): number {
    const negative = x < 0
    const magnitude = Math.abs(x)
    let q: number
    if (magnitude === 0) q = 0
    else if (magnitude >= (1 << (PRECISION - 1)) - 1) q = 0x7fff
    else q = ((magnitude << 15) + 0x4000) >> (PRECISION - 1)
    return negative ? -q : q
}

const interpolate = (e0: number, e1: number, index: number): number =>
    ((64 - WEIGHTS[index]) * e0 + WEIGHTS[index] * e1 + 32) >> 6

const finishUnsigned = (v: number): number => (v * 31) >> 6

function finishSigned(v: number): number {
    const magnitude = v < 0 ? ((-v) * 31) >> 5 : (v * 31) >> 5
    return v < 0 ? 0x8000 | magnitude : magnitude
}

function half(bits: number): number {
    const sign = bits & 0x8000 ? -1 : 1
    const e = (bits >> 10) & 0x1f
    const m = bits & 0x3ff
    if (e === 0) return sign * (m / 1024) * Math.pow(2, -14)
    if (e === 31) return m ? NaN : sign * Infinity
    return sign * Math.pow(2, e - 15) * (1 + m / 1024)
}

// ---- a mode 11 block, bit by bit -----------------------------------------

type Channel = [number, number] // the two endpoints, as 10-bit signed values

function block(r: Channel, g: Channel, b: Channel, indices: number[]): Uint8Array {
    const out = new Uint8Array(16)
    let at = 0
    const put = (value: number, bits: number) => {
        for (let i = 0; i < bits; i++, at++) if ((value >> i) & 1) out[at >> 3] |= 1 << (at & 7)
    }
    put(0b00011, 5) // mode 11: one region, 10-bit endpoints, not transformed
    for (const endpoint of [r[0], g[0], b[0], r[1], g[1], b[1]]) put(endpoint & 0x3ff, 10)
    indices.forEach((index, pixel) => put(index, pixel === 0 ? 3 : 4)) // pixel 0 is the anchor
    expect(at).toBe(128)
    return out
}

// Pixel 0 takes index 0 (its anchor bit is implied), the rest 1 to 15.
const INDICES = Array.from({ length: 16 }, (_, i) => i)

function decode(bytes: Uint8Array, signed: boolean): Float32Array {
    // DXGI BC6H_SF16 is 96, BC6H_UF16 is 95
    const file = dds({ width: 4, height: 4, dx10: { format: signed ? 96 : 95 }, data: bytes })
    const info = parseDDSHeader(file)!
    expect(info.format).toBe(signed ? 'BC6H_SF16' : 'BC6H')
    return decodeImageFloat(file, info.format, info.layers[0])
}

function expected(channels: Channel[], signed: boolean): number[][] {
    return INDICES.map((index) =>
        channels.map(([e0, e1]) => {
            if (!signed) {
                const q0 = unquantizeUnsigned(e0 & 0x3ff)
                const q1 = unquantizeUnsigned(e1 & 0x3ff)
                return half(finishUnsigned(interpolate(q0, q1, index)))
            }
            return half(finishSigned(interpolate(unquantizeSigned(e0), unquantizeSigned(e1), index)))
        }),
    )
}

function check(channels: Channel[], signed: boolean): void {
    const got = decode(block(channels[0], channels[1], channels[2], INDICES), signed)
    expected(channels, signed).forEach((rgb, pixel) => {
        rgb.forEach((value, c) => expect(got[pixel * 4 + c]).toBe(value))
        expect(got[pixel * 4 + 3]).toBe(1)
    })
}

// A spread of cases a channel: both signs, zero, and the ends of the range,
// where unquantizing saturates.
const CASES: Channel[][] = [
    [[-100, 300], [-511, 511], [0, -1]],
    [[1, -1], [200, -200], [-300, -2]],
    [[511, -512], [0, 0], [100, 100]],
    [[-5, 5], [250, 260], [-400, 400]],
]

test('the blocks are built as the decoder reads them: unsigned agrees', () => {
    for (const channels of CASES) check(channels, false)
})

test('signed BC6H decodes every pixel as the specification computes it', () => {
    for (const channels of CASES) check(channels, true)
})

test('signed BC6H has negative values, and they are not the unsigned ones', () => {
    const channels: Channel[] = [[-100, 300], [-511, 511], [0, -1]]
    const signed = decode(block(channels[0], channels[1], channels[2], INDICES), true)
    const unsigned = decode(block(channels[0], channels[1], channels[2], INDICES), false)
    expect(signed[0]).toBeLessThan(0)
    expect(unsigned[0]).toBeGreaterThan(0)
    // -511 is past the range a 10-bit endpoint unquantizes within, and
    // saturates: the most negative finite value the finish can give.
    expect(signed[1]).toBe(half(finishSigned(-0x7fff)))
})

test('half floats convert exactly, subnormals included', () => {
    // The subnormals were wrong before: 0x0001 came out as 2^-20, not 2^-24.
    const cases: Array<[number, number]> = [
        [0x0001, Math.pow(2, -24)],
        [0x0200, Math.pow(2, -15)],
        [0x03ff, 1023 * Math.pow(2, -24)],
        [0x8001, -Math.pow(2, -24)],
        [0x0400, Math.pow(2, -14)],
        [0x3c00, 1],
        [0xc000, -2],
        [0x7bff, 65504],
        [0x7c00, Infinity],
        [0xfc00, -Infinity],
    ]
    for (const [bits, value] of cases) expect(halfToFloat(bits)).toBe(value)
    expect(halfToFloat(0x7e00)).toBeNaN()
    for (let bits = 0; bits < 0x7c00; bits++) expect(halfToFloat(bits)).toBe(half(bits))
})
