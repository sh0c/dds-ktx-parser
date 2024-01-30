import { FormatSize, formatSizes } from '../header-info'
import { getOneBySeven } from './devision-tables'

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

export function decodeBC4Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {
    const lum0: number = inputBuffer[0]
    const lum1: number = inputBuffer[1]
    const lumBits = new Uint32Array([inputBuffer[2] | (inputBuffer[3] << 8) | (inputBuffer[4] << 16) | (inputBuffer[5] << 24), 
                                    (inputBuffer[5] & 0x03) | (inputBuffer[6] << 2) | (inputBuffer[7] << 10)])

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = Buffer.alloc(blockSizeInPixels * rgbaPixelSize)
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
