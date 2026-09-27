import { ASTC_SIZES, ImageInfo, ParseOptions, levelLength, plausible, type AstcSize } from './header-info'
import { u32 } from './bytes'

// The .astc file: ARM's container for one ASTC image, which astcenc and
// most ASTC tools write. A 16-byte header — magic, block size, image size —
// and the blocks, row by row. It has no mip levels and does not say whether
// it is sRGB or HDR, so it is read as LDR.
export const ASTC_HEADER_BYTES: number = 16
const MAGIC: number = 0x5ca1ab13

const u24 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)

export function parseASTCHeader(
    bytes: Uint8Array,
    fileSize: number = bytes.length,
    options?: ParseOptions,
): ImageInfo | undefined {
    if (bytes.length < ASTC_HEADER_BYTES || u32(bytes, 0) !== MAGIC) return undefined
    const [bw, bh, bd] = [bytes[4], bytes[5], bytes[6]]
    const width = u24(bytes, 7)
    const height = u24(bytes, 10)
    const depth = u24(bytes, 13)
    // Only 2D: one block deep, one slice.
    if (bd !== 1 || depth !== 1) return undefined
    const size = `${bw}x${bh}` as AstcSize
    if (!ASTC_SIZES.includes(size)) return undefined
    if (!plausible(width, height, 1, 1, 1, 1, options)) return undefined
    const format = `ASTC_${size}` as const
    const { rowPitch, length } = levelLength(format, width, height, 1)
    if (ASTC_HEADER_BYTES + length > fileSize) return undefined
    return {
        container: 'astc',
        shape: { width, height },
        layers: [{ offset: ASTC_HEADER_BYTES, length, shape: { width, height }, level: 0, face: 0, arrayIndex: 0, depth: 1, rowPitch }],
        format,
        srgb: false,
        channels: 'RGBA',
        levels: 1,
        faces: 1,
        arraySize: 1,
        depth: 1,
        supercompression: 'none',
    }
}
