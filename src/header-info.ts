
// Image formats names are using Microsoft ones from
// https://learn.microsoft.com/en-us/windows/win32/direct3d11/texture-block-compression-in-direct3d-11
// DXT1 = BC1
// DXT3 = BC2
// DXT5 = BC3
// ATI1 = BC4
// ATI2 = BC5
export type ImageFormat = 'BC1' | 'BC2' | 'BC3' | 'BC4' | 'BC5' | 'BC6H' | 'BC7' | 'BC7F'

export interface ImageShape {
    readonly width: number
    readonly height: number
}

// each layer (mipmap) from image with its shape and position in buffer
export interface LayerInfo {
    // offset in bytes in file
    readonly offset: number
    // length in bytes
    readonly length: number
    // shape of image
    readonly shape: ImageShape
}

export interface ImageInfo {
    readonly shape: ImageShape
    readonly layers: Array<LayerInfo>;
    readonly format: ImageFormat
}

export interface FormatSize {
    readonly blockWidth: number
    readonly blockHeight: number
    readonly blockSize: number
}

// compession formats with their block dimensions (in pixels) and block size (in bytes)
export const formatSizes: Record<string, FormatSize> = {
    'BC1': {blockWidth: 4,  blockHeight: 4, blockSize: 8},
    'BC2': {blockWidth: 4, blockHeight: 4, blockSize: 16},
    'BC3': {blockWidth: 4,  blockHeight: 4, blockSize: 16},
    'BC4': {blockWidth: 4,  blockHeight: 4, blockSize: 8},
    'BC5': {blockWidth: 4,  blockHeight: 4, blockSize: 16},
    'BC6H': {blockWidth: 4,  blockHeight: 4, blockSize: 16},
    'BC7': {blockWidth: 4,  blockHeight: 4, blockSize: 16},
    'BC7F': {blockWidth: 4,  blockHeight: 4, blockSize: 16},
}