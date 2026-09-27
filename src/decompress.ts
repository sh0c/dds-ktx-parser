// Undoing a KTX 2 level's supercompression, with the code for it in this
// package rather than a dependency: fzstd for Zstandard and tiny-inflate for
// zlib, both vendored under src/vendor with their licences.
import { decompress as zstdDecompress } from './vendor/fzstd'
import tinf_uncompress from './vendor/tiny-inflate'

export type Supercompression = 'zstd' | 'zlib'

// Decompress @data, which must come out exactly @size bytes long — a level
// that does not is a file that lies about itself, and is refused.
export function decompress(scheme: Supercompression, data: Uint8Array, size: number): Uint8Array {
    const out = scheme === 'zstd' ? zstdDecompress(data, new Uint8Array(size)) : inflateZlib(data, size)
    if (out.length !== size)
        throw new Error(`the level decompressed to ${out.length} bytes, and its header says ${size}`)
    return out
}

// zlib: a two-byte header, raw DEFLATE, and the Adler-32 of what it inflates
// to, which is checked.
function inflateZlib(data: Uint8Array, size: number): Uint8Array {
    const cmf = data[0]
    const flg = data[1]
    if (data.length < 6 || (cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0)
        throw new Error('the level is not zlib data')
    if ((flg & 0x20) !== 0) throw new Error('the level asks for a zlib dictionary, which KTX never has')
    const out = tinf_uncompress(data.subarray(2, data.length - 4), new Uint8Array(size))
    const end = data.length - 4
    const expected = ((data[end] << 24) | (data[end + 1] << 16) | (data[end + 2] << 8) | data[end + 3]) >>> 0
    if (adler32(out) !== expected) throw new Error("the level's zlib checksum does not match what it inflated to")
    return out
}

function adler32(bytes: Uint8Array): number {
    let a = 1
    let b = 0
    for (let i = 0; i < bytes.length; ) {
        // 5552 is the most bytes that cannot overflow before the modulo.
        const end = Math.min(i + 5552, bytes.length)
        for (; i < end; i++) {
            a += bytes[i]
            b += a
        }
        a %= 65521
        b %= 65521
    }
    return ((b << 16) | a) >>> 0
}
