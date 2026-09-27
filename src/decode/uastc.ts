// UASTC: Basis Universal's high-quality mode, LDR, 4×4 blocks of 16 bytes.
//
// Ported from Binomial's basis_universal transcoder (unpack_uastc, in
// transcoder/basisu_transcoder.cpp, v2_50), Apache License 2.0 — see
// THIRD-PARTY-NOTICES.md. Changed from the original: rewritten in
// TypeScript, and reading only what decoding needs. The mode tables and partition seeds are its; the
// dequantization tables and partition hash are this package's ASTC ones,
// which match ASTC's (UASTC is ASTC 4×4 repacked), and which basisu's own
// debug checks say give UASTC's partitions.
//
// Compared with KTX-Software's `ktx transcode --target rgba8` on files its
// `ktx create --encode uastc` wrote (see tests/oracle).

import { COLOUR_TABLES, WEIGHT_TABLES, partitionOf4x4 } from './astc'

// A mode's code is its lowest bits, 2 to 7 of them; this is the mode for
// every value of the first seven bits.
const MODE_OF = [
    11, 0, 10, 3, 11, 15, 12, 7, 11, 18, 10, 5, 11, 14, 12, 9, 11, 0, 10, 4, 11, 16, 12, 8, 11, 18, 10, 6, 11, 2, 12, 13,
    11, 0, 10, 3, 11, 17, 12, 7, 11, 18, 10, 5, 11, 14, 12, 9, 11, 0, 10, 4, 11, 1, 12, 8, 11, 18, 10, 6, 11, 2, 12, 13,
    11, 0, 10, 3, 11, 19, 12, 7, 11, 18, 10, 5, 11, 14, 12, 9, 11, 0, 10, 4, 11, 16, 12, 8, 11, 18, 10, 6, 11, 2, 12, 13,
    11, 0, 10, 3, 11, 17, 12, 7, 11, 18, 10, 5, 11, 14, 12, 9, 11, 0, 10, 4, 11, 1, 12, 8, 11, 18, 10, 6, 11, 2, 12, 13,
]
const CODE_BITS = [4, 6, 5, 5, 5, 5, 5, 5, 5, 5, 3, 2, 3, 5, 5, 7, 6, 6, 4, 7]

// Per mode (0 to 18; 8 is a solid colour).
const WEIGHT_BITS = [4, 2, 3, 2, 2, 3, 2, 2, 0, 2, 4, 2, 3, 1, 2, 4, 2, 2, 5]
const ENDPOINT_LEVEL = [19, 20, 8, 7, 12, 20, 18, 12, 0, 8, 13, 13, 19, 20, 20, 20, 20, 20, 11]
const SUBSETS = [1, 1, 2, 3, 2, 1, 1, 2, 0, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1]
const COMPONENTS = [3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 2, 2, 2, 3]
// Bits of hints for transcoding to BC1, BC7 and ETC, which decoding skips.
const HINT_BITS = [15, 15, 15, 15, 15, 15, 15, 15, 0, 23, 17, 17, 17, 23, 23, 23, 23, 23, 15]

// The ASTC partition index of each of UASTC's common patterns.
const SEEDS_2 = [28, 20, 16, 29, 91, 9, 107, 72, 149, 204, 50, 114, 496, 17, 78, 39, 252, 828, 43, 156, 116, 210, 476, 273, 684, 359, 246, 195, 694, 524]
const SEEDS_3 = [260, 74, 32, 156, 183, 15, 745, 0, 335, 902, 254]
const SEEDS_MODE_7 = [36, 48, 61, 137, 161, 183, 226, 281, 302, 307, 479, 495, 593, 594, 605, 799, 812, 988, 993]

// ASTC's levels: bits, and whether a trit or a quint, by level index.
const LEVEL_OF_RANGE = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256]
// The weight level of plain n-bit weights.
const WEIGHT_LEVEL = [-1, 0, 2, 5, 8, 11]

function reader(bytes: Uint8Array, start: number) {
    let at = start
    return (count: number): number => {
        let value = 0
        for (let i = 0; i < count; i++, at++) value |= ((bytes[at >> 3] >> (at & 7)) & 1) << i
        return value
    }
}

const out = new Uint8Array(64)
const ERROR = [255, 0, 255, 255]

function fail(): Uint8Array {
    for (let i = 0; i < 64; i++) out[i] = ERROR[i & 3]
    return out
}

// The ASTC interpolation to 8 bits, with sRGB's widening when @srgb.
function interpolate(l: number, h: number, w: number, srgb: boolean): number {
    const l16 = srgb ? (l << 8) | 0x80 : (l << 8) | l
    const h16 = srgb ? (h << 8) | 0x80 : (h << 8) | h
    return ((l16 * (64 - w) + h16 * w + 32) >> 6) >> 8
}

