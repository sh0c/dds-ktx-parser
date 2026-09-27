import { FormatSize, formatSizes } from '../header-info'
import { getOneBySeven } from './devision-tables'
import { decodeBC4SnormBlock } from './bc4'

// One block's pixels, reused: decodeImage copies them out before the next block.
const out = new Uint8Array(64)

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

export function decodeBC5Block(inputBuffer: Uint8Array, size: FormatSize): Uint8Array {
    const red0: number = inputBuffer[0]
    const red1: number = inputBuffer[1]
    const redBits = new Uint32Array([inputBuffer[2] | (inputBuffer[3] << 8) | (inputBuffer[4] << 16) | (inputBuffer[5] << 24), 
                                    (inputBuffer[5] & 0x03) | (inputBuffer[6] << 2) | (inputBuffer[7] << 10)])

    const green0: number = inputBuffer[8]
    const green1: number = inputBuffer[9]
    const greenBits = new Uint32Array([inputBuffer[10] | (inputBuffer[11] << 8) | (inputBuffer[12] << 16) | (inputBuffer[13] << 24), 
                                      (inputBuffer[13] & 0x03) | (inputBuffer[14] << 2) | (inputBuffer[15] << 10)])

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = out.fill(0)
    for (var i = 0; i < blockSizeInPixels; i++) {
        const index: number = i < 10 ? 0 : 1; 
		const codeRed = (redBits[index] >> ((i % 10) * 3)) & 0x07;
		const red = getOneBySeven(codeRed, red0, red1)
        const codeGreen = (greenBits[index] >> ((i % 10) * 3)) & 0x07;
		const green = getOneBySeven(codeGreen, green0, green1)

        outputBuffer[i * rgbaPixelSize]  = red
        outputBuffer[i * rgbaPixelSize + 1] = green
        outputBuffer[i * rgbaPixelSize + 2] = 0x00
        outputBuffer[i * rgbaPixelSize + 3] = 0xFF
    }

    return outputBuffer
}
const signedOut = new Float32Array(64)

// BC5_SNORM, how normal maps are usually kept: two signed channels, red and
// green, as floats in [-1, 1]. Blue is left 0 rather than rebuilt from them.
export function decodeBC5SnormBlock(inputBuffer: Uint8Array, size: FormatSize): Float32Array {
    const red = decodeBC4SnormBlock(inputBuffer.subarray(0, 8), size)
    for (let i = 0; i < 16; i++) signedOut[i * 4] = red[i * 4]
    const green = decodeBC4SnormBlock(inputBuffer.subarray(8, 16), size)
    for (let i = 0; i < 16; i++) {
        signedOut[i * 4 + 1] = green[i * 4]
        signedOut[i * 4 + 2] = 0
        signedOut[i * 4 + 3] = 1
    }
    return signedOut
}
