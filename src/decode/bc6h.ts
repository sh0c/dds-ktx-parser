import { FormatSize, formatSizes } from '../header-info'
import { blockExtractBits } from './extract-bits'
import { bptcTableP2, bptcTableAnchorIndexSecondSubset } from './bptc-tables'

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

const bc6hTableMode = new Int32Array([0, 1, 2, 10, -1, -1, 3, 11, -1, -1, 4, 12, -1, -1, 5, 13,
	                                  -1, -1, 6, -1, -1, -1, 7, -1, -1, -1, 8, -1, -1, -1, 9, -1])
const bc6hTableFloatEPB = new Uint8Array([10, 7, 11, 11, 11, 9, 8, 8, 8, 6, 10, 11, 12, 16])

const bc6hTableAWeight2 = new Uint16Array([0, 21, 43, 64])
const bc6hTableAWeight3 = new Uint16Array([0, 9, 18, 27, 37, 46, 55, 64])
const bc6hTableAWeight4 = new Uint16Array([0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64])

function extractMode(data: Uint32Array): [number, number] {
    const mode: number = blockExtractBits(data, 0, 2)
    if (mode < 2) {
        return [mode, 2]
    }

    const addMode: number = mode | (blockExtractBits(data, 2, 3) << 2)
    return [bc6hTableMode[addMode], 5]
}

function unquantize(x: number, mode: number): number {
    if (mode === 13) {
        return x
    }
    else if (x === 0) {
        return 0
    }
    else if (x == ((1 << bc6hTableFloatEPB[mode]) - 1)) {
        return 0xFFFF
    }
    
    return ((x << 15) + 0x4000) >> (bc6hTableFloatEPB[mode] - 1)
}

function unquantizeSigned(x: number, mode: number): number {
    if (bc6hTableFloatEPB[mode] >= 16) {
        return x;
    }
    
    var s: number = 0
    var unq: number = 0
    if (x < 0) {
        s = 1
        x = -x
    }
    if (x === 0) {
        unq = 0
    }
    else if (x >= ((1 << (bc6hTableFloatEPB[mode] - 1)) - 1)) {
        unq = 0x7FFF
    }
    else {
        unq = ((x << 15) + 0x4000) >> (bc6hTableFloatEPB[mode] - 1)
    }

    if (s) {
        unq = -unq
    }

    return unq
}

function signExtend(value: number, sourceNuBits: number): number {
    const signBit: number = value & (1 << (sourceNuBits - 1))
    if (signBit === 0) {
        return value
    }
    var signExtendBits: number = 0xFFFFFFFF ^ ((1 << sourceNuBits) - 1)
	signExtendBits &= 0xFFFFFFFF
	return value | signExtendBits
}

function interpolateFloat(e0: number, e1: number, index: number, indexPrecision: number): number {
    switch(indexPrecision) {
        case 2:
            return (((64 - bc6hTableAWeight2[index]) * e0 + bc6hTableAWeight2[index] * e1 + 32) >> 6)
        case 3:
            return (((64 - bc6hTableAWeight3[index]) * e0 + bc6hTableAWeight3[index] * e1 + 32) >> 6)
        default: // indexPrecision == 4
            return (((64 - bc6hTableAWeight4[index]) * e0 + bc6hTableAWeight4[index] * e1 + 32) >> 6)
    }
}

function signInterpolateFloat(e0: number, e1: number, index: number, indexPrecision: number): number {
    var val = interpolateFloat(e0, e1, index, indexPrecision)
    if (val < 0) {
        val = - (((-val) * 31) >> 5)
    }
    else {
        val = (val * 31) >> 5
    }

    if (val < 0) {
        val = -val
        val |= 0x8000
    }

    return val
}

function float16ToFloat32(x: number): number {
    const s: number = x >> 15
    var e: number = x >> 10 & 0x1F
    var f: number = x & 0x3FF

    f <<= 23 - 10
    switch (e) {
        case 0:
            if (f != 0) {
                e = 1 + (127 - 15)
                while (f < 0x7FFFF) {
                    f <<= 1
                    e -= 1
                }

                f &= 0x7FFFF
            }
            break
        case 31:
            e = 255
            break
        default:
            e += 127 - 15
            break
    }

    const uintBuffer = new Uint32Array([s << 31 | e << 23 | f])
    const floatBuffer = new Float32Array(uintBuffer.buffer)

    return floatBuffer[0]
}

