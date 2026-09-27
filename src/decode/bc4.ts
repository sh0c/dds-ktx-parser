import { FormatSize, formatSizes } from '../header-info'
import { getOneBySeven } from './devision-tables'

// One block's pixels, reused: decodeImage copies them out before the next block.
const out = new Uint8Array(64)

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

export function decodeBC4Block(inputBuffer: Uint8Array, size: FormatSize): Uint8Array {
    const lum0: number = inputBuffer[0]
    const lum1: number = inputBuffer[1]
    const lumBits = new Uint32Array([inputBuffer[2] | (inputBuffer[3] << 8) | (inputBuffer[4] << 16) | (inputBuffer[5] << 24), 
                                    (inputBuffer[5] & 0x03) | (inputBuffer[6] << 2) | (inputBuffer[7] << 10)])

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = out.fill(0)
    for (var i = 0; i < blockSizeInPixels; i++) {
        const index: number = i < 10 ? 0 : 1; 
		const code = (lumBits[index] >> ((i % 10) * 3)) & 0x07;
		const lum = getOneBySeven(code, lum0, lum1)

        outputBuffer[i * rgbaPixelSize]  = lum
        outputBuffer[i * rgbaPixelSize + 1] = 0x00
        outputBuffer[i * rgbaPixelSize + 2] = 0x00
        outputBuffer[i * rgbaPixelSize + 3] = 0xFF
    }

    return outputBuffer
}

// One signed byte as BC4_SNORM means it: -128 is read as -127, so that the
// range is symmetric about zero.
export function snormByte(byte: number): number {
    const v = byte > 127 ? byte - 256 : byte
    return v < -127 ? -127 : v
}

// The eight values a signed BC4 channel interpolates between, as floats in
// [-1, 1]. As the unsigned form, but compared and blended as signed, and
// its six-value mode ends in -1 and 1 rather than 0 and 255.
export function signedValue(code: number, e0: number, e1: number): number {
    let v: number
    if (e0 > e1) {
        v = code === 0 ? e0 : code === 1 ? e1 : ((8 - code) * e0 + (code - 1) * e1) / 7
    } else {
        v = code === 0 ? e0 : code === 1 ? e1 : code === 6 ? -127 : code === 7 ? 127 : ((6 - code) * e0 + (code - 1) * e1) / 5
    }
    return v / 127
}

const signedOut = new Float32Array(64)

// BC4_SNORM: one signed channel, red, as floats in [-1, 1].
export function decodeBC4SnormBlock(inputBuffer: Uint8Array, size: FormatSize): Float32Array {
    const e0: number = snormByte(inputBuffer[0])
    const e1: number = snormByte(inputBuffer[1])
    const bits = [inputBuffer[2] | (inputBuffer[3] << 8) | (inputBuffer[4] << 16) | (inputBuffer[5] << 24),
                  (inputBuffer[5] & 0x03) | (inputBuffer[6] << 2) | (inputBuffer[7] << 10)]
    const pixels: number = size.blockWidth * size.blockHeight
    for (let i = 0; i < pixels; i++) {
        const code = ((bits[i < 10 ? 0 : 1] >>> ((i % 10) * 3)) & 0x07)
        signedOut[i * 4] = signedValue(code, e0, e1)
        signedOut[i * 4 + 1] = 0
        signedOut[i * 4 + 2] = 0
        signedOut[i * 4 + 3] = 1
    }
    return signedOut
}
