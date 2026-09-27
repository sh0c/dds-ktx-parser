// ASTC: Adaptive Scalable Texture Compression, every 2D block size, LDR,
// sRGB and HDR.
//
// Written from the Khronos Data Format Specification 1.3, section 23 (ASTC),
// and compared with ARM's astcenc, the reference encoder and decoder, on
// blocks it wrote and on random ones (see tests/oracle). Where the
// specification leaves a choice to the decoder, this does what astcenc does:
//
// - 8-bit output takes the top 8 bits of the interpolated 16-bit value — the
//   specification's decode_unorm8, which astcenc uses for 8-bit images.
// - sRGB endpoints are widened to 16 bits as (value << 8) | 0x80, alpha too.
// - A block that is not valid ASTC decodes to NaN in floats, and the error
//   colour in bytes; an HDR endpoint in an LDR format is the error colour
//   (magenta) as an endpoint.
// - A negative channel of an HDR void-extent block decodes to NaN.

import { halfToFloat, unorm8 } from '../bytes'

export type AstcProfile = 'ldr' | 'srgb' | 'hdr'

/* ---- reading bits ---------------------------------------------------- */

// Up to 8 bits at a bit offset, little-endian, reading zeros past the end.
function readBits(bytes: Uint8Array, count: number, offset: number): number {
    if (count === 0) return 0
    const at = offset >> 3
    const value = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16)
    return (value >> (offset & 7)) & ((1 << count) - 1)
}

function reverseByte(b: number): number {
    b = ((b & 0x0f) << 4) | ((b >> 4) & 0x0f)
    b = ((b & 0x33) << 2) | ((b >> 2) & 0x33)
    return ((b & 0x55) << 1) | ((b >> 1) & 0x55)
}

/* ---- quantization levels -------------------------------------------- */

// Each level of the integer sequence encoding: how many values it has, and
// whether they are a number of plain bits, a trit and bits, or a quint and
// bits. Level indices are the specification's QUANT_2 (0) to QUANT_256 (20).
interface Level {
    range: number
    bits: number
    trits: boolean
    quints: boolean
}
const LEVELS: Level[] = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256].map(
    (range) => {
        const trits = range % 3 === 0
        const quints = range % 5 === 0
        const base = trits ? range / 3 : quints ? range / 5 : range
        return { range, bits: Math.log2(base), trits, quints }
    },
)
const QUANT_6 = 4

// The bits a sequence of @count values of @level takes.
export function iseBits(level: number, count: number): number {
    const l = LEVELS[level]
    if (l.trits) return count * l.bits + Math.floor((8 * count + 4) / 5)
    if (l.quints) return count * l.bits + Math.floor((7 * count + 2) / 3)
    return count * l.bits
}

// The five trits packed in eight bits, and the three quints in seven, as
// the specification decodes them.
function trits(t: number): number[] {
    let c: number
    let t3: number
    let t4: number
    if (((t >> 2) & 7) === 7) {
        c = (((t >> 5) & 7) << 2) | (t & 3)
        t4 = 2
        t3 = 2
    } else {
        c = t & 31
        if (((t >> 5) & 3) === 3) {
            t4 = 2
            t3 = (t >> 7) & 1
        } else {
            t4 = (t >> 7) & 1
            t3 = (t >> 5) & 3
        }
    }
    let t0: number
    let t1: number
    let t2: number
    if ((c & 3) === 3) {
        t2 = 2
        t1 = (c >> 4) & 1
        t0 = (((c >> 3) & 1) << 1) | ((c >> 2) & 1 & ~(c >> 3) & 1)
    } else if (((c >> 2) & 3) === 3) {
        t2 = 2
        t1 = 2
        t0 = c & 3
    } else {
        t2 = (c >> 4) & 1
        t1 = (c >> 2) & 3
        t0 = (((c >> 1) & 1) << 1) | (c & 1 & ~(c >> 1) & 1)
    }
    return [t0, t1, t2, t3, t4]
}

function quints(q: number): number[] {
    if (((q >> 1) & 3) === 3 && ((q >> 5) & 3) === 0) {
        const q2 = ((q & 1) << 2) | ((((q >> 4) & 1) & ~q & 1) << 1) | (((q >> 3) & 1) & ~q & 1)
        return [4, 4, q2]
    }
    let q2: number
    let c: number
    if (((q >> 1) & 3) === 3) {
        q2 = 4
        c = (((q >> 3) & 3) << 3) | ((~(q >> 5) & 3) << 1) | (q & 1)
    } else {
        q2 = (q >> 5) & 3
        c = q & 31
    }
    if ((c & 7) === 5) return [(c >> 3) & 3, 4, q2]
    return [c & 7, (c >> 3) & 3, q2]
}

const TRITS = Array.from({ length: 256 }, (_, t) => trits(t))
const QUINTS = Array.from({ length: 128 }, (_, q) => quints(q))

