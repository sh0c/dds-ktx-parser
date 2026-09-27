// ETC1, ETC2 and EAC: the block formats of OpenGL ES and Vulkan on phones.
//
// Written from the Khronos Data Format Specification 1.3, sections 21
// (ETC1), 22 (ETC2) and 22.5 (EAC). A block is 64 bits read big-endian —
// the opposite of the BC formats — and its pixels are numbered down the
// columns: pixel k is at x = k >> 2, y = k & 3.
//
// ETC1 is decoded as ETC2 RGB: every valid ETC1 block means the same in
// both, and ETC2's extra modes are ETC1 blocks that would have overflowed.

// Output buffers, reused: decodeImage copies each block out before the next.
const out = new Uint8Array(64)
const outFloat = new Float32Array(64)

// ETC1's intensity modifier table: each row's small and large step.
const modifiers = [
    [2, 8],
    [5, 17],
    [9, 29],
    [13, 42],
    [18, 60],
    [24, 80],
    [33, 106],
    [47, 183],
]

// T and H modes' distances.
const distances = [3, 6, 11, 16, 23, 32, 41, 64]

// EAC's modifier table, a row of eight per table index.
const eacModifiers = [
    [-3, -6, -9, -15, 2, 5, 8, 14],
    [-3, -7, -10, -13, 2, 6, 9, 12],
    [-2, -5, -8, -13, 1, 4, 7, 12],
    [-2, -4, -6, -13, 1, 3, 5, 12],
    [-3, -6, -8, -12, 2, 5, 7, 11],
    [-3, -7, -9, -11, 2, 6, 8, 10],
    [-4, -7, -8, -11, 3, 6, 7, 10],
    [-3, -5, -8, -11, 2, 4, 7, 10],
    [-2, -6, -8, -10, 1, 5, 7, 9],
    [-2, -5, -8, -10, 1, 4, 7, 9],
    [-2, -4, -8, -10, 1, 3, 7, 9],
    [-2, -5, -7, -10, 1, 4, 6, 9],
    [-3, -4, -7, -10, 2, 3, 6, 9],
    [-1, -2, -3, -10, 0, 1, 2, 9],
    [-4, -6, -8, -9, 3, 5, 7, 8],
    [-3, -5, -7, -9, 2, 4, 6, 8],
]

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v)
const extend4 = (v: number): number => (v << 4) | v
const extend5 = (v: number): number => (v << 3) | (v >> 2)
const extend6 = (v: number): number => (v << 2) | (v >> 4)
const extend7 = (v: number): number => (v << 1) | (v >> 6)
// A 3-bit two's complement difference.
const signed3 = (v: number): number => (v & 4 ? v - 8 : v)

function be32(bytes: Uint8Array, at: number): number {
    return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

// Where pixel k of a block goes in a 4×4 RGBA row-major output.
const place = (k: number): number => ((k & 3) * 4 + (k >> 2)) * 4

// Pixel k's two-bit index: its most significant bit in the upper half of
// the low word, its least in the lower half.
const pixelIndex = (lo: number, k: number): number => (((lo >>> (16 + k)) & 1) << 1) | ((lo >>> k) & 1)

function paint(k: number, r: number, g: number, b: number, a: number): void {
    const o = place(k)
    out[o] = r
    out[o + 1] = g
    out[o + 2] = b
    out[o + 3] = a
}

// T and H modes: four paint colours, a pixel's index choosing one. With a
// punchthrough block that is not opaque, index 2 is transparent black.
function paintColours(
    lo: number,
    colours: number[][],
    transparentAt2: boolean,
): void {
    for (let k = 0; k < 16; k++) {
        const index = pixelIndex(lo, k)
        if (transparentAt2 && index === 2) paint(k, 0, 0, 0, 0)
        else paint(k, colours[index][0], colours[index][1], colours[index][2], 255)
    }
}

const add = (c: number[], d: number): number[] => [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d)]

function modeT(hi: number, lo: number, transparent: boolean): void {
    const c1 = [
        extend4((((hi >>> 27) & 3) << 2) | ((hi >>> 24) & 3)),
        extend4((hi >>> 20) & 15),
        extend4((hi >>> 16) & 15),
    ]
    const c2 = [extend4((hi >>> 12) & 15), extend4((hi >>> 8) & 15), extend4((hi >>> 4) & 15)]
    const d = distances[(((hi >>> 2) & 3) << 1) | (hi & 1)]
    paintColours(lo, [c1, add(c2, d), c2, add(c2, -d)], transparent)
}

