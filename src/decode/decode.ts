import {
    FormatSize,
    ImageFormat,
    LayerInfo,
    UncompressedFormat,
    astcOf,
    formatSizes,
    isCompressed,
    isSigned,
    levelLength,
} from '../header-info'
import { decodeASTCBytes, decodeASTCFloat } from './astc'
import { decodeUASTCBlock } from './uastc'

// UASTC decoded as Basis's own transcoder decodes it to RGBA: without
// sRGB's widening whatever the file's transfer function — which moves some
// values by one — and, for a file without alpha, with alpha 255.
const opaqueUASTC = (block: Uint8Array): Uint8Array => {
    const out = decodeUASTCBlock(block, false)
    for (let i = 3; i < 64; i += 4) out[i] = 255
    return out
}
import { unorm8 } from '../bytes'

import { decodeBC1Block } from './bc1'
import { decodeBC2Block } from './bc2'
import { decodeBC3Block } from './bc3'
import { decodeBC4Block, decodeBC4SnormBlock } from './bc4'
import { decodeBC5Block, decodeBC5SnormBlock } from './bc5'
import { decodeBC6HBlock } from './bc6h'
import { decodeBC7Block } from './bc7'
import {
    decodeEACR11Block,
    decodeEACRG11Block,
    decodeETC2A1Block,
    decodeETC2Block,
    decodeETC2RGBABlock,
} from './etc'
import { decodeRowFloat } from './uncompressed'

type BytesBlock = (block: Uint8Array, size: FormatSize) => Uint8Array
type FloatBlock = (block: Uint8Array, size: FormatSize) => Float32Array

// The block formats that decode to bytes, and those that decode to floats:
// HDR, and the signed ones, whose values run below zero.
// ASTC's decoders, looked up by format: LDR and sRGB to bytes, HDR to floats.
function astcBlocks(format: ImageFormat): { bytes?: BytesBlock; floats?: FloatBlock } {
    const astc = astcOf(format)
    if (!astc) return {}
    const { width, height, profile } = astc
    if (profile === 'hdr') return { floats: (block) => decodeASTCFloat(block, width, height, profile) }
    return { bytes: (block) => decodeASTCBytes(block, width, height, profile) }
}

const bytesBlocks: Partial<Record<ImageFormat, BytesBlock>> = {
    BC1: decodeBC1Block,
    BC2: decodeBC2Block,
    BC3: decodeBC3Block,
    BC4: decodeBC4Block,
    BC5: decodeBC5Block,
    BC7: decodeBC7Block,
    ETC1: decodeETC2Block,
    ETC2_RGB: decodeETC2Block,
    ETC2_RGB_A1: decodeETC2A1Block,
    ETC2_RGBA: decodeETC2RGBABlock,
    UASTC_RGBA: (block) => decodeUASTCBlock(block, false),
    UASTC_RGB: opaqueUASTC,
}
const floatBlocks: Partial<Record<ImageFormat, FloatBlock>> = {
    BC4_SNORM: decodeBC4SnormBlock,
    BC5_SNORM: decodeBC5SnormBlock,
    BC6H: (block, size) => decodeBC6HBlock(block, size, false),
    BC6H_SF16: (block, size) => decodeBC6HBlock(block, size, true),
    EAC_R11: (block) => decodeEACR11Block(block, false),
    EAC_R11_SNORM: (block) => decodeEACR11Block(block, true),
    EAC_RG11: (block) => decodeEACRG11Block(block, false),
    EAC_RG11_SNORM: (block) => decodeEACRG11Block(block, true),
}

// Signed formats are shown in 8 bits with -1 as 0 and 1 as 255, the way a
// normal map is usually looked at; everything else is clamped to [0, 1].

// Where @slice of @layer starts in @bytes, having checked that @bytes holds
// all of it — a shorter buffer is a mistake to say, not to read past.
function start(bytes: Uint8Array, format: ImageFormat, layer: LayerInfo, slice: number): number {
    if (!formatSizes[format]) throw new Error(`${format} is not a format this can decode`)
    const { width, height } = layer.shape
    const sliceLength = levelLength(format, width, height, 1).length
    const rows = Math.ceil(height / formatSizes[format].blockHeight)
    const length = Math.max(sliceLength, layer.rowPitch * rows)
    if (!Number.isInteger(slice) || slice < 0 || slice >= layer.depth)
        throw new RangeError(`this level has ${layer.depth} slice(s); there is no slice ${slice}`)
    const from = layer.offset + slice * layer.rowPitch * rows
    if (from + length > bytes.length)
        throw new RangeError(
            `decoding needs bytes ${from} to ${from + length} of the file, and ${bytes.length} were given`,
        )
    return from
}

