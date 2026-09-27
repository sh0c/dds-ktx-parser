import {
    ImageFormat,
    ImageInfo,
    LayerInfo,
    ParseOptions,
    channelsOf,
    levelLength,
    plausible,
} from './header-info'
import { fourCCToInt32, CUBEMAP_FLAGS, DDPF, DXGI_FORMAT } from './dds-types'
import { u32 } from './bytes'

const magic = fourCCToInt32('DDS ')

// Byte offsets from the start of the file, magic included, of the fields in
// https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header
const headerSize: number = 124
const at = {
    magic: 0,
    size: 4,
    height: 12,
    width: 16,
    depth: 24,
    mipmapCount: 28,
    formatFlags: 80,
    fourCC: 84,
    bitCount: 88,
    redMask: 92,
    greenMask: 96,
    blueMask: 100,
    alphaMask: 104,
    // dwCaps2, where the cube map and volume flags are. The field before it,
    // dwCaps, was read for them once, and never has them.
    caps2: 112,
}

// The DX10 header after it:
// https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header-dxt10
const dx10At = {
    format: 128,
    dimension: 132,
    miscFlag: 136,
    arraySize: 140,
}
const dx10HeaderSize: number = 20
const DDS_RESOURCE_MISC_TEXTURECUBE: number = 0x4
const DDS_DIMENSION_TEXTURE3D: number = 4

// The bytes the header takes, which is all a parse needs from the file.
export const DDS_HEADER_BYTES: number = 4 + headerSize + dx10HeaderSize

type Format = [ImageFormat, boolean] // the format, and whether it is sRGB

function fromDXGI(code: number): Format | undefined {
    switch (code) {
        case DXGI_FORMAT.BC1_TYPELESS:
        case DXGI_FORMAT.BC1_UNORM:
            return ['BC1', false]
        case DXGI_FORMAT.BC1_UNORM_SRGB:
            return ['BC1', true]
        case DXGI_FORMAT.BC2_TYPELESS:
        case DXGI_FORMAT.BC2_UNORM:
            return ['BC2', false]
        case DXGI_FORMAT.BC2_UNORM_SRGB:
            return ['BC2', true]
        case DXGI_FORMAT.BC3_TYPELESS:
        case DXGI_FORMAT.BC3_UNORM:
            return ['BC3', false]
        case DXGI_FORMAT.BC3_UNORM_SRGB:
            return ['BC3', true]
        case DXGI_FORMAT.BC4_TYPELESS:
        case DXGI_FORMAT.BC4_UNORM:
            return ['BC4', false]
        case DXGI_FORMAT.BC4_SNORM:
            return ['BC4_SNORM', false]
        case DXGI_FORMAT.BC5_TYPELESS:
        case DXGI_FORMAT.BC5_UNORM:
            return ['BC5', false]
        case DXGI_FORMAT.BC5_SNORM:
            return ['BC5_SNORM', false]
        case DXGI_FORMAT.BC6H_TYPELESS:
        case DXGI_FORMAT.BC6H_UF16:
            return ['BC6H', false]
        case DXGI_FORMAT.BC6H_SF16:
            return ['BC6H_SF16', false]
        case DXGI_FORMAT.BC7_TYPELESS:
        case DXGI_FORMAT.BC7_UNORM:
            return ['BC7', false]
        case DXGI_FORMAT.BC7_UNORM_SRGB:
            return ['BC7', true]
        case DXGI_FORMAT.R8G8B8A8_TYPELESS:
        case DXGI_FORMAT.R8G8B8A8_UNORM:
            return ['RGBA8', false]
        case DXGI_FORMAT.R8G8B8A8_UNORM_SRGB:
            return ['RGBA8', true]
        case DXGI_FORMAT.B8G8R8A8_TYPELESS:
        case DXGI_FORMAT.B8G8R8A8_UNORM:
            return ['BGRA8', false]
        case DXGI_FORMAT.B8G8R8A8_UNORM_SRGB:
            return ['BGRA8', true]
        case DXGI_FORMAT.B8G8R8X8_TYPELESS:
        case DXGI_FORMAT.B8G8R8X8_UNORM:
            return ['BGRX8', false]
        case DXGI_FORMAT.B8G8R8X8_UNORM_SRGB:
            return ['BGRX8', true]
        case DXGI_FORMAT.R8_UNORM:
            return ['R8', false]
        case DXGI_FORMAT.R8G8_UNORM:
            return ['RG8', false]
        case DXGI_FORMAT.R8_SNORM:
            return ['R8_SNORM', false]
        case DXGI_FORMAT.R8G8_SNORM:
            return ['RG8_SNORM', false]
        case DXGI_FORMAT.R16_UNORM:
            return ['R16', false]
        case DXGI_FORMAT.R16G16_UNORM:
            return ['RG16', false]
        case DXGI_FORMAT.R16_SNORM:
            return ['R16_SNORM', false]
        case DXGI_FORMAT.R16G16_SNORM:
            return ['RG16_SNORM', false]
        case DXGI_FORMAT.A8_UNORM:
            return ['A8', false]
        case DXGI_FORMAT.R10G10B10A2_UNORM:
            return ['RGB10A2', false]
        case DXGI_FORMAT.B5G6R5_UNORM:
            return ['B5G6R5', false]
        case DXGI_FORMAT.B5G5R5A1_UNORM:
            return ['B5G5R5A1', false]
        case DXGI_FORMAT.B4G4R4A4_UNORM:
            return ['B4G4R4A4', false]
        case DXGI_FORMAT.R16_FLOAT:
            return ['R16F', false]
        case DXGI_FORMAT.R16G16_FLOAT:
            return ['RG16F', false]
        case DXGI_FORMAT.R16G16B16A16_FLOAT:
            return ['RGBA16F', false]
        case DXGI_FORMAT.R32_FLOAT:
            return ['R32F', false]
        case DXGI_FORMAT.R32G32_FLOAT:
            return ['RG32F', false]
        case DXGI_FORMAT.R32G32B32A32_FLOAT:
            return ['RGBA32F', false]
        case DXGI_FORMAT.R32G32B32_FLOAT:
            return ['RGB32F', false]
        case DXGI_FORMAT.R11G11B10_FLOAT:
            return ['RG11B10F', false]
        case DXGI_FORMAT.R9G9B9E5_SHAREDEXP:
            return ['RGB9E5', false]
    }
    return undefined
}

