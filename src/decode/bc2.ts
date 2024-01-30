import { FormatSize, formatSizes } from '../header-info'
import { divisionBy3Table } from './devision-tables'

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

export function decodeBC2Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {
    const uint32View = new Uint32Array(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.length / Uint32Array.BYTES_PER_ELEMENT)
    const alphaArray: Uint32Array = uint32View.slice(0, 2)
    const colors: number = uint32View[2]
    const pixels: number = uint32View[3]

    var color_r = new Uint8Array(4)
    var color_g = new Uint8Array(4)
    var color_b = new Uint8Array(4)

    color_b[0] = (colors & 0x0000001F) << 3
    color_g[0] = (colors & 0x000007E0) >> (5 - 2)
    color_r[0] = (colors & 0x0000F800) >> (11 - 3)
    color_b[1] = (colors & 0x001F0000) >> (16 - 3)
    color_g[1] = (colors & 0x07E00000) >> (21 - 2)
    color_r[1] = (colors & 0xF8000000) >> (27 - 3)
    color_r[2] = divisionBy3Table[2 * color_r[0] + color_r[1]]
    color_g[2] = divisionBy3Table[2 * color_g[0] + color_g[1]]
    color_b[2] = divisionBy3Table[2 * color_b[0] + color_b[1]]
    color_r[3] = divisionBy3Table[color_r[0] + 2 * color_r[1]]
    color_g[3] = divisionBy3Table[color_g[0] + 2 * color_g[1]]
    color_b[3] = divisionBy3Table[color_b[0] + 2 * color_b[1]]

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = Buffer.alloc(blockSizeInPixels * rgbaPixelSize)
    for (var i = 0; i < blockSizeInPixels; i++) {
        const pixel: number = (pixels >> (i * 2)) & 0x03
        const index: number = i < 8 ? 1 : 0; 
        const alpha: number = ((alphaArray[index] >> ((i % 8) * 4)) & 0x0F) * 255 / 15

        outputBuffer[i * rgbaPixelSize]  = color_r[pixel]
        outputBuffer[i * rgbaPixelSize + 1] = color_g[pixel]
        outputBuffer[i * rgbaPixelSize + 2] = color_b[pixel]
        outputBuffer[i * rgbaPixelSize + 3] = alpha
    }

    return outputBuffer
}