function modeH(hi: number, lo: number, transparent: boolean): void {
    const r1 = (hi >>> 27) & 15
    const g1 = (((hi >>> 24) & 7) << 1) | ((hi >>> 20) & 1)
    const b1 = (((hi >>> 19) & 1) << 3) | ((hi >>> 15) & 7)
    const r2 = (hi >>> 11) & 15
    const g2 = (hi >>> 7) & 15
    const b2 = (hi >>> 3) & 15
    // The distance's lowest bit is not stored: it is which colour is larger.
    const order = (r1 << 8) | (g1 << 4) | b1
    const other = (r2 << 8) | (g2 << 4) | b2
    const d = distances[(((hi >>> 2) & 1) << 2) | ((hi & 1) << 1) | (order >= other ? 1 : 0)]
    const c1 = [extend4(r1), extend4(g1), extend4(b1)]
    const c2 = [extend4(r2), extend4(g2), extend4(b2)]
    paintColours(lo, [add(c1, d), add(c1, -d), add(c2, d), add(c2, -d)], transparent)
}

function modePlanar(hi: number, lo: number): void {
    const ro = extend6((hi >>> 25) & 63)
    const go = extend7((((hi >>> 24) & 1) << 6) | ((hi >>> 17) & 63))
    const bo = extend6((((hi >>> 16) & 1) << 5) | (((hi >>> 11) & 3) << 3) | ((hi >>> 7) & 7))
    const rh = extend6((((hi >>> 2) & 31) << 1) | (hi & 1))
    const gh = extend7((lo >>> 25) & 127)
    const bh = extend6((lo >>> 19) & 63)
    const rv = extend6((lo >>> 13) & 63)
    const gv = extend7((lo >>> 6) & 127)
    const bv = extend6(lo & 63)
    for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
            const o = (y * 4 + x) * 4
            out[o] = clamp255((x * (rh - ro) + y * (rv - ro) + 4 * ro + 2) >> 2)
            out[o + 1] = clamp255((x * (gh - go) + y * (gv - go) + 4 * go + 2) >> 2)
            out[o + 2] = clamp255((x * (bh - bo) + y * (bv - bo) + 4 * bo + 2) >> 2)
            out[o + 3] = 255
        }
}

// ETC2 RGB, and with @punchthrough, ETC2 RGB A1: its "diff" bit says
// whether the block is opaque, and there is no individual mode.
function decodeColour(bytes: Uint8Array, at: number, punchthrough: boolean): void {
    const hi = be32(bytes, at)
    const lo = be32(bytes, at + 4)
    const diffBit = (hi >>> 1) & 1
    const flip = hi & 1
    const opaque = !punchthrough || diffBit === 1

    let base1: number[]
    let base2: number[]
    if (!punchthrough && diffBit === 0) {
        // Individual: two 4-bit colours.
        base1 = [extend4((hi >>> 28) & 15), extend4((hi >>> 20) & 15), extend4((hi >>> 12) & 15)]
        base2 = [extend4((hi >>> 24) & 15), extend4((hi >>> 16) & 15), extend4((hi >>> 8) & 15)]
    } else {
        // Differential: a 5-bit colour and a 3-bit difference. A second
        // colour past 0..31 is not ETC1 at all, but one of ETC2's modes.
        const r = (hi >>> 27) & 31
        const g = (hi >>> 19) & 31
        const b = (hi >>> 11) & 31
        const r2 = r + signed3((hi >>> 24) & 7)
        const g2 = g + signed3((hi >>> 16) & 7)
        const b2 = b + signed3((hi >>> 8) & 7)
        if (r2 < 0 || r2 > 31) return modeT(hi, lo, !opaque)
        if (g2 < 0 || g2 > 31) return modeH(hi, lo, !opaque)
        if (b2 < 0 || b2 > 31) return modePlanar(hi, lo)
        base1 = [extend5(r), extend5(g), extend5(b)]
        base2 = [extend5(r2), extend5(g2), extend5(b2)]
    }

    const table1 = modifiers[(hi >>> 5) & 7]
    const table2 = modifiers[(hi >>> 2) & 7]
    for (let k = 0; k < 16; k++) {
        const x = k >> 2
        const y = k & 3
        // flip 0: two halves side by side; flip 1: one above the other.
        const second = flip ? y >= 2 : x >= 2
        const base = second ? base2 : base1
        const table = second ? table2 : table1
        const index = pixelIndex(lo, k)
        if (!opaque && index === 2) {
            paint(k, 0, 0, 0, 0)
            continue
        }
        // 00 small up, 01 large up, 10 small down, 11 large down — and in a
        // punchthrough block that is not opaque, the small step is none.
        let step = index & 1 ? table[1] : opaque ? table[0] : 0
        if (index & 2) step = -step
        paint(k, clamp255(base[0] + step), clamp255(base[1] + step), clamp255(base[2] + step), 255)
    }
}

