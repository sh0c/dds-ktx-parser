// Small DDS and KTX files built byte by byte, so a test can have exactly the
// header it is about: a format no fixture is in, a cube map, a lie.

function put32(bytes: Uint8Array, at: number, value: number): void {
    new DataView(bytes.buffer, bytes.byteOffset).setUint32(at, value >>> 0, true)
}

const fourCC = (s: string): number =>
    s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)

export const DDPF_ALPHAPIXELS = 0x1
export const DDPF_ALPHA = 0x2
export const DDPF_FOURCC = 0x4
export const DDPF_RGB = 0x40
export const DDPF_LUMINANCE = 0x20000
export const CAPS2_CUBEMAP_ALL = 0x200 | 0xfc00
export const CAPS2_VOLUME = 0x200000

export interface DDSOptions {
    width: number
    height: number
    levels?: number
    depth?: number
    caps2?: number
    // the pixel format written before DX10: flags, bit count, masks
    masks?: { flags: number; bits: number; r: number; g: number; b: number; a: number }
    fourCC?: string | number
    dx10?: { format: number; dimension?: number; misc?: number; arraySize?: number }
    data: Uint8Array
}

export function dds(o: DDSOptions): Uint8Array {
    const header = o.dx10 ? 148 : 128
    const out = new Uint8Array(header + o.data.length)
    put32(out, 0, fourCC('DDS '))
    put32(out, 4, 124)
    put32(out, 8, 0x1007 | (o.levels ? 0x20000 : 0) | (o.depth ? 0x800000 : 0))
    put32(out, 12, o.height)
    put32(out, 16, o.width)
    put32(out, 24, o.depth ?? 0)
    put32(out, 28, o.levels ?? 0)
    put32(out, 76, 32)
    if (o.dx10 || o.fourCC !== undefined) {
        put32(out, 80, DDPF_FOURCC)
        put32(out, 84, o.dx10 ? fourCC('DX10') : typeof o.fourCC === 'string' ? fourCC(o.fourCC) : (o.fourCC as number))
    } else if (o.masks) {
        put32(out, 80, o.masks.flags)
        put32(out, 88, o.masks.bits)
        put32(out, 92, o.masks.r)
        put32(out, 96, o.masks.g)
        put32(out, 100, o.masks.b)
        put32(out, 104, o.masks.a)
    }
    put32(out, 108, 0x1000)
    put32(out, 112, o.caps2 ?? 0)
    if (o.dx10) {
        put32(out, 128, o.dx10.format)
        put32(out, 132, o.dx10.dimension ?? 3)
        put32(out, 136, o.dx10.misc ?? 0)
        put32(out, 140, o.dx10.arraySize ?? 1)
    }
    out.set(o.data, header)
    return out
}

export interface KTXOptions {
    internalFormat: number
    type?: number
    width: number
    height: number
    depth?: number
    arrays?: number
    faces?: number
    // each level's bytes, every face and element of it, padded as the file wants
    levels: Uint8Array[]
    // what each level's imageSize says; its data's length when not given
    imageSizes?: number[]
    keyValueBytes?: number
    endianness?: number
    magic?: number[]
}

export const KTX1 = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]
export const KTX2 = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]

export function ktx(o: KTXOptions): Uint8Array {
    const kv = o.keyValueBytes ?? 0
    const pad = (n: number): number => Math.ceil(n / 4) * 4
    const length = 64 + kv + o.levels.reduce((sum, level) => sum + 4 + pad(level.length), 0)
    const out = new Uint8Array(length)
    out.set(o.magic ?? KTX1, 0)
    put32(out, 12, o.endianness ?? 0x04030201)
    put32(out, 16, o.type ?? 0)
    put32(out, 20, 1)
    put32(out, 28, o.internalFormat)
    put32(out, 36, o.width)
    put32(out, 40, o.height)
    put32(out, 44, o.depth ?? 0)
    put32(out, 48, o.arrays ?? 0)
    put32(out, 52, o.faces ?? 1)
    put32(out, 56, o.levels.length)
    put32(out, 60, kv)
    let at = 64 + kv
    o.levels.forEach((level, i) => {
        put32(out, at, o.imageSizes?.[i] ?? level.length)
        out.set(level, at + 4)
        at += 4 + pad(level.length)
    })
    return out
}

// A reader over bytes in memory that counts what it is asked for.
export function counting(bytes: Uint8Array): {
    read: (offset: number, length: number) => Promise<Uint8Array>
    asked: Array<[number, number]>
} {
    const asked: Array<[number, number]> = []
    return {
        asked,
        read: async (offset, length) => {
            asked.push([offset, length])
            return bytes.slice(offset, offset + length)
        },
    }
}

export const half = (x: number): number => {
    // Enough of float-to-half for the values the tests use.
    const f = new Float32Array([x])
    const b = new Uint32Array(f.buffer)[0]
    const sign = (b >>> 16) & 0x8000
    const e = ((b >>> 23) & 0xff) - 127 + 15
    const m = (b >>> 13) & 0x3ff
    return x === 0 ? 0 : sign | (e << 10) | m
}

export const u16s = (...values: number[]): Uint8Array => {
    const out = new Uint8Array(values.length * 2)
    values.forEach((v, i) => new DataView(out.buffer).setUint16(i * 2, v, true))
    return out
}

export const f32s = (...values: number[]): Uint8Array => {
    const out = new Uint8Array(values.length * 4)
    values.forEach((v, i) => new DataView(out.buffer).setFloat32(i * 4, v, true))
    return out
}