// Decode @count values of @level from @bytes at @offset, each as the
// integer the sequence encodes: (trit or quint << bits) | bits.
function decodeISE(level: number, count: number, bytes: Uint8Array, offset: number): number[] {
    const { bits, trits: isTrit, quints: isQuint } = LEVELS[level]
    const values: number[] = new Array(count)
    if (!isTrit && !isQuint) {
        for (let i = 0; i < count; i++) {
            values[i] = readBits(bytes, bits, offset)
            offset += bits
        }
        return values
    }
    // A group of five trits (or three quints) interleaves their low bits
    // with the pieces of the packed trit (or quint) value.
    const group = isTrit ? 5 : 3
    const pieces = isTrit ? [2, 2, 1, 2, 1] : [3, 2, 2]
    const shifts = isTrit ? [0, 2, 4, 5, 7] : [0, 3, 5]
    for (let start = 0; start < count; start += group) {
        const low: number[] = []
        let packed = 0
        for (let j = 0; j < group; j++) {
            // Past the last value the group's bits are not there, and read as 0.
            if (start + j < count) {
                low.push(readBits(bytes, bits, offset))
                offset += bits
                packed |= readBits(bytes, pieces[j], offset) << shifts[j]
                offset += pieces[j]
            }
        }
        const high = isTrit ? TRITS[packed] : QUINTS[packed]
        for (let j = 0; j < group && start + j < count; j++) values[start + j] = (high[j] << bits) | low[j]
    }
    return values
}

/* ---- unquantization -------------------------------------------------- */

const replicate = (value: number, from: number, to: number): number => {
    let out = 0
    let have = 0
    while (have < to) {
        const take = Math.min(from, to - have)
        out = (out << take) | (value >> (from - take))
        have += take
    }
    return out
}

// The specification's bit patterns: letters are the bits of the value above
// its lowest ('a'), highest first; '0' is a zero bit.
function pattern(spec: string, bits: number): number {
    let out = 0
    for (const ch of spec) {
        out <<= 1
        if (ch !== '0') out |= (bits >> ('abcdef'.indexOf(ch))) & 1
    }
    return out
}

const COLOUR_TRIT: Array<[string, number]> = [
    ['000000000', 204],
    ['b000b0bb0', 93],
    ['cb000cbcb', 44],
    ['dcb000dcb', 22],
    ['edcb000ed', 11],
    ['fedcb000f', 5],
]
const COLOUR_QUINT: Array<[string, number]> = [
    ['000000000', 113],
    ['b0000bb00', 54],
    ['cb0000cbc', 26],
    ['dcb0000dc', 13],
    ['edcb0000e', 6],
]

// A colour value, 0 to 255, from an encoded value of @level.
function unquantColour(level: number, v: number): number {
    const { bits, trits: isTrit, quints: isQuint } = LEVELS[level]
    if (!isTrit && !isQuint) return replicate(v, bits, 8)
    const m = v & ((1 << bits) - 1)
    const d = v >> bits
    const a = m & 1 ? 0x1ff : 0
    const [spec, c] = (isTrit ? COLOUR_TRIT : COLOUR_QUINT)[bits - 1]
    let t = d * c + pattern(spec, m)
    t ^= a
    return (a & 0x80) | (t >> 2)
}

const WEIGHT_TRIT: Array<[string, number]> = [
    ['0000000', 50],
    ['b000b0b', 23],
    ['cb000cb', 11],
]
const WEIGHT_QUINT: Array<[string, number]> = [
    ['0000000', 28],
    ['b0000b0', 13],
]

// A weight, 0 to 64, from an encoded value of @level.
function unquantWeight(level: number, v: number): number {
    const { bits, trits: isTrit, quints: isQuint } = LEVELS[level]
    let t: number
    if (!isTrit && !isQuint) {
        t = replicate(v, bits, 6)
    } else if (bits === 0) {
        const d = v
        t = isTrit ? [0, 32, 63][d] : [0, 16, 32, 47, 63][d]
    } else {
        const m = v & ((1 << bits) - 1)
        const d = v >> bits
        const a = m & 1 ? 0x7f : 0
        const [spec, c] = (isTrit ? WEIGHT_TRIT : WEIGHT_QUINT)[bits - 1]
        t = d * c + pattern(spec, m)
        t ^= a
        t = (a & 0x20) | (t >> 2)
    }
    return t > 32 ? t + 1 : t
}

// Every level's table, from encoded value to unquantized, made once.
export const COLOUR_TABLES: number[][] = LEVELS.map((l, level) =>
    level < QUANT_6 ? [] : Array.from({ length: l.range }, (_, v) => unquantColour(level, v)),
)
export const WEIGHT_TABLES: number[][] = LEVELS.slice(0, 12).map((l, level) =>
    Array.from({ length: l.range }, (_, v) => unquantWeight(level, v)),
)

/* ---- block modes ----------------------------------------------------- */

interface BlockMode {
    xWeights: number
    yWeights: number
    dual: boolean
    level: number
    weightBits: number
}

