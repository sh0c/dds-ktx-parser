import { ASTC_SIZES, ImageFormat, ImageInfo, LayerInfo, ParseOptions, channelsOf, levelLength, plausible } from './header-info'
import { u32 } from './bytes'
import type { Supercompression } from './decompress'

// KTX 2: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html
//
// A 48-byte header, a 32-byte index of where the other parts are, and then
// for each mip level where it is and how long, compressed and not. Levels
// are addressed through that index, so one can be read on its own — even
// when it is supercompressed, since each is compressed alone.

export const KTX2_HEADER_BYTES: number = 80

const at = {
    vkFormat: 12,
    pixelWidth: 20,
    pixelHeight: 24,
    pixelDepth: 28,
    layerCount: 32,
    faceCount: 36,
    levelCount: 40,
    supercompressionScheme: 44,
    dfdByteOffset: 48,
}
const LEVEL_ENTRY_BYTES: number = 24

type Format = [ImageFormat, boolean] // the format, and whether it is sRGB

// VkFormat numbers, from the Vulkan specification.
function fromVk(vk: number): Format | undefined {
    // ASTC: VK_FORMAT_ASTC_4x4_UNORM_BLOCK (157) onwards, UNORM and SRGB in
    // turn; and the HDR ones, VK_FORMAT_ASTC_4x4_SFLOAT_BLOCK onwards.
    if (vk >= 157 && vk <= 184) {
        const size = ASTC_SIZES[(vk - 157) >> 1]
        return (vk - 157) & 1 ? [`ASTC_${size}_SRGB`, true] : [`ASTC_${size}`, false]
    }
    if (vk >= 1000066000 && vk <= 1000066013) return [`ASTC_${ASTC_SIZES[vk - 1000066000]}_HDR`, false]
    switch (vk) {
        case 131: // BC1_RGB_UNORM_BLOCK
        case 133: // BC1_RGBA_UNORM_BLOCK
            return ['BC1', false]
        case 132:
        case 134:
            return ['BC1', true]
        case 135:
            return ['BC2', false]
        case 136:
            return ['BC2', true]
        case 137:
            return ['BC3', false]
        case 138:
            return ['BC3', true]
        case 139:
            return ['BC4', false]
        case 140:
            return ['BC4_SNORM', false]
        case 141:
            return ['BC5', false]
        case 142:
            return ['BC5_SNORM', false]
        case 143: // BC6H_UFLOAT_BLOCK
            return ['BC6H', false]
        case 144: // BC6H_SFLOAT_BLOCK
            return ['BC6H_SF16', false]
        case 145:
            return ['BC7', false]
        case 146:
            return ['BC7', true]
        case 147: // ETC2_R8G8B8_UNORM_BLOCK
            return ['ETC2_RGB', false]
        case 148:
            return ['ETC2_RGB', true]
        case 149: // ETC2_R8G8B8A1_UNORM_BLOCK
            return ['ETC2_RGB_A1', false]
        case 150:
            return ['ETC2_RGB_A1', true]
        case 151: // ETC2_R8G8B8A8_UNORM_BLOCK
            return ['ETC2_RGBA', false]
        case 152:
            return ['ETC2_RGBA', true]
        case 153: // EAC_R11_UNORM_BLOCK
            return ['EAC_R11', false]
        case 154:
            return ['EAC_R11_SNORM', false]
        case 155: // EAC_R11G11_UNORM_BLOCK
            return ['EAC_RG11', false]
        case 156:
            return ['EAC_RG11_SNORM', false]
        case 4: // R5G6B5_UNORM_PACK16: red in the top bits, as B5G6R5 has it
            return ['B5G6R5', false]
        case 8: // A1R5G5B5_UNORM_PACK16: as B5G5R5A1
            return ['B5G5R5A1', false]
        case 9:
            return ['R8', false]
        case 10:
            return ['R8_SNORM', false]
        case 15:
            return ['R8', true]
        case 16:
            return ['RG8', false]
        case 17:
            return ['RG8_SNORM', false]
        case 22:
            return ['RG8', true]
        case 23:
            return ['RGB8', false]
        case 29:
            return ['RGB8', true]
        case 30:
            return ['BGR8', false]
        case 36:
            return ['BGR8', true]
        case 37:
        case 51: // A8B8G8R8_UNORM_PACK32: the same bytes
            return ['RGBA8', false]
        case 43:
        case 57:
            return ['RGBA8', true]
        case 44:
            return ['BGRA8', false]
        case 50:
            return ['BGRA8', true]
        case 64: // A2B10G10R10_UNORM_PACK32: red in the low bits
            return ['RGB10A2', false]
        case 70:
            return ['R16', false]
        case 71:
            return ['R16_SNORM', false]
        case 76:
            return ['R16F', false]
        case 77:
            return ['RG16', false]
        case 78:
            return ['RG16_SNORM', false]
        case 83:
            return ['RG16F', false]
        case 90:
            return ['RGB16F', false]
        case 97:
            return ['RGBA16F', false]
        case 100:
            return ['R32F', false]
        case 103:
            return ['RG32F', false]
        case 106:
            return ['RGB32F', false]
        case 109:
            return ['RGBA32F', false]
        case 122: // B10G11R11_UFLOAT_PACK32
            return ['RG11B10F', false]
        case 123: // E5B9G9R9_UFLOAT_PACK32
            return ['RGB9E5', false]
    }
    return undefined
}