export function decodeBC6HBlock(inputBuffer: Uint8Array, size: FormatSize): Buffer {
    const data = new Uint32Array(inputBuffer.buffer, inputBuffer.byteOffset, 4)
    const [mode, moveIndex] = extractMode(data)
    var index: number = moveIndex
    const signedFlag: boolean = false
    
    var r = new Int32Array(4)
    var g = new Int32Array(4)
    var b = new Int32Array(4)
    var deltaBitsR: number = 0
    var deltaBitsG: number = 0
    var deltaBitsB: number = 0
    var partitionSetID: number = 0

    switch (mode) {
        case 0: {
            // m[1:0],g2[4],b2[4],b3[4],r0[9:0],g0[9:0],b0[9:0],r1[4:0],g3[4],g2[3:0],
            // g1[4:0],b3[0],g3[3:0],b1[4:0],b3[1],b2[3:0],r2[4:0],b3[2],r3[4:0],b3[3]
            g[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            b[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            b[3] = blockExtractBits(data, index, 1) << 4
            index += 1
            r[0] = blockExtractBits(data, index, 10)
            index += 10
            g[0] = blockExtractBits(data, index, 10)
            index += 10
            b[0] = blockExtractBits(data, index, 10)
            index += 10
            r[1] = blockExtractBits(data, index, 5)
            index += 5
            g[3] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[2] |= blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1)
            index += 1
            g[3] |= blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] |= blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            r[3] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1
            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = deltaBitsG = deltaBitsB = 5
            break
        }
        case 1: {
            // m[1:0],g2[5],g3[4],g3[5],r0[6:0],b3[0],b3[1],b2[4],g0[6:0],b2[5],b3[2],
            // g2[4],b0[6:0],b3[3],b3[5],b3[4],r1[5:0],g2[3:0],g1[5:0],g3[3:0],b1[5:0],
            // b2[3:0],r2[5:0],r3[5:0]
            g[2] = blockExtractBits(data, index, 1) << 5
            index += 1
            g[3] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[3] |= blockExtractBits(data, index, 1) << 5
            index += 1
            r[0] = blockExtractBits(data, index, 7)
            index += 7
            b[3] = blockExtractBits(data, index, 1)
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[0] = blockExtractBits(data, index, 7)
            index += 7
            b[2] |= blockExtractBits(data, index, 1) << 5
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            g[2] |= blockExtractBits(data, index, 1) << 4
            index += 1
            b[0] = blockExtractBits(data, index, 7)
            index += 7
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 5
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 4
            index += 1
            r[1] = blockExtractBits(data, index, 6)
            index += 6
            g[2] |= blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 6)
            index += 6
            g[3] |= blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 6)
            index += 6
            b[2] |= blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 6)
            index += 6
            r[3] = blockExtractBits(data, index, 6)
            index += 6
            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = deltaBitsG = deltaBitsB = 6

            break
        }

        case 2: {
            // m[4:0],r0[9:0],g0[9:0],b0[9:0],r1[4:0],r0[10],g2[3:0],g1[3:0],g0[10],
            // b3[0],g3[3:0],b1[3:0],b0[10],b3[1],b2[3:0],r2[4:0],b3[2],r3[4:0],b3[3]
            r[0] = blockExtractBits(data, index, 10)
            index += 10
            g[0] = blockExtractBits(data, index, 10)
            index += 10
            b[0] = blockExtractBits(data, index, 10)
            index += 10
            r[1] = blockExtractBits(data, index, 5)
            index += 5
            r[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            g[2] = blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 4)
            index += 4
            g[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            b[3] = blockExtractBits(data, index, 1)
            index += 1
            g[3] = blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 4)
            index += 4
            b[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] = blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            r[3] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1
            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = 5
            deltaBitsG = deltaBitsB = 4

            break
        }
        case 3: { // Original mode 6
            // m[4:0],r0[9:0],g0[9:0],b0[9:0],r1[3:0],r0[10],g3[4],g2[3:0],g1[4:0],
            // g0[10],g3[3:0],b1[3:0],b0[10],b3[1],b2[3:0],r2[3:0],b3[0],b3[2],r3[3:0],
            // g2[4],b3[3]
            r[0] = blockExtractBits(data, index, 10)
            index += 10
            g[0] = blockExtractBits(data, index, 10)
            index += 10
            b[0] = blockExtractBits(data, index, 10)
            index += 10
            r[1] = blockExtractBits(data, index, 4)
            index += 4
            r[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            g[3] = blockExtractBits(data, index, 1) << 10
            index += 1
            g[2] = blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 5)
            index += 5
            g[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            g[3] |= blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 4)
            index += 4
            b[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            b[3] = blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] = blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 4)
            index += 4
            b[3] |= blockExtractBits(data, index, 1)
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            r[3] = blockExtractBits(data, index, 4)
            index += 4
            g[2] |= blockExtractBits(data, index, 1) << 4
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1
            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = deltaBitsB = 4
            deltaBitsG = 4
            break
        }
        case 4: { // Original mode 10
            // m[4:0],r0[9:0],g0[9:0],b0[9:0],r1[3:0],r0[10],b2[4],g2[3:0],g1[3:0],
            // g0[10],b3[0],g3[3:0],b1[4:0],b0[10],b2[3:0],r2[3:0],b3[1],b3[2],r3[3:0],
            // b3[4],b3[3]
            r[0] = blockExtractBits(data, index, 10)
            index += 10
            g[0] = blockExtractBits(data, index, 10)
            index += 10
            b[0] = blockExtractBits(data, index, 10)
            index += 10
            r[1] = blockExtractBits(data, index, 4)
            index += 4
            r[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            b[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[2] = blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 4)
            index += 4
            g[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            b[3] = blockExtractBits(data, index, 1)
            index += 1
            g[3] = blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 5)
            index += 5
            b[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            b[2] |= blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 4)
            index += 4
            b[3] |= blockExtractBits(data, index, 1) << 1
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            r[3] = blockExtractBits(data, index, 4)
            index += 4
            b[3] |= blockExtractBits(data, index, 1) << 4
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1

            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = deltaBitsG = 4
            deltaBitsB = 4
            break
        }
        case 5: { // Original mode 14
            // m[4:0],r0[8:0],b2[4],g0[8:0],g2[4],b0[8:0],b3[4],r1[4:0],g3[4],g2[3:0],
		    // g1[4:0],b3[0],g3[3:0],b1[4:0],b3[1],b2[3:0],r2[4:0],b3[2],r3[4:0],b3[3]
            r[0] = blockExtractBits(data, index, 9)
            index += 9
            b[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[0] = blockExtractBits(data, index, 9)
            index += 9
            g[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            b[0] = blockExtractBits(data, index, 9)
            index += 9
            b[3] = blockExtractBits(data, index, 1) << 4
            index += 1
            r[1] = blockExtractBits(data, index, 5)
            index += 5
            g[3] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[2] |= blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1)
            index += 1
            g[3] |= blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] = blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            r[3] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1
            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = deltaBitsG = deltaBitsB = 5
            break
        }
        case 6: { // Original mode 18
            // m[4:0],r0[7:0],g3[4],b2[4],g0[7:0],b3[2],g2[4],b0[7:0],b3[3],b3[4],
		    // r1[5:0],g2[3:0],g1[4:0],b3[0],g3[3:0],b1[4:0],b3[1],b2[3:0],r2[5:0],r3[5:0]
            r[0] = blockExtractBits(data, index, 8)
            index += 8
            g[3] = blockExtractBits(data, index, 1) << 4
            index += 1
            b[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[0] = blockExtractBits(data, index, 8)
            index += 8
            b[3] = blockExtractBits(data, index, 1) << 2
            index += 1
            g[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            b[0] = blockExtractBits(data, index, 8)
            index += 8
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 4
            index += 1
            r[1] = blockExtractBits(data, index, 6)
            index += 6
            g[2] |= blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1)
            index += 1
            g[3] |= blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] |= blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 6)
            index += 6
            r[3] = blockExtractBits(data, index, 6)
            index += 6
            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = 6
            deltaBitsG = deltaBitsB = 5
            break
        }
        case 7: {
            // m[4:0],r0[7:0],b3[0],b2[4],g0[7:0],g2[5],g2[4],b0[7:0],g3[5],b3[4],
            // r1[4:0],g3[4],g2[3:0],g1[5:0],g3[3:0],b1[4:0],b3[1],b2[3:0],r2[4:0],
            // b3[2],r3[4:0],b3[3]
            r[0] = blockExtractBits(data, index, 8)
            index += 8
            b[3] = blockExtractBits(data, index, 1)
            index += 1
            b[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[0] = blockExtractBits(data, index, 8)
            index += 8
            g[2] = blockExtractBits(data, index, 1) << 5
            index += 1
            g[2] |= blockExtractBits(data, index, 1) << 4
            index += 1
            b[0] = blockExtractBits(data, index, 8)
            index += 8
            g[3] = blockExtractBits(data, index, 1) << 5
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 4
            index += 1
            r[1] = blockExtractBits(data, index, 5)
            index += 5
            g[3] |= blockExtractBits(data, index, 1) << 4
            index += 1
            g[2] |= blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 6)
            index += 6
            g[3] |= blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] |= blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            r[3] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1

            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = deltaBitsB = 5
            deltaBitsG = 6
            break
        }

        case 8: { // Original mode 26
            // m[4:0],r0[7:0],b3[1],b2[4],g0[7:0],b2[5],g2[4],b0[7:0],b3[5],b3[4],
		    // r1[4:0],g3[4],g2[3:0],g1[4:0],b3[0],g3[3:0],b1[5:0],b2[3:0],r2[4:0],
		    // b3[2],r3[4:0],b3[3]
            r[0] = blockExtractBits(data, index, 8)
            index += 8
            b[3] = blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[0] = blockExtractBits(data, index, 8)
            index += 8
            b[2] |= blockExtractBits(data, index, 1) << 5
            index += 1
            g[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            b[0] = blockExtractBits(data, index, 8)
            index += 8
            b[3] |= blockExtractBits(data, index, 1) << 5
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 4
            index += 1
            r[1] = blockExtractBits(data, index, 5)
            index += 5
            g[3] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[2] |= blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1)
            index += 1
            g[3] |= blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 6)
            index += 6
            b[2] |= blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            r[3] = blockExtractBits(data, index, 5)
            index += 5
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1

            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            deltaBitsR = deltaBitsG = 5
            deltaBitsB = 6
            break
        }
        case 9: { // Original mode 30
            // m[4:0],r0[5:0],g3[4],b3[0],b3[1],b2[4],g0[5:0],g2[5],b2[5],b3[2],
            // g2[4],b0[5:0],g3[5],b3[3],b3[5],b3[4],r1[5:0],g2[3:0],g1[5:0],g3[3:0],
            // b1[5:0],b2[3:0],r2[5:0],r3[5:0]
            r[0] = blockExtractBits(data, index, 6)
            index += 6
            g[3] = blockExtractBits(data, index, 1) << 4
            index += 1
            b[3] = blockExtractBits(data, index, 1)
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 1
            index += 1
            b[2] = blockExtractBits(data, index, 1) << 4
            index += 1
            g[0] = blockExtractBits(data, index, 6)
            index += 6
            g[2] = blockExtractBits(data, index, 1) << 5
            index += 1
            b[2] |= blockExtractBits(data, index, 1) << 5
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 2
            index += 1
            g[2] |= blockExtractBits(data, index, 1) << 4
            index += 1
            b[0] = blockExtractBits(data, index, 6)
            index += 6
            g[3] |= blockExtractBits(data, index, 1) << 5
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 3
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 5
            index += 1
            b[3] |= blockExtractBits(data, index, 1) << 4
            index += 1
            r[1] = blockExtractBits(data, index, 6)
            index += 6
            g[2] |= blockExtractBits(data, index, 4)
            index += 4
            g[1] = blockExtractBits(data, index, 6)
            index += 6
            g[3] |= blockExtractBits(data, index, 4)
            index += 4
            b[1] = blockExtractBits(data, index, 6)
            index += 6
            b[2] |= blockExtractBits(data, index, 4)
            index += 4
            r[2] = blockExtractBits(data, index, 6)
            index += 6
            r[3] = blockExtractBits(data, index, 6)
            index += 6
            partitionSetID = blockExtractBits(data, index, 5)
            index += 5
            break
        }
        case 10: { // Original mode 3
            // m[4:0],r0[9:0],g0[9:0],b0[9:0],r1[9:0],g1[9:0],b1[9:0]
            r[0] = blockExtractBits(data, index, 10)
            index += 10
            g[0] = blockExtractBits(data, index, 10)
            index += 10
            b[0] = blockExtractBits(data, index, 10)
            index += 10
            r[1] = blockExtractBits(data, index, 10)
            index += 10
            g[1] = blockExtractBits(data, index, 10)
            index += 10
            b[1] = blockExtractBits(data, index, 10)
            index += 10
            partitionSetID = 0
            break
        }
        case 11: { // Original mode 7
            // m[4:0],r0[9:0],g0[9:0],b0[9:0],r1[8:0],r0[10],g1[8:0],g0[10],b1[8:0],b0[10]
            r[0] = blockExtractBits(data, index, 10)
            index += 10
            g[0] = blockExtractBits(data, index, 10)
            index += 10
            b[0] = blockExtractBits(data, index, 10)
            index += 10
            r[1] = blockExtractBits(data, index, 9)
            index += 9
            r[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            g[1] = blockExtractBits(data, index, 9)
            index += 9
            g[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            b[1] = blockExtractBits(data, index, 9)
            index += 9
            b[0] |= blockExtractBits(data, index, 1) << 10
            index += 1
            partitionSetID = 0
            deltaBitsR = deltaBitsG = deltaBitsB = 9
            break
        }
        case 12: { // Original mode 11
            // m[4:0],r0[9:0],g0[9:0],b0[9:0],r1[7:0],r0[10:11],g1[7:0],g0[10:11],
            // b1[7:0],b0[10:11]
            r[0] = blockExtractBits(data, index, 10)
            index += 10
            g[0] = blockExtractBits(data, index, 10)
            index += 10
            b[0] = blockExtractBits(data, index, 10)
            index += 10
            r[1] = blockExtractBits(data, index, 8)
            index += 8
            r[0] |= blockExtractBits(data, index, 2) << 10
            index += 2
            g[1] = blockExtractBits(data, index, 8)
            index += 8
            g[0] |= blockExtractBits(data, index, 2) << 10
            index += 2
            b[1] = blockExtractBits(data, index, 8)
            index += 8
            b[0] |= blockExtractBits(data, index, 2) << 10
            index += 2
            partitionSetID = 0
            deltaBitsR = deltaBitsG = deltaBitsB = 8
            break
        }
        case 13: { // Original mode 15
            // m[4:0],r0[9:0],g0[9:0],b0[9:0],r1[3:0],r0[10:15],g1[3:0],g0[10:15],
            // b1[3:0],b0[10:15]
            r[0] = blockExtractBits(data, index, 10)
            index += 10
            g[0] = blockExtractBits(data, index, 10)
            index += 10
            b[0] = blockExtractBits(data, index, 10)
            index += 10
            r[1] = blockExtractBits(data, index, 4)
            index += 4
            r[0] |= blockExtractBits(data, index, 6) << 10
            index += 6
            g[1] = blockExtractBits(data, index, 4)
            index += 4
            g[0] |= blockExtractBits(data, index, 6) << 10
            index += 6
            b[1] = blockExtractBits(data, index, 4)
            index += 4
            b[0] |= blockExtractBits(data, index, 6) << 10
            index += 6
            partitionSetID = 0
            deltaBitsR = deltaBitsG = deltaBitsB = 4
            break
        }
    }

    const nuSubsets: number = mode >= 10 ? 1 : 2
    if (signedFlag) {
        r[0] = signExtend(r[0], bc6hTableFloatEPB[mode])
        g[0] = signExtend(g[0], bc6hTableFloatEPB[mode])
        b[0] = signExtend(b[0], bc6hTableFloatEPB[mode])
    }

    if (mode != 9 && mode != 10) {
        for (var i = 1; i < nuSubsets * 2; i++) {
            r[i] = signExtend(r[i], deltaBitsR)
            r[i] = (r[0] + r[i]) & ((1 << bc6hTableFloatEPB[mode]) - 1)
            g[i] = signExtend(g[i], deltaBitsG)
            g[i] = (g[0] + g[i]) & ((1 << bc6hTableFloatEPB[mode]) - 1)
            b[i] = signExtend(b[i], deltaBitsB)
            b[i] = (b[0] + b[i]) & ((1 << bc6hTableFloatEPB[mode]) - 1)
            if (signedFlag) {
                r[i] = signExtend(r[i], bc6hTableFloatEPB[mode])
                g[i] = signExtend(g[i], bc6hTableFloatEPB[mode])
                b[i] = signExtend(b[i], bc6hTableFloatEPB[mode])
            }
        }
    }
    else if (signedFlag) { // Mode 9 or 10, no transformed endpoints.
        for (var i = 1; i < nuSubsets * 2; i++) {
            r[i] = signExtend(r[i], bc6hTableFloatEPB[mode])
            g[i] = signExtend(g[i], bc6hTableFloatEPB[mode])
            b[i] = signExtend(b[i], bc6hTableFloatEPB[mode])
        }
    }

    if(signedFlag) {
        for (var i = 0; i < nuSubsets * 2; i++) {
            r[i] = unquantizeSigned(r[i], mode)
            g[i] = unquantizeSigned(g[i], mode)
            b[i] = unquantizeSigned(b[i], mode)
        }
    }
    else {
        for (var i = 0; i < nuSubsets * 2; i++) {
            r[i] = unquantize(r[i], mode)
            g[i] = unquantize(g[i], mode)
            b[i] = unquantize(b[i], mode)
        }
    }

    var subsetIndex = new Uint8Array(16)
    for (var i = 0; i < 16; i++) {
        subsetIndex[i] = nuSubsets === 1 ? 0 : bptcTableP2[partitionSetID * 16 + i]
    }

    var anchorIndex = new Uint8Array(4)
    for (var i = 0; i < nuSubsets; i++) {
        anchorIndex[i] = i === 0 ? 0 : bptcTableAnchorIndexSecondSubset[partitionSetID]
    }

    var colorIndex = new Uint8Array(16)
    var colorIndexBitCount: number = 3
    if ((inputBuffer[0] & 0x03) === 0x03) {
        colorIndexBitCount = 4
    }

    for (var i = 0; i < 16; i++) {
        if (i === anchorIndex[subsetIndex[i]]) {
            colorIndex[i] = blockExtractBits(data, index, colorIndexBitCount - 1)
            index += colorIndexBitCount - 1
        }
        else {
            colorIndex[i] = blockExtractBits(data, index, colorIndexBitCount)
            index += colorIndexBitCount
        }
    }

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = Buffer.alloc(blockSizeInPixels * rgbaPixelSize)
    for (var i = 0; i < blockSizeInPixels; i++) {
        const idx: number = 2 * subsetIndex[i]
        const endpointStartR: number = r[idx]
        const endpointEndR: number = r[idx + 1]
        const endpointStartG: number = g[idx]
        const endpointEndG: number = g[idx + 1]
        const endpointStartB: number = b[idx]
        const endpointEndB: number = b[idx + 1]

        var r16: number = 0
        var g16: number = 0
        var b16: number = 0
        if (signedFlag) {
            r16 = signInterpolateFloat(endpointStartR, endpointEndR, colorIndex[i], colorIndexBitCount)
            g16 = signInterpolateFloat(endpointStartG, endpointEndG, colorIndex[i], colorIndexBitCount)
            b16 = signInterpolateFloat(endpointStartB, endpointEndB, colorIndex[i], colorIndexBitCount)
        }
        else {
            r16 = Math.floor(interpolateFloat(endpointStartR, endpointEndR, colorIndex[i], colorIndexBitCount) * 31 / 64)
            g16 = Math.floor(interpolateFloat(endpointStartG, endpointEndG, colorIndex[i], colorIndexBitCount) * 31 / 64)
            b16 = Math.floor(interpolateFloat(endpointStartB, endpointEndB, colorIndex[i], colorIndexBitCount) * 31 / 64)
        }

        outputBuffer[i * rgbaPixelSize]  = float16ToFloat32(r16) * 255 + 0.5
        outputBuffer[i * rgbaPixelSize + 1] = float16ToFloat32(g16) * 255 + 0.5
        outputBuffer[i * rgbaPixelSize + 2] = float16ToFloat32(b16) * 255 + 0.5
        outputBuffer[i * rgbaPixelSize + 3] = 0xFF
    }

    return outputBuffer
}