// The eleven bits of a block mode, as the specification lays them out, or
// null for a reserved mode or one this block size cannot have.
function blockMode(mode: number, width: number, height: number): BlockMode | null {
    let base = (mode >> 4) & 1
    let h = (mode >> 9) & 1
    let d = (mode >> 10) & 1
    const a = (mode >> 5) & 3
    let x: number
    let y: number
    if ((mode & 3) !== 0) {
        base |= (mode & 3) << 1
        let b = (mode >> 7) & 3
        switch ((mode >> 2) & 3) {
            case 0:
                x = b + 4
                y = a + 2
                break
            case 1:
                x = b + 8
                y = a + 2
                break
            case 2:
                x = a + 2
                y = b + 8
                break
            default:
                b &= 1
                if (mode & 0x100) {
                    x = b + 2
                    y = a + 2
                } else {
                    x = a + 2
                    y = b + 6
                }
        }
    } else {
        base |= ((mode >> 2) & 3) << 1
        if (((mode >> 2) & 3) === 0) return null
        const b = (mode >> 9) & 3
        switch ((mode >> 7) & 3) {
            case 0:
                x = 12
                y = a + 2
                break
            case 1:
                x = a + 2
                y = 12
                break
            case 2:
                x = a + 6
                y = b + 6
                d = 0
                h = 0
                break
            default:
                if (((mode >> 5) & 3) === 0) {
                    x = 6
                    y = 10
                } else if (((mode >> 5) & 3) === 1) {
                    x = 10
                    y = 6
                } else return null
        }
    }
    if (x > width || y > height) return null
    const count = x * y * (d + 1)
    const level = base - 2 + 6 * h
    if (count > 64) return null
    const weightBits = iseBits(level, count)
    if (weightBits < 24 || weightBits > 96) return null
    return { xWeights: x, yWeights: y, dual: d === 1, level, weightBits }
}

/* ---- tables for a block size, made once each ------------------------- */

interface Grid {
    // For each texel: the four grid weights it blends, and how much of each.
    index: Int32Array
    factor: Int32Array
}

interface Size {
    width: number
    height: number
    modes: Array<BlockMode | null>
    grids: Map<number, Grid>
    partitions: Map<number, Uint8Array>
}

const sizes = new Map<number, Size>()

function sizeOf(width: number, height: number): Size {
    const key = width * 16 + height
    let size = sizes.get(key)
    if (!size) {
        size = {
            width,
            height,
            modes: Array.from({ length: 2048 }, (_, m) => blockMode(m, width, height)),
            grids: new Map(),
            partitions: new Map(),
        }
        sizes.set(key, size)
    }
    return size
}

// How a weight grid of xw × yw is stretched over the block's texels: the
// specification's bilinear infill, in its fixed point.
function gridOf(size: Size, xw: number, yw: number): Grid {
    const key = xw * 16 + yw
    let grid = size.grids.get(key)
    if (grid) return grid
    const { width, height } = size
    const texels = width * height
    const index = new Int32Array(texels * 4)
    const factor = new Int32Array(texels * 4)
    const ds = Math.floor((1024 + (width >> 1)) / (width - 1))
    const dt = Math.floor((1024 + (height >> 1)) / (height - 1))
    for (let t = 0; t < height; t++) {
        for (let s = 0; s < width; s++) {
            const gs = (ds * s * (xw - 1) + 32) >> 6
            const gt = (dt * t * (yw - 1) + 32) >> 6
            const js = gs >> 4
            const fs = gs & 15
            const jt = gt >> 4
            const ft = gt & 15
            const v0 = js + jt * xw
            const w11 = (fs * ft + 8) >> 4
            const w10 = ft - w11
            const w01 = fs - w11
            const w00 = 16 - fs - ft + w11
            const at = (t * width + s) * 4
            // Out-of-range neighbours carry no weight; point them at v0.
            index[at] = v0
            index[at + 1] = w01 ? v0 + 1 : v0
            index[at + 2] = w10 ? v0 + xw : v0
            index[at + 3] = w11 ? v0 + xw + 1 : v0
            factor[at] = w00
            factor[at + 1] = w01
            factor[at + 2] = w10
            factor[at + 3] = w11
        }
    }
    grid = { index, factor }
    size.grids.set(key, grid)
    return grid
}

function hash52(p: number): number {
    p ^= p >>> 15
    p = Math.imul(p, 0xeede0891)
    p ^= p >>> 5
    p = (p + (p << 16)) | 0
    p ^= p >>> 7
    p ^= p >>> 3
    p ^= p << 6
    p ^= p >>> 17
    return p >>> 0
}

// Which partition each texel is in: the specification's hash of the
// partition index, the partition count and the texel's place.
function partitionOf(size: Size, count: number, seedIndex: number): Uint8Array {
    const key = count * 1024 + seedIndex
    let table = size.partitions.get(key)
    if (table) return table
    const { width, height } = size
    const small = width * height < 31
    table = new Uint8Array(width * height)
    const seed = seedIndex + (count - 1) * 1024
    const rnum = hash52(seed)
    const s = [
        rnum & 15,
        (rnum >>> 4) & 15,
        (rnum >>> 8) & 15,
        (rnum >>> 12) & 15,
        (rnum >>> 16) & 15,
        (rnum >>> 20) & 15,
        (rnum >>> 24) & 15,
        (rnum >>> 28) & 15,
        (rnum >>> 18) & 15,
        (rnum >>> 22) & 15,
        (rnum >>> 26) & 15,
        ((rnum >>> 30) | (rnum << 2)) & 15,
    ].map((v) => v * v)
    let sh1: number
    let sh2: number
    if (seed & 1) {
        sh1 = seed & 2 ? 4 : 5
        sh2 = count === 3 ? 6 : 5
    } else {
        sh1 = count === 3 ? 6 : 5
        sh2 = seed & 2 ? 4 : 5
    }
    const sh3 = seed & 0x10 ? sh1 : sh2
    const shifts = [sh1, sh2, sh1, sh2, sh1, sh2, sh1, sh2, sh3, sh3, sh3, sh3]
    const k = s.map((v, i) => v >> shifts[i])
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const px = small ? x << 1 : x
            const py = small ? y << 1 : y
            let a = (k[0] * px + k[1] * py + (rnum >>> 14)) & 63
            let b = (k[2] * px + k[3] * py + (rnum >>> 10)) & 63
            let c = (k[4] * px + k[5] * py + (rnum >>> 6)) & 63
            let d = (k[6] * px + k[7] * py + (rnum >>> 2)) & 63
            if (count <= 3) d = 0
            if (count <= 2) c = 0
            if (count <= 1) b = 0
            let p: number
            if (a >= b && a >= c && a >= d) p = 0
            else if (b >= c && b >= d) p = 1
            else if (c >= d) p = 2
            else p = 3
            table[y * width + x] = p
        }
    }
    size.partitions.set(key, table)
    return table
}