// The formats that come as a FourCC, the four letters or a D3DFMT number.
function fromFourCC(code: number): Format | undefined {
    switch (code) {
        case fourCCToInt32('DXT1'):
            return ['BC1', false]
        case fourCCToInt32('DXT2'): // premultiplied alpha; the blocks are BC2's
        case fourCCToInt32('DXT3'):
            return ['BC2', false]
        case fourCCToInt32('DXT4'): // premultiplied alpha; the blocks are BC3's
        case fourCCToInt32('DXT5'):
            return ['BC3', false]
        case fourCCToInt32('ATI1'):
        case fourCCToInt32('BC4U'):
            return ['BC4', false]
        case fourCCToInt32('BC4S'):
            return ['BC4_SNORM', false]
        case fourCCToInt32('ATI2'):
        case fourCCToInt32('BC5U'):
            return ['BC5', false]
        case fourCCToInt32('BC5S'):
            return ['BC5_SNORM', false]
        // D3DFMT numbers written where a FourCC goes
        case 60: // V8U8: two signed bytes
            return ['RG8_SNORM', false]
        case 111:
            return ['R16F', false]
        case 112:
            return ['RG16F', false]
        case 113:
            return ['RGBA16F', false]
        case 114:
            return ['R32F', false]
        case 115:
            return ['RG32F', false]
        case 116:
            return ['RGBA32F', false]
    }
    return undefined
}

// An uncompressed format described by its bit count and channel masks, as
// DDS files written before the DX10 header describe them.
function fromMasks(flags: number, bits: number, r: number, g: number, b: number, a: number): Format | undefined {
    const hasAlpha = (flags & DDPF.DDPF_ALPHAPIXELS) !== 0
    if ((flags & DDPF.DDPF_RGB) !== 0) {
        if (bits === 32) {
            if (r === 0x00ff0000 && g === 0x0000ff00 && b === 0x000000ff)
                return [hasAlpha && a === 0xff000000 ? 'BGRA8' : 'BGRX8', false]
            if (r === 0x000000ff && g === 0x0000ff00 && b === 0x00ff0000)
                return [hasAlpha && a === 0xff000000 ? 'RGBA8' : 'RGBX8', false]
            if (r === 0x000003ff && g === 0x000ffc00 && b === 0x3ff00000) return ['RGB10A2', false]
            // G16R16: red in the low half
            if (r === 0x0000ffff && g === 0xffff0000 && b === 0 && !hasAlpha) return ['RG16', false]
        }
        if (bits === 24) {
            if (r === 0xff0000 && g === 0x00ff00 && b === 0x0000ff) return ['BGR8', false]
            if (r === 0x0000ff && g === 0x00ff00 && b === 0xff0000) return ['RGB8', false]
        }
        if (bits === 16) {
            if (r === 0xf800 && g === 0x07e0 && b === 0x001f) return ['B5G6R5', false]
            if (r === 0x7c00 && g === 0x03e0 && b === 0x001f && hasAlpha && a === 0x8000)
                return ['B5G5R5A1', false]
            if (r === 0x0f00 && g === 0x00f0 && b === 0x000f && hasAlpha && a === 0xf000)
                return ['B4G4R4A4', false]
            // Two channels of eight bits, as some writers describe R8G8
            if (r === 0x00ff && g === 0xff00 && b === 0 && !hasAlpha) return ['RG8', false]
        }
        if (bits === 8 && r === 0xff && g === 0 && b === 0 && !hasAlpha) return ['R8', false]
        return undefined
    }
    if ((flags & DDPF.DDPF_LUMINANCE) !== 0 && bits === 8 && r === 0xff && !hasAlpha) return ['L8', false]
    if ((flags & DDPF.DDPF_LUMINANCE) !== 0 && bits === 16 && r === 0xffff && !hasAlpha) return ['L16', false]
    if ((flags & DDPF.DDPF_ALPHA) !== 0 && bits === 8 && a === 0xff) return ['A8', false]
    return undefined
}

