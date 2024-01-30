import { FormatSize, formatSizes } from '../header-info'
import { getOneBySeven } from './devision-tables'

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

export function decodeBC5Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {
    const red0: number = inputBuffer[0]
    const red1: number = inputBuffer[1]
    const redBits = new Uint32Array([inputBuffer[2] | (inputBuffer[3] << 8) | (inputBuffer[4] << 16) | (inputBuffer[5] << 24), 
                                    (inputBuffer[5] & 0x03) | (inputBuffer[6] << 2) | (inputBuffer[7] << 10)])

    const green0: number = inputBuffer[8]
    const green1: number = inputBuffer[9]
    const greenBits = new Uint32Array([inputBuffer[10] | (inputBuffer[11] << 8) | (inputBuffer[12] << 16) | (inputBuffer[13] << 24), 
                                      (inputBuffer[13] & 0x03) | (inputBuffer[14] << 2) | (inputBuffer[15] << 10)])

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = Buffer.alloc(blockSizeInPixels * rgbaPixelSize)
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