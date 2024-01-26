import { FormatSize, LayerInfo, formatSizes } from './header-info'
import { divisionBy3Table, divisionBy5Table, divisionBy7Table } from './devision-tables'

const rgbaPixelSize: number = 4

function decodeBC1Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {

    const uint32View = new Uint32Array(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.length / Uint32Array.BYTES_PER_ELEMENT)
    const colors: number = uint32View[0]
    const pixels: number = uint32View[1]
    const opaque: boolean = (colors & 0xFFFF) > ((colors & 0xFFFF0000) >> 16)

    var color_r = new Uint8Array(4)
    var color_g = new Uint8Array(4)
    var color_b = new Uint8Array(4)
    var color_a = new Uint8Array(4)

    color_b[0] = (colors & 0x0000001F) << 3
    color_g[0] = (colors & 0x000007E0) >> (5 - 2)
    color_r[0] = (colors & 0x0000F800) >> (11 - 3)
    color_b[1] = (colors & 0x001F0000) >> (16 - 3)
    color_g[1] = (colors & 0x07E00000) >> (21 - 2)
    color_r[1] = (colors & 0xF8000000) >> (27 - 3)
    color_a[0] = color_a[1] = color_a[2] = color_a[3] = 0xFF
    if (opaque) {
        color_r[2] = divisionBy3Table[2 * color_r[0] + color_r[1]]
        color_g[2] = divisionBy3Table[2 * color_g[0] + color_g[1]]
        color_b[2] = divisionBy3Table[2 * color_b[0] + color_b[1]]
        color_r[3] = divisionBy3Table[color_r[0] + 2 * color_r[1]]
        color_g[3] = divisionBy3Table[color_g[0] + 2 * color_g[1]]
        color_b[3] = divisionBy3Table[color_b[0] + 2 * color_b[1]]
    }
    else {
        color_r[2] = (color_r[0] + color_r[1]) / 2
        color_g[2] = (color_g[0] + color_g[1]) / 2
        color_b[2] = (color_b[0] + color_b[1]) / 2
        color_r[3] = color_g[3] = color_b[3] = color_a[3] = 0x00
    }

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = Buffer.alloc(blockSizeInPixels * rgbaPixelSize)
    for (var i = 0; i < blockSizeInPixels; i++) {
        const pixel: number = (pixels >> (i * 2)) & 0x03
        outputBuffer[i * rgbaPixelSize]  = color_r[pixel]
        outputBuffer[i * rgbaPixelSize + 1] = color_g[pixel]
        outputBuffer[i * rgbaPixelSize + 2] = color_b[pixel]
        outputBuffer[i * rgbaPixelSize + 3] = color_a[pixel]
    }

    return outputBuffer
}

function decodeBC2Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {
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

function getOneBySeven(code: number, alpha0: number, alpha1: number): number {
    if (alpha0 > alpha1) {
        switch (code) {
            case 0: return alpha0
            case 1: return alpha1
            case 2: return divisionBy7Table[6 * alpha0 + 1 * alpha1]
            case 3: return divisionBy7Table[5 * alpha0 + 2 * alpha1]
            case 4: return divisionBy7Table[4 * alpha0 + 3 * alpha1]
            case 5: return divisionBy7Table[3 * alpha0 + 4 * alpha1]
            case 6: return divisionBy7Table[2 * alpha0 + 5 * alpha1]
            case 7: return divisionBy7Table[1 * alpha0 + 6 * alpha1]
        }

        return 0x00
    }
    
    switch (code) {
        case 0 : return alpha0
        case 1 : return alpha1
        case 2 : return divisionBy5Table[4 * alpha0 + 1 * alpha1]
        case 3 : return divisionBy5Table[3 * alpha0 + 2 * alpha1]
        case 4 : return divisionBy5Table[2 * alpha0 + 3 * alpha1]
        case 5 : return divisionBy5Table[1 * alpha0 + 4 * alpha1]
        case 6 : return 0x00
        case 7 : return 0xFF
    }
    
    return 0x00
}

function i2hex(i: number) {
    return ('0' + i.toString(16)).slice(-2);
  }

function decodeBC3Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {
    
    const alpha0: number = inputBuffer[0]
    const alpha1: number = inputBuffer[1]
    const alphaBits = new Uint32Array([inputBuffer[2] | (inputBuffer[3] << 8) | (inputBuffer[4] << 16) | (inputBuffer[5] << 24), 
                                       (inputBuffer[5] & 0x03) | (inputBuffer[6] << 2) | (inputBuffer[7] << 10)])
    const uint32View = new Uint32Array(inputBuffer.buffer, inputBuffer.byteOffset + 8, 2)
    const colors: number = uint32View[0]
    const pixels: number = uint32View[1]

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
        const index: number = i < 10 ? 0 : 1; 
		const code = (alphaBits[index] >> ((i % 10) * 3)) & 0x07;
		const alpha = getOneBySeven(code, alpha0, alpha1)
		
        outputBuffer[i * rgbaPixelSize]  = color_r[pixel]
        outputBuffer[i * rgbaPixelSize + 1] = color_g[pixel]
        outputBuffer[i * rgbaPixelSize + 2] = color_b[pixel]
        outputBuffer[i * rgbaPixelSize + 3] = alpha
    }

    return outputBuffer
}

function decodeBC4Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {
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

function decodeBC5Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {
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

type blockDecodeFunctionType = (inputBuffer: Uint8Array, size: FormatSize) => Buffer
const blockDecode: Record<string, blockDecodeFunctionType> = {
    'BC1': decodeBC1Block,
    'BC2': decodeBC2Block,
    'BC3': decodeBC3Block,
    'BC4': decodeBC4Block,
    'BC5': decodeBC5Block,
}

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