function scheme(code: number): Supercompression | 'none' | 'basislz' | undefined {
    switch (code) {
        case 0:
            return 'none'
        case 1:
            return 'basislz'
        case 2:
            return 'zstd'
        case 3:
            return 'zlib'
    }
    return undefined
}

// A 64-bit little-endian number, if it is one JavaScript can hold exactly.
function u64(bytes: Uint8Array, at: number): number {
    const high = u32(bytes, at + 4)
    return high >= 0x200000 ? NaN : high * 0x100000000 + u32(bytes, at)
}

// How many bytes from the start of the file parseKTX2Header needs: the
// header and the level index. @head is at least the 80-byte header.
export function ktx2IndexBytes(head: Uint8Array): number {
    return KTX2_HEADER_BYTES + Math.max(1, u32(head, at.levelCount)) * LEVEL_ENTRY_BYTES
}

// What a KTX 2 file is, for saying why one is not shown: its VkFormat, its
// supercompression, and — when @head reaches that far — the colour model of
// its data format descriptor: 163 is ETC1S and 166 is UASTC, the two forms
// of Basis Universal, which need a transcoder this package does not have.
export function describeKTX2(head: Uint8Array):
    | { vkFormat: number; supercompression: string; colorModel?: number; width: number; height: number; levels: number }
    | undefined {
    if (head.length < KTX2_HEADER_BYTES) return undefined
    const dfd = u32(head, at.dfdByteOffset)
    return {
        vkFormat: u32(head, at.vkFormat),
        supercompression: scheme(u32(head, at.supercompressionScheme)) ?? `scheme ${u32(head, at.supercompressionScheme)}`,
        colorModel: dfd + 13 <= head.length && dfd > 0 ? head[dfd + 12] : undefined,
        width: u32(head, at.pixelWidth),
        height: Math.max(1, u32(head, at.pixelHeight)),
        levels: Math.max(1, u32(head, at.levelCount)),
    }
}

// Parse a KTX 2 header and its level index, and say where every image is.
// @bytes needs only the first ktx2IndexBytes of the file; @fileSize is how
// long the file is, so that a level said to be past its end is refused.
//
// A supercompressed level's images carry `source`: the stored range of the
// level to read, and how to decompress it; their `offset` is then counted
// within the decompressed level. readLayer does both.
//
// Answers undefined for what it cannot read: Basis Universal (a VkFormat of
// 0, or BasisLZ), formats it has no decoder for (ETC, ASTC and others), and
// any header whose numbers cannot be right.
export function parseKTX2Header(
    bytes: Uint8Array,
    fileSize: number = bytes.length,
    options?: ParseOptions,
): ImageInfo | undefined {
    if (bytes.length < KTX2_HEADER_BYTES) return undefined
    const described = describeKTX2(bytes)
    if (!described) return undefined
    const format = fromVk(described.vkFormat)
    const compression = scheme(u32(bytes, at.supercompressionScheme))
    if (!format || !compression || compression === 'basislz') return undefined
    const [imageFormat, srgb] = format

    const width = u32(bytes, at.pixelWidth)
    const height = Math.max(1, u32(bytes, at.pixelHeight))
    const depth = Math.max(1, u32(bytes, at.pixelDepth))
    const arraySize = Math.max(1, u32(bytes, at.layerCount))
    const faces = u32(bytes, at.faceCount)
    const levels = Math.max(1, u32(bytes, at.levelCount))
    if (faces !== 1 && faces !== 6) return undefined
    if (!plausible(width, height, depth, levels, faces, arraySize, options)) return undefined
    if (bytes.length < KTX2_HEADER_BYTES + levels * LEVEL_ENTRY_BYTES) return undefined

    const layers = new Array<LayerInfo>()
    let w = width
    let h = height
    let d = depth
    for (let level = 0; level < levels; level++) {
        const entry = KTX2_HEADER_BYTES + level * LEVEL_ENTRY_BYTES
        const byteOffset = u64(bytes, entry)
        const byteLength = u64(bytes, entry + 8)
        const uncompressed = u64(bytes, entry + 16)
        if (!(byteOffset >= 0) || !(byteLength >= 0) || byteOffset + byteLength > fileSize) return undefined

        // KTX 2 packs rows tightly, and faces and layers one after another.
        const { rowPitch, length } = levelLength(imageFormat, w, h, d)
        const whole = length * faces * arraySize
        if (compression === 'none' ? byteLength !== whole : uncompressed !== whole) return undefined

        for (let arrayIndex = 0; arrayIndex < arraySize; arrayIndex++) {
            for (let face = 0; face < faces; face++) {
                const within = (arrayIndex * faces + face) * length
                layers.push({
                    offset: compression === 'none' ? byteOffset + within : within,
                    length,
                    shape: { width: w, height: h },
                    level,
                    face,
                    arrayIndex,
                    depth: d,
                    rowPitch,
                    ...(compression === 'none'
                        ? {}
                        : { source: { offset: byteOffset, length: byteLength, scheme: compression, uncompressedLength: whole } }),
                })
            }
        }
        w = Math.max(1, w >> 1)
        h = Math.max(1, h >> 1)
        d = Math.max(1, d >> 1)
    }

    return {
        container: 'ktx2',
        shape: { width, height },
        layers,
        format: imageFormat,
        srgb,
        channels: channelsOf(imageFormat),
        levels,
        faces,
        arraySize,
        depth,
        supercompression: compression,
    }
}