// One UASTC block to 4×4 RGBA bytes. A block of the reserved mode, or one
// naming a pattern there is not, is the error colour, magenta.
export function decodeUASTCBlock(block: Uint8Array, srgb: boolean): Uint8Array {
    const mode = MODE_OF[block[0] & 127]
    if (mode >= 19) return fail()
    const read = reader(block, CODE_BITS[mode])

    if (mode === 8) {
        const colour = [read(8), read(8), read(8), read(8)]
        for (let i = 0; i < 64; i++) out[i] = colour[i & 3]
        return out
    }
    read(HINT_BITS[mode])

    let subsets = 1
    let pattern = 0
    if (mode === 2 || mode === 4 || mode === 7 || mode === 9 || mode === 16) {
        pattern = read(5)
        subsets = 2
    } else if (mode === 3) {
        pattern = read(4)
        subsets = 3
    }
    let seed = 0
    if (subsets === 2) {
        const seeds = mode === 7 ? SEEDS_MODE_7 : SEEDS_2
        if (pattern >= seeds.length) return fail()
        seed = seeds[pattern]
    } else if (subsets === 3) {
        if (pattern >= SEEDS_3.length) return fail()
        seed = SEEDS_3[pattern]
    }

    let planes = 1
    let ccs = -1
    if (mode === 6 || mode === 11 || mode === 13) {
        ccs = read(2)
        planes = 2
    } else if (mode === 17) {
        ccs = 3
        planes = 2
    }

    // The endpoints: ASTC's values, but their trits and quints packed as
    // plain base-3 and base-5 numbers, ahead of the low bits.
    const comps = COMPONENTS[mode]
    const count = comps * 2 * subsets
    const level = ENDPOINT_LEVEL[mode]
    const range = LEVEL_OF_RANGE[level]
    const trits = range % 3 === 0
    const quints = range % 5 === 0
    const bits = Math.log2(trits ? range / 3 : quints ? range / 5 : range)
    const groups: number[] = []
    if (trits || quints) {
        const size = trits ? 5 : 3
        const total = Math.ceil(count / size)
        for (let i = 0; i < total; i++) {
            let width = trits ? 8 : 7
            if (i === total - 1) {
                const left = count - (total - 1) * size
                if (trits) width = [0, 2, 4, 5, 7, 8][left]
                else width = [0, 3, 5, 7][left]
            }
            groups.push(read(width))
        }
    }
    const table = COLOUR_TABLES[level]
    const endpoints: number[] = new Array(count)
    let accum = 0
    let left = 0
    let group = 0
    for (let i = 0; i < count; i++) {
        let value = read(bits)
        if (trits || quints) {
            if (left === 0) {
                accum = groups[group++]
                left = trits ? 5 : 3
            }
            const mul = trits ? 3 : 5
            value |= (accum % mul) << bits
            accum = Math.floor(accum / mul)
            left--
        }
        endpoints[i] = table[value]
    }

    // Which subset each texel is in, and each subset's first texel — its
    // anchor, whose weight has one bit fewer.
    const assign = subsets > 1 ? partitionOf4x4(subsets, seed) : null
    const anchors = new Set<number>()
    for (let s = 0; s < subsets; s++) anchors.add(assign ? assign.indexOf(s) : 0)
    const weightBits = WEIGHT_BITS[mode]
    const weights: number[] = new Array(16 * planes)
    for (let i = 0; i < 16 * planes; i++) weights[i] = read(weightBits - (anchors.has(i >> (planes - 1)) ? 1 : 0))
    const weightTable = WEIGHT_TABLES[WEIGHT_LEVEL[weightBits]]

    // Each subset's colours: RGB, RGBA, or luminance and alpha.
    const colour = (subset: number, which: 0 | 1, c: number): number => {
        const at = subset * comps * 2
        if (comps === 2) return endpoints[at + (c === 3 ? 2 : 0) + which]
        return c < comps ? endpoints[at + c * 2 + which] : 255
    }
    for (let texel = 0; texel < 16; texel++) {
        const subset = assign ? assign[texel] : 0
        const w0 = weightTable[weights[texel * planes]]
        const w1 = planes === 2 ? weightTable[weights[texel * 2 + 1]] : w0
        for (let c = 0; c < 4; c++) {
            const w = c === ccs ? w1 : w0
            // Alpha an RGB mode does not have is 255, not interpolated.
            if (comps === 3 && c === 3) out[texel * 4 + 3] = 255
            else out[texel * 4 + c] = interpolate(colour(subset, 0, c), colour(subset, 1, c), w, srgb)
        }
    }
    return out
}