/* ---- colour endpoints ------------------------------------------------ */

// An endpoint pair: two RGBA colours, and whether its RGB and its alpha are
// HDR (in LNS) rather than LDR.
interface Endpoints {
    e0: number[]
    e1: number[]
    rgbHdr: boolean
    alphaHdr: boolean
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

// Blue contraction: the endpoint's red and green are averaged with blue.
const uncontract = (c: number[]): number[] => [(c[0] + c[2]) >> 1, (c[1] + c[2]) >> 1, c[2], c[3]]

// The specification's bit transfer between a signed delta and its base.
function bitTransferSigned(a: number, b: number): [number, number] {
    b >>= 1
    b |= a & 0x80
    a >>= 1
    a &= 0x3f
    if (a & 0x20) a -= 0x40
    return [a, b]
}

function hdrRgbo(v: number[]): [number[], number[]] {
    const [v0, v1, v2, v3] = v
    const modeval = ((v0 & 0xc0) >> 6) | (((v1 & 0x80) >> 7) << 2) | (((v2 & 0x80) >> 7) << 3)
    let majcomp: number
    let mode: number
    if ((modeval & 0xc) !== 0xc) {
        majcomp = modeval >> 2
        mode = modeval & 3
    } else if (modeval !== 0xf) {
        majcomp = modeval & 3
        mode = 4
    } else {
        majcomp = 0
        mode = 5
    }
    let red = v0 & 0x3f
    let green = v1 & 0x1f
    let blue = v2 & 0x1f
    let scale = v3 & 0x1f
    const bit0 = (v1 >> 6) & 1
    const bit1 = (v1 >> 5) & 1
    const bit2 = (v2 >> 6) & 1
    const bit3 = (v2 >> 5) & 1
    const bit4 = (v3 >> 7) & 1
    const bit5 = (v3 >> 6) & 1
    const bit6 = (v3 >> 5) & 1
    const oh = 1 << mode
    if (oh & 0x30) green |= bit0 << 6
    if (oh & 0x3a) green |= bit1 << 5
    if (oh & 0x30) blue |= bit2 << 6
    if (oh & 0x3a) blue |= bit3 << 5
    if (oh & 0x3d) scale |= bit6 << 5
    if (oh & 0x2d) scale |= bit5 << 6
    if (oh & 0x04) scale |= bit4 << 7
    if (oh & 0x3b) red |= bit4 << 6
    if (oh & 0x04) red |= bit3 << 6
    if (oh & 0x10) red |= bit5 << 7
    if (oh & 0x0f) red |= bit2 << 7
    if (oh & 0x05) red |= bit1 << 8
    if (oh & 0x0a) red |= bit0 << 8
    if (oh & 0x05) red |= bit0 << 9
    if (oh & 0x02) red |= bit6 << 9
    if (oh & 0x01) red |= bit3 << 10
    if (oh & 0x02) red |= bit5 << 10
    const shamt = [1, 1, 2, 3, 4, 5][mode]
    red <<= shamt
    green <<= shamt
    blue <<= shamt
    scale <<= shamt
    if (mode !== 5) {
        green = red - green
        blue = red - blue
    }
    if (majcomp === 1) [red, green] = [green, red]
    else if (majcomp === 2) [red, blue] = [blue, red]
    const r0 = Math.max(red - scale, 0)
    const g0 = Math.max(green - scale, 0)
    const b0 = Math.max(blue - scale, 0)
    red = Math.max(red, 0)
    green = Math.max(green, 0)
    blue = Math.max(blue, 0)
    return [
        [r0 << 4, g0 << 4, b0 << 4, 0x7800],
        [red << 4, green << 4, blue << 4, 0x7800],
    ]
}

function hdrRgb(v: number[]): [number[], number[]] {
    const [v0, v1, v2, v3, v4, v5] = v
    const modeval = ((v1 & 0x80) >> 7) | (((v2 & 0x80) >> 7) << 1) | (((v3 & 0x80) >> 7) << 2)
    const majcomp = ((v4 & 0x80) >> 7) | (((v5 & 0x80) >> 7) << 1)
    if (majcomp === 3) {
        return [
            [v0 << 8, v2 << 8, (v4 & 0x7f) << 9, 0x7800],
            [v1 << 8, v3 << 8, (v5 & 0x7f) << 9, 0x7800],
        ]
    }
    let a = v0 | ((v1 & 0x40) << 2)
    let b0 = v2 & 0x3f
    let b1 = v3 & 0x3f
    let c = v1 & 0x3f
    let d0 = v4 & 0x7f
    let d1 = v5 & 0x7f
    const dbits = [7, 6, 7, 6, 5, 6, 5, 6][modeval]
    const bit0 = (v2 >> 6) & 1
    const bit1 = (v3 >> 6) & 1
    const bit2 = (v4 >> 6) & 1
    const bit3 = (v5 >> 6) & 1
    const bit4 = (v4 >> 5) & 1
    const bit5 = (v5 >> 5) & 1
    const oh = 1 << modeval
    if (oh & 0xa4) a |= bit0 << 9
    if (oh & 0x8) a |= bit2 << 9
    if (oh & 0x50) a |= bit4 << 9
    if (oh & 0x50) a |= bit5 << 10
    if (oh & 0xa0) a |= bit1 << 10
    if (oh & 0xc0) a |= bit2 << 11
    if (oh & 0x4) c |= bit1 << 6
    if (oh & 0xe8) c |= bit3 << 6
    if (oh & 0x20) c |= bit2 << 7
    if (oh & 0x5b) {
        b0 |= bit0 << 6
        b1 |= bit1 << 6
    }
    if (oh & 0x12) {
        b0 |= bit2 << 7
        b1 |= bit3 << 7
    }
    if (oh & 0xaf) {
        d0 |= bit4 << 5
        d1 |= bit5 << 5
    }
    if (oh & 0x5) {
        d0 |= bit2 << 6
        d1 |= bit3 << 6
    }
    // Sign-extend the d values from dbits.
    const sx = 32 - dbits
    d0 = (d0 << sx) >> sx
    d1 = (d1 << sx) >> sx
    const shamt = (modeval >> 1) ^ 3
    a <<= shamt
    b0 <<= shamt
    b1 <<= shamt
    c <<= shamt
    d0 <<= shamt
    d1 <<= shamt
    let red1 = a
    let green1 = a - b0
    let blue1 = a - b1
    let red0 = a - c
    let green0 = a - b0 - c - d0
    let blue0 = a - b1 - c - d1
    red0 = clamp(red0, 0, 4095)
    green0 = clamp(green0, 0, 4095)
    blue0 = clamp(blue0, 0, 4095)
    red1 = clamp(red1, 0, 4095)
    green1 = clamp(green1, 0, 4095)
    blue1 = clamp(blue1, 0, 4095)
    if (majcomp === 1) {
        ;[red0, green0] = [green0, red0]
        ;[red1, green1] = [green1, red1]
    } else if (majcomp === 2) {
        ;[red0, blue0] = [blue0, red0]
        ;[red1, blue1] = [blue1, red1]
    }
    return [
        [red0 << 4, green0 << 4, blue0 << 4, 0x7800],
        [red1 << 4, green1 << 4, blue1 << 4, 0x7800],
    ]
}

function hdrAlpha(v6: number, v7: number): [number, number] {
    const modeval = ((v6 >> 7) & 1) | ((v7 >> 6) & 2)
    v6 &= 0x7f
    v7 &= 0x7f
    let a0: number
    let a1: number
    if (modeval === 3) {
        a0 = v6 << 5
        a1 = v7 << 5
    } else {
        v6 |= (v7 << (modeval + 1)) & 0x780
        v7 &= 0x3f >> modeval
        v7 ^= 32 >> modeval
        v7 -= 32 >> modeval
        v6 <<= 4 - modeval
        v7 <<= 4 - modeval
        a0 = v6
        a1 = clamp(v6 + v7, 0, 0xfff)
    }
    return [a0 << 4, a1 << 4]
}

// The endpoints of one partition from its colour endpoint mode and values,
// widened to 16 bits for @profile.
function endpoints(cem: number, v: number[], profile: AstcProfile): Endpoints {
    let e0: number[]
    let e1: number[]
    let rgbHdr = false
    let alphaHdr = false
    let defaultHdrAlpha = false
    switch (cem) {
        case 0: // luminance
            e0 = [v[0], v[0], v[0], 255]
            e1 = [v[1], v[1], v[1], 255]
            break
        case 1: {
            // luminance, delta
            const l0 = (v[0] >> 2) | (v[1] & 0xc0)
            const l1 = Math.min(l0 + (v[1] & 0x3f), 255)
            e0 = [l0, l0, l0, 255]
            e1 = [l1, l1, l1, 255]
            break
        }
        case 2: {
            // HDR luminance, large range
            let y0: number
            let y1: number
            if (v[1] >= v[0]) {
                y0 = v[0] << 4
                y1 = v[1] << 4
            } else {
                y0 = (v[1] << 4) + 8
                y1 = (v[0] << 4) - 8
            }
            e0 = [y0 << 4, y0 << 4, y0 << 4, 0x7800]
            e1 = [y1 << 4, y1 << 4, y1 << 4, 0x7800]
            rgbHdr = true
            defaultHdrAlpha = true
            break
        }
        case 3: {
            // HDR luminance, small range
            let y0: number
            let y1: number
            if (v[0] & 0x80) {
                y0 = ((v[1] & 0xe0) << 4) | ((v[0] & 0x7f) << 2)
                y1 = (v[1] & 0x1f) << 2
            } else {
                y0 = ((v[1] & 0xf0) << 4) | ((v[0] & 0x7f) << 1)
                y1 = (v[1] & 0xf) << 1
            }
            y1 = Math.min(y1 + y0, 0xfff)
            e0 = [y0 << 4, y0 << 4, y0 << 4, 0x7800]
            e1 = [y1 << 4, y1 << 4, y1 << 4, 0x7800]
            rgbHdr = true
            defaultHdrAlpha = true
            break
        }
        case 4: // luminance and alpha
            e0 = [v[0], v[0], v[0], v[2]]
            e1 = [v[1], v[1], v[1], v[3]]
            break
        case 5: {
            // luminance and alpha, delta
            let [l1, l0] = bitTransferSigned(v[1], v[0])
            let [a1, a0] = bitTransferSigned(v[3], v[2])
            l1 = clamp(l0 + l1, 0, 255)
            a1 = clamp(a0 + a1, 0, 255)
            e0 = [l0, l0, l0, a0]
            e1 = [l1, l1, l1, a1]
            break
        }
        case 6: {
            // RGB and scale
            e0 = [(v[0] * v[3]) >> 8, (v[1] * v[3]) >> 8, (v[2] * v[3]) >> 8, 255]
            e1 = [v[0], v[1], v[2], 255]
            break
        }
        case 7:
            ;[e0, e1] = hdrRgbo(v)
            rgbHdr = true
            defaultHdrAlpha = true
            break
        case 8:
        case 12: {
            // RGB(A), direct
            let c0 = [v[0], v[2], v[4], cem === 12 ? v[6] : 255]
            let c1 = [v[1], v[3], v[5], cem === 12 ? v[7] : 255]
            if (c0[0] + c0[1] + c0[2] > c1[0] + c1[1] + c1[2]) {
                ;[c0, c1] = [uncontract(c1), uncontract(c0)]
            }
            e0 = c0
            e1 = c1
            if (cem === 8) {
                e0[3] = 255
                e1[3] = 255
            }
            break
        }
        case 9:
        case 13: {
            // RGB(A), base and offset
            const pairs: Array<[number, number]> = [
                bitTransferSigned(v[1], v[0]),
                bitTransferSigned(v[3], v[2]),
                bitTransferSigned(v[5], v[4]),
                cem === 13 ? bitTransferSigned(v[7], v[6]) : [0, 255],
            ]
            let c0 = pairs.map(([, base]) => base)
            let c1 = pairs.map(([delta, base]) => base + delta)
            const sum = pairs[0][0] + pairs[1][0] + pairs[2][0]
            if (sum < 0) {
                ;[c0, c1] = [uncontract(c1), uncontract(c0)]
            }
            e0 = c0.map((c) => clamp(c, 0, 255))
            e1 = c1.map((c) => clamp(c, 0, 255))
            if (cem === 9) {
                e0[3] = 255
                e1[3] = 255
            }
            break
        }
        case 10: {
            // RGB and scale, with two alphas
            e0 = [(v[0] * v[3]) >> 8, (v[1] * v[3]) >> 8, (v[2] * v[3]) >> 8, v[4]]
            e1 = [v[0], v[1], v[2], v[5]]
            break
        }
        case 11:
            ;[e0, e1] = hdrRgb(v)
            rgbHdr = true
            defaultHdrAlpha = true
            break
        case 14:
            ;[e0, e1] = hdrRgb(v)
            e0[3] = v[6]
            e1[3] = v[7]
            rgbHdr = true
            break
        default: {
            // 15: HDR RGB and HDR alpha
            ;[e0, e1] = hdrRgb(v)
            const [a0, a1] = hdrAlpha(v[6], v[7])
            e0[3] = a0
            e1[3] = a1
            rgbHdr = true
            alphaHdr = true
        }
    }

    if (defaultHdrAlpha) {
        if (profile === 'hdr') {
            e0[3] = 0x7800
            e1[3] = 0x7800
            alphaHdr = true
        } else {
            e0[3] = 0xff
            e1[3] = 0xff
        }
    }

    if (profile !== 'hdr') {
        // An HDR endpoint in an LDR texture is the error colour.
        if (rgbHdr || alphaHdr) {
            e0 = [0xff, 0x00, 0xff, 0xff]
            e1 = [0xff, 0x00, 0xff, 0xff]
            rgbHdr = false
            alphaHdr = false
        }
        const widen = profile === 'srgb' ? (c: number) => (c << 8) | 0x80 : (c: number) => c * 257
        return { e0: e0.map(widen), e1: e1.map(widen), rgbHdr, alphaHdr }
    }
    // HDR: LDR channels are widened by replication, HDR ones are 16 bits already.
    const widen = (c: number, i: number) => ((i < 3 ? rgbHdr : alphaHdr) ? c : c * 257)
    return { e0: e0.map(widen), e1: e1.map(widen), rgbHdr, alphaHdr }
}

/* ---- to half floats -------------------------------------------------- */

// A 16-bit unorm as a half float, as astcenc rounds it.
export function unorm16ToHalf(p: number): number {
    if (p === 0xffff) return 0x3c00
    if (p < 4) return p << 8
    const lz = Math.clz32(p) - 16
    let q = (p * Math.pow(2, lz + 1)) & 0xffff
    q >>= 6
    return q | ((14 - lz) << 10)
}

// A 16-bit LNS value as a half float: the specification's conversion.
export function lnsToHalf(p: number): number {
    const mc = p & 0x7ff
    const ec = p >> 11
    let mt: number
    if (mc < 512) mt = mc * 3
    else if (mc < 1536) mt = mc * 4 - 512
    else mt = mc * 5 - 2048
    return Math.min((ec << 10) | (mt >> 3), 0x7bff)
}

/* ---- a block --------------------------------------------------------- */

// What a block decodes to before it is written out: for each texel, a
// 16-bit value a channel, and whether that channel is HDR.
export interface Decoded {
    values: Int32Array // texels × 4
    lns: Uint8Array // texels × 4
    // Not a valid block: every texel is the error colour.
    error: boolean
    // A void-extent block of half floats, already final.
    halves: boolean
}

function decodeBlock(block: Uint8Array, width: number, height: number, profile: AstcProfile): Decoded {
    const texels = width * height
    const values = new Int32Array(texels * 4)
    const lns = new Uint8Array(texels * 4)
    const fail: Decoded = { values, lns, error: true, halves: false }
    const size = sizeOf(width, height)
    const mode = readBits(block, 11, 0)

    // Void extent: one colour for the whole block.
    if ((mode & 0x1ff) === 0x1fc) {
        if (readBits(block, 2, 10) !== 3) return fail
        const lowS = readBits(block, 8, 12) | (readBits(block, 5, 20) << 8)
        const highS = readBits(block, 8, 25) | (readBits(block, 5, 33) << 8)
        const lowT = readBits(block, 8, 38) | (readBits(block, 5, 46) << 8)
        const highT = readBits(block, 8, 51) | (readBits(block, 5, 59) << 8)
        const allOnes = lowS === 0x1fff && highS === 0x1fff && lowT === 0x1fff && highT === 0x1fff
        if ((lowS >= highS || lowT >= highT) && !allOnes) return fail
        const colour = [0, 1, 2, 3].map((i) => block[8 + 2 * i] | (block[9 + 2 * i] << 8))
        const hdr = (mode & 0x200) !== 0
        if (hdr && profile !== 'hdr') return fail
        for (let i = 0; i < texels; i++)
            for (let c = 0; c < 4; c++) {
                // LDR: 16 bits, of which 8-bit output takes the top 8.
                values[i * 4 + c] = colour[c]
            }
        return { values, lns, error: false, halves: hdr }
    }

    const bm = size.modes[mode]
    if (!bm) return fail
    const partitions = readBits(block, 2, 11) + 1
    if (bm.dual && partitions === 4) return fail

    // The weights, read backwards from the top of the block.
    const reversed = new Uint8Array(16)
    for (let i = 0; i < 16; i++) reversed[i] = reverseByte(block[15 - i])
    const weightCount = bm.xWeights * bm.yWeights * (bm.dual ? 2 : 1)
    const weightTable = WEIGHT_TABLES[bm.level]
    const encodedWeights = decodeISE(bm.level, weightCount, reversed, 0)
    const weights = encodedWeights.map((w) => weightTable[w])
    let belowWeights = 128 - bm.weightBits

    // The colour endpoint mode of each partition.
    const cems: number[] = []
    let extraCemBits = 0
    let partitionIndex = 0
    if (partitions === 1) {
        cems.push(readBits(block, 4, 13))
    } else {
        partitionIndex = readBits(block, 8, 13) | (readBits(block, 2, 21) << 8)
        extraCemBits = 3 * partitions - 4
        belowWeights -= extraCemBits
        let encoded = readBits(block, 6, 23)
        let high = 0
        for (let got = 0; got < extraCemBits; got += 8)
            high |= readBits(block, Math.min(8, extraCemBits - got), belowWeights + got) << got
        encoded |= high << 6
        const baseClass = encoded & 3
        if (baseClass === 0) {
            for (let i = 0; i < partitions; i++) cems.push((encoded >> 2) & 15)
            belowWeights += extraCemBits
            extraCemBits = 0
        } else {
            let bit = 2
            for (let i = 0; i < partitions; i++) cems.push((((encoded >> bit++) & 1) + baseClass - 1) << 2)
            for (let i = 0; i < partitions; i++) {
                cems[i] |= (encoded >> bit) & 3
                bit += 2
            }
        }
    }

    // The colour values: as many as the modes need, at the finest level
    // that fits the bits left.
    const valueCount = cems.reduce((n, cem) => n + ((cem >> 2) + 1) * 2, 0)
    if (valueCount > 18) return fail
    let colourBits = (partitions === 1 ? 111 : 99) - bm.weightBits - extraCemBits - (bm.dual ? 2 : 0)
    if (colourBits < 0) colourBits = 0
    let colourLevel = -1
    for (let level = 20; level >= QUANT_6; level--) {
        if (iseBits(level, valueCount) <= colourBits) {
            colourLevel = level
            break
        }
    }
    if (colourLevel < QUANT_6) return fail
    const table = COLOUR_TABLES[colourLevel]
    const colourValues = decodeISE(colourLevel, valueCount, block, partitions === 1 ? 17 : 29).map((v) => table[v])

    const plane2 = bm.dual ? readBits(block, 2, belowWeights - 2) : -1

    // Each partition's endpoints.
    const pairs: Endpoints[] = []
    let at = 0
    for (const cem of cems) {
        const n = ((cem >> 2) + 1) * 2
        pairs.push(endpoints(cem, colourValues.slice(at, at + n), profile))
        at += n
    }

    // Each texel: its weights infilled from the grid, then the lerp.
    const grid = gridOf(size, bm.xWeights, bm.yWeights)
    const assign = partitions === 1 ? null : partitionOf(size, partitions, partitionIndex)
    const stride = bm.dual ? 2 : 1
    const planeWeight = (texel: number, plane: number): number => {
        const g = texel * 4
        return (
            (weights[grid.index[g] * stride + plane] * grid.factor[g] +
                weights[grid.index[g + 1] * stride + plane] * grid.factor[g + 1] +
                weights[grid.index[g + 2] * stride + plane] * grid.factor[g + 2] +
                weights[grid.index[g + 3] * stride + plane] * grid.factor[g + 3] +
                8) >>
            4
        )
    }
    for (let texel = 0; texel < texels; texel++) {
        const pair = pairs[assign ? assign[texel] : 0]
        const w1 = planeWeight(texel, 0)
        const w2 = bm.dual ? planeWeight(texel, 1) : w1
        for (let c = 0; c < 4; c++) {
            const w = c === plane2 ? w2 : w1
            values[texel * 4 + c] = (pair.e0[c] * (64 - w) + pair.e1[c] * w + 32) >> 6
            lns[texel * 4 + c] = (c < 3 ? pair.rgbHdr : pair.alphaHdr) ? 1 : 0
        }
    }
    return { values, lns, error: false, halves: false }
}

export { decodeBlock as decodeASTC }

// What a block is, for tests that want to know what they covered: void
// extent, not valid, or its partitions, endpoint modes and planes.
export function describeASTCBlock(
    block: Uint8Array,
    width: number,
    height: number,
): { kind: 'void' | 'error' | 'normal'; partitions?: number; cems?: number[]; dual?: boolean } {
    const mode = readBits(block, 11, 0)
    if ((mode & 0x1ff) === 0x1fc) return { kind: 'void' }
    const bm = sizeOf(width, height).modes[mode]
    if (!bm || decodeBlock(block, width, height, 'hdr').error) return { kind: 'error' }
    const partitions = readBits(block, 2, 11) + 1
    const cems: number[] = []
    if (partitions === 1) cems.push(readBits(block, 4, 13))
    else {
        const extra = 3 * partitions - 4
        const below = 128 - bm.weightBits - extra
        let encoded = readBits(block, 6, 23)
        let high = 0
        for (let got = 0; got < extra; got += 8) high |= readBits(block, Math.min(8, extra - got), below + got) << got
        encoded |= high << 6
        if ((encoded & 3) === 0) for (let i = 0; i < partitions; i++) cems.push((encoded >> 2) & 15)
        else {
            let bit = 2
            for (let i = 0; i < partitions; i++) cems.push((((encoded >> bit++) & 1) + (encoded & 3) - 1) << 2)
            for (let i = 0; i < partitions; i++) {
                cems[i] |= (encoded >> bit) & 3
                bit += 2
            }
        }
    }
    return { kind: 'normal', partitions, cems, dual: bm.dual }
}

/* ---- output ---------------------------------------------------------- */


// The value of one decoded channel as a float.
function toFloat(d: Decoded, i: number, profile: AstcProfile): number {
    const v = d.values[i]
    // A void-extent block's half floats as they are — except a negative one,
    // which astcenc decodes as NaN, channel by channel; so does this.
    if (d.halves) return v & 0x8000 ? NaN : halfToFloat(v)
    if (profile !== 'hdr') return v / 65535
    return halfToFloat(d.lns[i] ? lnsToHalf(v) : unorm16ToHalf(v))
}

const ERROR_BYTES = [255, 0, 255, 255]

// One block as RGBA bytes, rows of @width. LDR and sRGB take the top 8 bits
// of each 16-bit value; HDR is clamped to [0, 1].
export function decodeASTCBytes(block: Uint8Array, width: number, height: number, profile: AstcProfile): Uint8Array {
    const d = decodeBlock(block, width, height, profile)
    const out = new Uint8Array(width * height * 4)
    if (d.error) {
        for (let i = 0; i < out.length; i++) out[i] = ERROR_BYTES[i & 3]
        return out
    }
    if (profile !== 'hdr' && !d.halves) {
        for (let i = 0; i < out.length; i++) out[i] = d.values[i] >> 8
        return out
    }
    for (let i = 0; i < out.length; i++) out[i] = unorm8(toFloat(d, i, profile))
    return out
}

// One block as RGBA floats: HDR as it is, LDR in [0, 1], and NaN for a block
// that is not valid ASTC.
export function decodeASTCFloat(block: Uint8Array, width: number, height: number, profile: AstcProfile): Float32Array {
    const d = decodeBlock(block, width, height, profile)
    const out = new Float32Array(width * height * 4)
    if (d.error) return out.fill(NaN)
    for (let i = 0; i < out.length; i++) out[i] = toFloat(d, i, profile)
    return out
}
