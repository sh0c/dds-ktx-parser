// Reading a file's bytes without Node's Buffer, so the parser runs the same
// in Node, a browser page and a Web Worker.
//
// Every read here is little-endian and byte by byte. A Uint32Array view over
// the file would be quicker to write, but it throws unless the data starts on
// a multiple of four bytes, which a slice of a file read by range need not.

export function u16(bytes: Uint8Array, at: number): number {
    return bytes[at] | (bytes[at + 1] << 8)
}

export function u32(bytes: Uint8Array, at: number): number {
    return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
}

// The 16 bytes of a block as four little-endian words, written into @into
// so that decoding a block allocates nothing.
export function blockWords(bytes: Uint8Array, into: Uint32Array): Uint32Array {
    into[0] = u32(bytes, 0)
    into[1] = u32(bytes, 4)
    into[2] = u32(bytes, 8)
    into[3] = u32(bytes, 12)
    return into
}

const floatBits = new Uint32Array(1)
const floatValue = new Float32Array(floatBits.buffer)

// IEEE half to single precision. One shared scratch word rather than two new
// typed arrays per call, which is what made BC6H slow.
export function halfToFloat(x: number): number {
    const s: number = x >> 15
    let e: number = (x >> 10) & 0x1f
    let f: number = x & 0x3ff

    f <<= 23 - 10
    switch (e) {
        case 0:
            // A subnormal: shift the mantissa up until its leading one is the
            // implicit bit 23, and take one off the exponent a shift. The
            // code this came from stopped at bit 19 and kept 19 bits, which
            // made every subnormal wrong — 0x0001 came out 16 times too big.
            if (f !== 0) {
                e = 1 + (127 - 15)
                while ((f & 0x800000) === 0) {
                    f <<= 1
                    e -= 1
                }
                f &= 0x7fffff
            }
            break
        case 31:
            e = 255
            break
        default:
            e += 127 - 15
            break
    }

    floatBits[0] = (s << 31) | (e << 23) | f
    return floatValue[0]
}

// A value in [0, 1] as a byte, clamped: 1.5 is 255, not 1.5 * 255 wrapped
// round to 127, which is what writing it into a byte array does.
export function unorm8(x: number): number {
    const v = Math.floor(x * 255 + 0.5)
    return v < 0 ? 0 : v > 255 ? 255 : v
}

export function align(value: number, to: number): number {
    return Math.ceil(value / to) * to
}