const faceFlags = [
    CUBEMAP_FLAGS.CUBEMAP_POSITIVEX,
    CUBEMAP_FLAGS.CUBEMAP_NEGATIVEX,
    CUBEMAP_FLAGS.CUBEMAP_POSITIVEY,
    CUBEMAP_FLAGS.CUBEMAP_NEGATIVEY,
    CUBEMAP_FLAGS.CUBEMAP_POSITIVEZ,
    CUBEMAP_FLAGS.CUBEMAP_NEGATIVEZ,
]

// Parse a DDS header and say where every image in the file is. @bytes needs
// only the header — DDS_HEADER_BYTES, or the whole file if it is shorter —
// and @fileSize is how long the file is, so that an image said to be past
// its end is refused. Given the whole file, @fileSize is its length.
//
// Answers undefined for anything it cannot read, and for any header whose
// numbers cannot be right: a size past the limit, levels past 1×1, images
// past the end of the file.
export function parseDDSHeader(
    bytes: Uint8Array,
    fileSize: number = bytes.length,
    options?: ParseOptions,
): ImageInfo | undefined {
    if (bytes.length < 4 + headerSize) return undefined
    if (u32(bytes, at.magic) !== magic >>> 0) return undefined
    if (u32(bytes, at.size) !== headerSize) return undefined

    const width = u32(bytes, at.width)
    const height = u32(bytes, at.height)
    const caps2 = u32(bytes, at.caps2)
    const flags = u32(bytes, at.formatFlags)
    // A count of 0 is what a file without mip levels says: one image.
    const levels = Math.max(1, u32(bytes, at.mipmapCount))
    let depth = (caps2 & CUBEMAP_FLAGS.VOLUME) !== 0 ? Math.max(1, u32(bytes, at.depth)) : 1

    let format: Format | undefined
    let dataOffset = 4 + headerSize
    let faces = 1
    let arraySize = 1

    if ((flags & DDPF.DDPF_FOURCC) !== 0) {
        const fourCC = u32(bytes, at.fourCC)
        if (fourCC === fourCCToInt32('DX10') >>> 0) {
            if (bytes.length < 4 + headerSize + dx10HeaderSize) return undefined
            format = fromDXGI(u32(bytes, dx10At.format))
            arraySize = Math.max(1, u32(bytes, dx10At.arraySize))
            if ((u32(bytes, dx10At.miscFlag) & DDS_RESOURCE_MISC_TEXTURECUBE) !== 0) faces = 6
            if (u32(bytes, dx10At.dimension) !== DDS_DIMENSION_TEXTURE3D) depth = 1
            else depth = Math.max(1, u32(bytes, at.depth))
            dataOffset += dx10HeaderSize
        } else {
            format = fromFourCC(fourCC)
        }
    } else {
        format = fromMasks(
            flags,
            u32(bytes, at.bitCount),
            u32(bytes, at.redMask),
            u32(bytes, at.greenMask),
            u32(bytes, at.blueMask),
            u32(bytes, at.alphaMask),
        )
    }
    if (!format) return undefined

    // A cube map written before DX10 says which faces it has; they are
    // stored in the order +X, -X, +Y, -Y, +Z, -Z, skipping any it lacks.
    let faceIds = [0]
    if (faces === 6) faceIds = [0, 1, 2, 3, 4, 5]
    else if ((caps2 & CUBEMAP_FLAGS.CUBEMAP) !== 0) {
        faceIds = faceFlags.map((flag, i) => ((caps2 & flag) !== 0 ? i : -1)).filter((i) => i >= 0)
        if (faceIds.length === 0) return undefined
        faces = faceIds.length
    }

    if (!plausible(width, height, depth, levels, faces, arraySize, options)) return undefined

    const [imageFormat, srgb] = format
    const layers = new Array<LayerInfo>()
    // Every level of the first face, then every level of the next: the order
    // DDS keeps them in, element by element of an array.
    for (let arrayIndex = 0; arrayIndex < arraySize; arrayIndex++) {
        for (const face of faceIds) {
            let w = width
            let h = height
            let d = depth
            for (let level = 0; level < levels; level++) {
                const { rowPitch, length } = levelLength(imageFormat, w, h, d)
                if (dataOffset + length > fileSize) return undefined
                layers.push({
                    offset: dataOffset,
                    length,
                    shape: { width: w, height: h },
                    level,
                    face,
                    arrayIndex,
                    depth: d,
                    rowPitch,
                })
                dataOffset += length
                w = Math.max(1, w >> 1)
                h = Math.max(1, h >> 1)
                d = Math.max(1, d >> 1)
            }
        }
    }

    return {
        container: 'dds',
        shape: { width, height },
        layers,
        format: imageFormat,
        srgb,
        channels: channelsOf(imageFormat),
        levels,
        faces,
        arraySize,
        depth,
        supercompression: 'none',
    }
}