// EAC: a base, a multiplier, a table, and 16 three-bit indices, pixel 0 in
// the top bits of the 48.
function eacIndices(bytes: Uint8Array, at: number): number[] {
    const high = (bytes[at + 2] << 16) | (bytes[at + 3] << 8) | bytes[at + 4]
    const low = (bytes[at + 5] << 16) | (bytes[at + 6] << 8) | bytes[at + 7]
    const indices: number[] = new Array(16)
    for (let k = 0; k < 8; k++) indices[k] = (high >> (21 - 3 * k)) & 7
    for (let k = 0; k < 8; k++) indices[8 + k] = (low >> (21 - 3 * k)) & 7
    return indices
}

// EAC's 8-bit alpha, into channel 3 of the output.
function decodeAlpha(bytes: Uint8Array, at: number): void {
    const base = bytes[at]
    const multiplier = bytes[at + 1] >> 4
    const table = eacModifiers[bytes[at + 1] & 15]
    const indices = eacIndices(bytes, at)
    for (let k = 0; k < 16; k++) out[place(k) + 3] = clamp255(base + table[indices[k]] * multiplier)
}

// EAC R11 into @channel of the float output: unsigned in [0, 1], signed in
// [-1, 1]. A multiplier of 0 means a multiplier of 1/8.
function decodeEleven(bytes: Uint8Array, at: number, signed: boolean, channel: number): void {
    const multiplier = bytes[at + 1] >> 4
    const table = eacModifiers[bytes[at + 1] & 15]
    const indices = eacIndices(bytes, at)
    for (let k = 0; k < 16; k++) {
        const modifier = table[indices[k]] * (multiplier ? multiplier * 8 : 1)
        let v: number
        if (signed) {
            // A signed base: -128 is read as -127, and there is no +4.
            let base = bytes[at] > 127 ? bytes[at] - 256 : bytes[at]
            if (base === -128) base = -127
            v = base * 8 + modifier
            v = v < -1023 ? -1023 : v > 1023 ? 1023 : v
            v /= 1023
        } else {
            v = bytes[at] * 8 + 4 + modifier
            v = v < 0 ? 0 : v > 2047 ? 2047 : v
            v /= 2047
        }
        const o = place(k)
        outFloat[o + channel] = v
    }
}

export function decodeETC2Block(bytes: Uint8Array): Uint8Array {
    decodeColour(bytes, 0, false)
    return out
}

export function decodeETC2A1Block(bytes: Uint8Array): Uint8Array {
    decodeColour(bytes, 0, true)
    return out
}

// ETC2 RGBA: EAC alpha in the first eight bytes, ETC2 colour in the next.
export function decodeETC2RGBABlock(bytes: Uint8Array): Uint8Array {
    decodeColour(bytes, 8, false)
    decodeAlpha(bytes, 0)
    return out
}

export function decodeEACR11Block(bytes: Uint8Array, signed: boolean): Float32Array {
    outFloat.fill(0)
    decodeEleven(bytes, 0, signed, 0)
    for (let k = 0; k < 16; k++) outFloat[k * 4 + 3] = 1
    return outFloat
}

// EAC RG11: red in the first eight bytes, green in the next.
export function decodeEACRG11Block(bytes: Uint8Array, signed: boolean): Float32Array {
    outFloat.fill(0)
    decodeEleven(bytes, 0, signed, 0)
    decodeEleven(bytes, 8, signed, 1)
    for (let k = 0; k < 16; k++) outFloat[k * 4 + 3] = 1
    return outFloat
}
