import { align } from './bytes'

// Image formats names are using Microsoft ones from
// https://learn.microsoft.com/en-us/windows/win32/direct3d11/texture-block-compression-in-direct3d-11
// DXT1 = BC1
// DXT3 = BC2
// DXT5 = BC3
// ATI1 = BC4
// ATI2 = BC5
export type CompressedFormat =
    | 'BC1'
    | 'BC2'
    | 'BC3'
    | 'BC4'
    | 'BC4_SNORM'
    | 'BC5'
    | 'BC5_SNORM'
    | 'BC6H' // unsigned half floats (UF16)
    | 'BC6H_SF16'
    | 'BC7'

// Channels named in the order their bytes are in the file.
export type UncompressedFormat =
    | 'RGBA8'
    | 'RGBX8' // RGBA8 whose alpha byte means nothing
    | 'BGRA8'
    | 'BGRX8'
    | 'RGB8'
    | 'BGR8'
    | 'R8'
    | 'RG8'
    | 'R8_SNORM'
    | 'RG8_SNORM'
    | 'R16'
    | 'RG16'
    | 'R16_SNORM'
    | 'RG16_SNORM'
    | 'L8' // luminance: one byte, shown as grey
    | 'L16'
    | 'A8'
    | 'RGB10A2'
    | 'B5G6R5'
    | 'B5G5R5A1'
    | 'B4G4R4A4'
    | 'R16F'
    | 'RG16F'
    | 'RGB16F'
    | 'RGBA16F'
    | 'R32F'
    | 'RG32F'
    | 'RGB32F'
    | 'RGBA32F'
    | 'RG11B10F' // packed floats: red 11 bits, green 11, blue 10, no sign
    | 'RGB9E5' // three 9-bit mantissas sharing one 5-bit exponent

export type ImageFormat = CompressedFormat | UncompressedFormat

export interface ImageShape {
    readonly width: number
    readonly height: number
}

// One image in the file: a mip level of one face of one array element.
export interface LayerInfo {
    // offset in bytes in file
    readonly offset: number
    // length in bytes, every depth slice included
    readonly length: number
    // shape of image
    readonly shape: ImageShape
    // the mip level: 0 is the full size
    readonly level: number
    // the cube face, 0 to 5 (+X, -X, +Y, -Y, +Z, -Z); 0 when not a cube map
    readonly face: number
    // which element of a texture array; 0 when not an array
    readonly arrayIndex: number
    // depth slices at this level: 1 unless a volume texture
    readonly depth: number
    // bytes from the start of one row of pixels, or of blocks, to the next
    readonly rowPitch: number
    // Only in a supercompressed KTX 2: the stored level this image is in,
    // to read and decompress, and `offset` is then counted within the
    // decompressed level. readLayer does both.
    readonly source?: {
        readonly offset: number
        readonly length: number
        readonly scheme: 'zstd' | 'zlib'
        readonly uncompressedLength: number
    }
}

export interface ImageInfo {
    readonly container: 'dds' | 'ktx' | 'ktx2'
    readonly shape: ImageShape
    // every image in the file, in the order the file holds them
    readonly layers: Array<LayerInfo>
    readonly format: ImageFormat
    // whether the colour values are sRGB-encoded rather than linear
    readonly srgb: boolean
    // which channels the format has: a viewer can show an 'R' texture as
    // one channel, in grey, rather than as red on black
    readonly channels: Channels
    readonly levels: number
    readonly faces: number
    readonly arraySize: number
    readonly depth: number
    // how the levels are stored: only KTX 2 supercompresses
    readonly supercompression: 'none' | 'zstd' | 'zlib'
}

export interface FormatSize {
    readonly blockWidth: number
    readonly blockHeight: number
    readonly blockSize: number
}

// Block dimensions in pixels and block size in bytes; a pixel is a block of
// one for the uncompressed formats. 'RGB' and 'RGBA' are kept for code that
// read them before the formats were named.
export const formatSizes: Record<string, FormatSize> = {
    BC1: { blockWidth: 4, blockHeight: 4, blockSize: 8 },
    BC2: { blockWidth: 4, blockHeight: 4, blockSize: 16 },
    BC3: { blockWidth: 4, blockHeight: 4, blockSize: 16 },
    BC4: { blockWidth: 4, blockHeight: 4, blockSize: 8 },
    BC4_SNORM: { blockWidth: 4, blockHeight: 4, blockSize: 8 },
    BC5: { blockWidth: 4, blockHeight: 4, blockSize: 16 },
    BC5_SNORM: { blockWidth: 4, blockHeight: 4, blockSize: 16 },
    BC6H: { blockWidth: 4, blockHeight: 4, blockSize: 16 },
    BC6H_SF16: { blockWidth: 4, blockHeight: 4, blockSize: 16 },
    BC7: { blockWidth: 4, blockHeight: 4, blockSize: 16 },
    RGBA8: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    RGBX8: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    BGRA8: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    BGRX8: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    RGB8: { blockWidth: 1, blockHeight: 1, blockSize: 3 },
    BGR8: { blockWidth: 1, blockHeight: 1, blockSize: 3 },
    R8: { blockWidth: 1, blockHeight: 1, blockSize: 1 },
    RG8: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    R8_SNORM: { blockWidth: 1, blockHeight: 1, blockSize: 1 },
    RG8_SNORM: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    R16: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    RG16: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    R16_SNORM: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    RG16_SNORM: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    L8: { blockWidth: 1, blockHeight: 1, blockSize: 1 },
    L16: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    A8: { blockWidth: 1, blockHeight: 1, blockSize: 1 },
    RGB10A2: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    B5G6R5: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    B5G5R5A1: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    B4G4R4A4: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    R16F: { blockWidth: 1, blockHeight: 1, blockSize: 2 },
    RG16F: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    RGB16F: { blockWidth: 1, blockHeight: 1, blockSize: 6 },
    RGBA16F: { blockWidth: 1, blockHeight: 1, blockSize: 8 },
    R32F: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    RG32F: { blockWidth: 1, blockHeight: 1, blockSize: 8 },
    RGB32F: { blockWidth: 1, blockHeight: 1, blockSize: 12 },
    RGBA32F: { blockWidth: 1, blockHeight: 1, blockSize: 16 },
    RG11B10F: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    RGB9E5: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
    RGB: { blockWidth: 1, blockHeight: 1, blockSize: 3 },
    RGBA: { blockWidth: 1, blockHeight: 1, blockSize: 4 },
}

