import { FormatSize, formatSizes } from '../header-info'
import { divisionBy3Table } from './devision-tables'
import { u32 } from '../bytes'

// One block's pixels, reused: decodeImage copies them out before the next block.
const out = new Uint8Array(64)

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

export function decodeBC2Block(inputBuffer: Uint8Array, size: FormatSize): Uint8Array {
    const alphaLow: number = u32(inputBuffer, 0)
    const alphaHigh: number = u32(inputBuffer, 4)
    const colors: number = u32(inputBuffer, 8)
    const pixels: number = u32(inputBuffer, 12)

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
    var outputBuffer = out.fill(0)
    for (var i = 0; i < blockSizeInPixels; i++) {
        const pixel: number = (pixels >> (i * 2)) & 0x03
        // Four bits of alpha a pixel, pixels 0 to 7 in the first word. The
        // words were once taken the other way round, which swapped the top
        // and bottom halves of every block's alpha.
        const word: number = i < 8 ? alphaLow : alphaHigh
        const alpha: number = ((word >> ((i % 8) * 4)) & 0x0F) * 255 / 15

        outputBuffer[i * rgbaPixelSize]  = color_r[pixel]
        outputBuffer[i * rgbaPixelSize + 1] = color_g[pixel]
        outputBuffer[i * rgbaPixelSize + 2] = color_b[pixel]
        outputBuffer[i * rgbaPixelSize + 3] = alpha
    }

    return outputBuffer
}