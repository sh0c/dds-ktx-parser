import { FormatSize, LayerInfo, formatSizes } from '../header-info'

import { decodeBC1Block } from './bc1'
import { decodeBC2Block } from './bc2'
import { decodeBC3Block } from './bc3'
import { decodeBC4Block } from './bc4'
import { decodeBC5Block } from './bc5'
import { decodeBC7Block } from './bc7'

type blockDecodeFunctionType = (inputBuffer: Uint8Array, size: FormatSize) => Buffer

const blockDecode: Record<string, blockDecodeFunctionType> = {
    'BC1': decodeBC1Block,
    'BC2': decodeBC2Block,
    'BC3': decodeBC3Block,
    'BC4': decodeBC4Block,
    'BC5': decodeBC5Block,
    'BC7': decodeBC7Block
}

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

export function decodeImage(inputBuffer: Buffer, imageFormat: string, layer: LayerInfo): Buffer {
    const shape = layer.shape
    const format = formatSizes[imageFormat]
    const decodeFunc = blockDecode[imageFormat]
    const blockIDWidth = Math.floor((shape.width + format.blockWidth - 1) / format.blockWidth)
    const blockIDHeight = Math.floor((shape.height + format.blockHeight - 1) / format.blockHeight)

    var resultImage = Buffer.alloc(shape.width * shape.height * rgbaPixelSize)
    var offsetIn = layer.offset
    for (var y = 0; y < blockIDHeight; y++) {
        const startPixelY = y * format.blockHeight
        const blockYCount = startPixelY + format.blockHeight > shape.height ? shape.height - startPixelY : format.blockHeight

        for (var x = 0; x < blockIDWidth; x++) {
            const uint8Buffer = new Uint8Array(inputBuffer.buffer, inputBuffer.byteOffset + offsetIn, format.blockSize)
            const workBuffer = decodeFunc(uint8Buffer, format)

            const startPixelX = x * format.blockWidth
            const blockXCount = startPixelX + format.blockWidth > shape.width ? shape.width - startPixelX : format.blockWidth
            const copySize = blockXCount * rgbaPixelSize

            for (var i = 0; i < blockYCount; i++) {
                const sourceStart = i * format.blockWidth * rgbaPixelSize
                const targetStart = ((startPixelY + i) * shape.width + startPixelX) * rgbaPixelSize
                workBuffer.copy(resultImage, targetStart, sourceStart, sourceStart + copySize)
            }

            offsetIn += format.blockSize
        }
    }

    return resultImage
}