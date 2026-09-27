// Types for the part of the vendored pngjs the tests use.
export interface Decoded {
    width: number
    height: number
    data: Buffer // RGBA, four bytes a pixel
}

export interface EncodeOptions {
    width: number
    height: number
    data: Buffer | Uint8Array
}

export declare const PNG: {
    sync: {
        read(buffer: Buffer): Decoded
        write(png: EncodeOptions): Buffer
    }
}