// Walk the blocks of one image, handing each decoded block to @put with
// where its top-left pixel goes and how much of it is inside the image.
function eachBlock<T>(
    bytes: Uint8Array,
    from: number,
    format: ImageFormat,
    layer: LayerInfo,
    decode: (block: Uint8Array, size: FormatSize) => T,
    put: (block: T, x: number, y: number, columns: number, rows: number) => void,
): void {
    const size = formatSizes[format]
    const { width, height } = layer.shape
    const wide = Math.ceil(width / size.blockWidth)
    const high = Math.ceil(height / size.blockHeight)
    for (let by = 0; by < high; by++) {
        const y = by * size.blockHeight
        const rows = Math.min(size.blockHeight, height - y)
        let at = from + by * layer.rowPitch
        for (let bx = 0; bx < wide; bx++) {
            const x = bx * size.blockWidth
            put(decode(bytes.subarray(at, at + size.blockSize), size), x, y, Math.min(size.blockWidth, width - x), rows)
            at += size.blockSize
        }
    }
}

function uncompressedFloat(bytes: Uint8Array, from: number, format: ImageFormat, layer: LayerInfo): Float32Array {
    const { width, height } = layer.shape
    const result = new Float32Array(width * height * 4)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let y = 0; y < height; y++)
        decodeRowFloat(bytes, view, from + y * layer.rowPitch, format as UncompressedFormat, width, result, y * width * 4)
    return result
}

// Decode one image of the file to RGBA, a byte a channel, rows top to bottom.
// @bytes is the whole file, or any part of it that holds this image, with
// @layer's offset counted from its start. @slice picks the depth slice of a
// volume texture.
//
// HDR values past 1.0 are clamped to 255 — decodeImageFloat has them as
// they are. Signed formats show -1 as 0 and 1 as 255.
export function decodeImage(bytes: Uint8Array, imageFormat: ImageFormat, layer: LayerInfo, slice: number = 0): Uint8Array {
    const from = start(bytes, imageFormat, layer, slice)
    const { width, height } = layer.shape
    const result = new Uint8Array(width * height * 4)

    const asBytes = bytesBlocks[imageFormat] ?? astcBlocks(imageFormat).bytes
    if (asBytes) {
        eachBlock(bytes, from, imageFormat, layer, asBytes, (block, x, y, columns, rows) => {
            const blockWidth = formatSizes[imageFormat].blockWidth
            for (let i = 0; i < rows; i++) {
                const source = i * blockWidth * 4
                result.set(block.subarray(source, source + columns * 4), ((y + i) * width + x) * 4)
            }
        })
        return result
    }

    const toByte = isSigned(imageFormat) ? (v: number) => unorm8((v + 1) / 2) : unorm8
    const asFloats = floatBlocks[imageFormat] ?? astcBlocks(imageFormat).floats
    if (asFloats) {
        eachBlock(bytes, from, imageFormat, layer, asFloats, (block, x, y, columns, rows) => {
            const blockWidth = formatSizes[imageFormat].blockWidth
            for (let i = 0; i < rows; i++) {
                for (let j = 0; j < columns; j++) {
                    const s = (i * blockWidth + j) * 4
                    const t = ((y + i) * width + x + j) * 4
                    result[t] = toByte(block[s])
                    result[t + 1] = toByte(block[s + 1])
                    result[t + 2] = toByte(block[s + 2])
                    result[t + 3] = unorm8(block[s + 3])
                }
            }
        })
        return result
    }

    // Only red and green are ever signed; blue, left 0, and alpha, 1, are not.
    const floats = uncompressedFloat(bytes, from, imageFormat, layer)
    for (let i = 0; i < floats.length; i++) result[i] = (i & 3) < 2 ? toByte(floats[i]) : unorm8(floats[i])
    return result
}

// Decode one image of the file to RGBA floats, rows top to bottom: HDR
// values as they are, signed ones in [-1, 1], and 8-bit ones divided by 255.
export function decodeImageFloat(bytes: Uint8Array, imageFormat: ImageFormat, layer: LayerInfo, slice: number = 0): Float32Array {
    const from = start(bytes, imageFormat, layer, slice)
    const { width } = layer.shape

    const asFloats = floatBlocks[imageFormat] ?? astcBlocks(imageFormat).floats
    const asBytes = bytesBlocks[imageFormat] ?? astcBlocks(imageFormat).bytes
    if (asFloats || asBytes) {
        const result = new Float32Array(width * layer.shape.height * 4)
        const blockWidth = formatSizes[imageFormat].blockWidth
        const put = (block: Uint8Array | Float32Array, x: number, y: number, columns: number, rows: number) => {
            const scale = block instanceof Float32Array ? 1 : 1 / 255
            for (let i = 0; i < rows; i++)
                for (let j = 0; j < columns * 4; j++)
                    result[((y + i) * width + x) * 4 + j] = block[i * blockWidth * 4 + j] * scale
        }
        if (asFloats) eachBlock(bytes, from, imageFormat, layer, asFloats, put)
        else eachBlock(bytes, from, imageFormat, layer, asBytes!, put)
        return result
    }
    if (isCompressed(imageFormat)) throw new Error(`${imageFormat} is not a format this can decode`)
    return uncompressedFloat(bytes, from, imageFormat, layer)
}