// The channels a format carries. L is luminance (one value shown in all
// three), A is alpha alone.
export type Channels = 'R' | 'RG' | 'RGB' | 'RGBA' | 'L' | 'A'

const channelsOfFormat: Record<ImageFormat, Channels> = {
    BC1: 'RGBA', // its one-bit alpha mode
    BC2: 'RGBA',
    BC3: 'RGBA',
    BC4: 'R',
    BC4_SNORM: 'R',
    BC5: 'RG',
    BC5_SNORM: 'RG',
    BC6H: 'RGB',
    BC6H_SF16: 'RGB',
    BC7: 'RGBA',
    RGBA8: 'RGBA',
    RGBX8: 'RGB',
    BGRA8: 'RGBA',
    BGRX8: 'RGB',
    RGB8: 'RGB',
    BGR8: 'RGB',
    R8: 'R',
    RG8: 'RG',
    R8_SNORM: 'R',
    RG8_SNORM: 'RG',
    R16: 'R',
    RG16: 'RG',
    R16_SNORM: 'R',
    RG16_SNORM: 'RG',
    L8: 'L',
    L16: 'L',
    A8: 'A',
    RGB10A2: 'RGBA',
    B5G6R5: 'RGB',
    B5G5R5A1: 'RGBA',
    B4G4R4A4: 'RGBA',
    R16F: 'R',
    RG16F: 'RG',
    RGB16F: 'RGB',
    RGBA16F: 'RGBA',
    R32F: 'R',
    RG32F: 'RG',
    RGB32F: 'RGB',
    RGBA32F: 'RGBA',
    RG11B10F: 'RGB',
    RGB9E5: 'RGB',
}

export function channelsOf(format: ImageFormat): Channels {
    return channelsOfFormat[format]
}

// Formats whose values run from -1 to 1. In 8 bits they are shown with -1
// as 0 and 1 as 255.
export function isSigned(format: ImageFormat): boolean {
    return /_SNORM$/.test(format)
}

export function isCompressed(format: ImageFormat): boolean {
    return formatSizes[format].blockWidth > 1
}

// How long one image of @format is, and how far apart its rows are. KTX pads
// every row of an uncompressed image to four bytes (@rowAlign 4); DDS does not.
export function levelLength(
    format: ImageFormat,
    width: number,
    height: number,
    depth: number,
    rowAlign: number = 1,
): { rowPitch: number; length: number } {
    const size = formatSizes[format]
    const blocksWide = Math.ceil(width / size.blockWidth)
    const blocksHigh = Math.ceil(height / size.blockHeight)
    const rowPitch = isCompressed(format)
        ? blocksWide * size.blockSize
        : align(blocksWide * size.blockSize, rowAlign)
    return { rowPitch, length: rowPitch * blocksHigh * depth }
}

export interface ParseOptions {
    // The largest width or height accepted. A header asking for more is
    // refused before anything is allocated for it. 16384 is Direct3D's own
    // limit for a 2D texture.
    readonly maxDimension?: number
}

export const MAX_DIMENSION: number = 16384
export const MAX_DEPTH: number = 2048
export const MAX_ARRAY_SIZE: number = 2048

// Whether a header's numbers describe something that could be a texture, so
// that a hostile or broken one is refused rather than acted on.
export function plausible(
    width: number,
    height: number,
    depth: number,
    levels: number,
    faces: number,
    arraySize: number,
    options?: ParseOptions,
): boolean {
    const max = options?.maxDimension ?? MAX_DIMENSION
    const whole = (n: number, low: number, high: number): boolean =>
        Number.isInteger(n) && n >= low && n <= high
    if (!whole(width, 1, max) || !whole(height, 1, max)) return false
    if (!whole(depth, 1, MAX_DEPTH) || !whole(arraySize, 1, MAX_ARRAY_SIZE)) return false
    if (faces < 1 || faces > 6 || !Number.isInteger(faces)) return false
    // A level past the one that is 1×1×1 is not a level.
    const most = Math.floor(Math.log2(Math.max(width, height, depth))) + 1
    return whole(levels, 1, most)
}

// The image for one level of one face of one array element, if the file has it.
export function findLayer(
    info: ImageInfo,
    level: number,
    face: number = 0,
    arrayIndex: number = 0,
): LayerInfo | undefined {
    return info.layers.find((l) => l.level === level && l.face === face && l.arrayIndex === arrayIndex)
}
