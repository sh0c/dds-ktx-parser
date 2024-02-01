import { FormatSize, formatSizes } from '../header-info'
import { blockExtractBits } from './extract-bits'
import { bptcTableP2,
         bptcTableP3, 
         bptcTableAnchorIndexSecondSubset,
         bptcTableAnchorIndexSecondSubsetOfThree,
         bptcTableAnchorIndexThirdSubset } from './bptc-tables'

const bc7TableAWeight2 = new Uint8Array([
	0, 21, 43, 64
])

const bc7TableAWeight3 = new Uint8Array([
	0, 9, 18, 27, 37, 46, 55, 64
])

const bc7TableAWeight4 = new Uint8Array([
	0, 4, 9, 13, 17, 21, 26, 30,
	34, 38, 43, 47, 51, 55, 60, 64
])

const rgbaPixelSize: number = formatSizes['RGBA'].blockSize

function extractMode(byte: number): number {
    var mode: number = 0
    for (var i = 0; i < 8; i++) {
        if ((byte & (1 << i)) !== 0) {
            return i
        }
    }
    // illegal
    return -1
}

function interpolate(e0: number, e1: number, index: number, indexprecision: number): number {
	if (indexprecision == 2) {
		return (((64 - bc7TableAWeight2[index]) * e0 + bc7TableAWeight2[index] * e1 + 32) >> 6) & 0xFF
    }
	else if (indexprecision == 3) {
		return (((64 - bc7TableAWeight3[index]) * e0 + bc7TableAWeight3[index] * e1 + 32) >> 6) & 0xFF
    }
	else // indexprecision == 4
    {
		return (((64 - bc7TableAWeight4[index]) * e0 + bc7TableAWeight4[index] * e1 + 32) >> 6) & 0xFF
    }
}

const modeHasPartitionBits = new Uint8Array([ 1, 1, 1, 1, 0, 0, 0, 1 ])
const bc7NS = new Uint8Array([ 3, 2, 3, 2, 1, 1, 1, 2 ])
const PartitionBits = new Uint8Array([4, 6, 6, 6, 0, 0, 0, 6 ])
const RotationBits = new Uint8Array([ 0, 0, 0, 0, 2, 2, 0, 0 ])
const bc7TableAlphaIndexBitcount = new Uint8Array([ 3, 3, 2, 2, 3, 2, 4, 2 ])
const bc7TableColorIndexBitcount = new Uint8Array([ 3, 3, 2, 2, 2, 2, 4, 2 ])
const bc7TableComponentsInQWORD0 = new Uint8Array([ 2, -1, 1, 1, 3, 3, 3, 2 ])
const bc7TableColorPrecision = new Uint8Array([ 4, 6, 5, 7, 5, 7, 7, 5 ])
const bc7TableColorPrecisionPlusPBit = new Uint8Array([ 5, 7, 5, 8, 5, 7, 8, 6 ])
const bc7TableAlphaPrecision = new Uint8Array([ 0, 0, 0, 0, 6, 8, 7, 5 ])
const bc7TableAlphaPrecisionPlusPBit = new Uint8Array([ 0, 0, 0, 0, 6, 8, 8, 6 ])
const bc7TableModeHasPBits = new Uint8Array([ 1, 1, 0, 1, 0, 0, 1, 1 ])
const bc7TableInterpalationBits = new Uint8Array([ 3, 3, 2, 2, 2, 2, 4, 2 ])
const bc7TableInterpalationBits2 = new Uint8Array([ 0, 0, 0, 0, 3, 2, 0, 0 ])

function decoodeBlockBC7Mode1(inputBuffer: Uint8Array, size: FormatSize): Buffer {
    const partitionSetID: number = inputBuffer[0] >> 2
    const endpoint = new Uint8Array(12)
    endpoint[0] = inputBuffer[1] & 0x3F // red, subnet 0, endpoint 0
    endpoint[3] = (inputBuffer[1] >> 6) | ((inputBuffer[2] & 0x0F) << 2) // red, subnet 0, endpoint 1
    endpoint[6] = (inputBuffer[2] >> 4) | ((inputBuffer[3] & 0x03) << 4) // red, subnet 1, endpoint 0
    endpoint[9] = inputBuffer[3] >> 2 // red, subnet 1, endpoint 1

    endpoint[1] = inputBuffer[4] & 0x3F // green, subnet 0, endpoint 0
    endpoint[4] = (inputBuffer[4] >> 6) | ((inputBuffer[5] & 0x0F) << 2) // green, subnet 0, endpoint 1
    endpoint[7] = (inputBuffer[5] >> 4) | ((inputBuffer[6] & 0x03) << 4) // green, subnet 1, endpoint 0
    endpoint[10] = inputBuffer[6] >> 2 // green, subnet 1, endpoint 1

    endpoint[2] = inputBuffer[7] & 0x3F // blue, subnet 0, endpoint 0
    endpoint[5] = (inputBuffer[7] >> 6) | ((inputBuffer[8] & 0x0F) << 2) // blue, subnet 0, endpoint 1
    endpoint[8] = (inputBuffer[8] >> 4) | ((inputBuffer[9] & 0x03) << 4) // blue, subnet 1, endpoint 0
    endpoint[11] = inputBuffer[9] >> 2 // blue, subnet 1, endpoint 1

    for (var i = 0; i < 2 * 2; i++) {
		//component-wise left-shift
		endpoint[i * 3 + 0] <<= 2;
		endpoint[i * 3 + 1] <<= 2;
		endpoint[i * 3 + 2] <<= 2;
    }

    const pbitZero: number = (inputBuffer[10] & 0x01) << 1
    const pbitOne: number = inputBuffer[10] & 0x02

    // RGB only pbits for mode 1, one for each subset.
	for (var j = 0; j < 3; j++) {
		endpoint[0 * 3 + j] |= pbitZero
		endpoint[1 * 3 + j] |= pbitZero
		endpoint[2 * 3 + j] |= pbitOne
		endpoint[3 * 3 + j] |= pbitOne
	}

	for (var i = 0; i < 2 * 2; i++) {
        // Replicate each component's MSB into the LSB.
		endpoint[i * 3 + 0] |= endpoint[i * 3 + 0] >> 7
		endpoint[i * 3 + 1] |= endpoint[i * 3 + 1] >> 7
		endpoint[i * 3 + 2] |= endpoint[i * 3 + 2] >> 7
	}

    const subsetIndex = new Uint8Array(16)
	for (var i = 0; i < 16; i++) {
        // subsetIndex[i] is a number from 0 to 1.
		subsetIndex[i] = bptcTableP2[partitionSetID * 16 + i]
    }

    const anchorIndex = new Uint8Array([0, bptcTableAnchorIndexSecondSubset[partitionSetID]])
    const colorIndexArray = new Uint32Array([inputBuffer[10] >> 2 | (inputBuffer[11] << 6) | (inputBuffer[12] << 14) | (inputBuffer[13] << 22) | (inputBuffer[14] << 30), 
                                             inputBuffer[14] | (inputBuffer[15] << 8) ])
    var moveBits: number = 0
    var idx: number = 0

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = Buffer.alloc(blockSizeInPixels * rgbaPixelSize)
    for (var i = 0; i < 16; i++) {
        var colorIndex: number = 0

        if (i === anchorIndex[subsetIndex[i]]) {
            colorIndex = (colorIndexArray[idx] >> moveBits) & 0x03
            moveBits += 2
        }
        else {
            colorIndex = (colorIndexArray[idx] >> moveBits) & 0x07
            moveBits += 3
        }

        // move to next element in array
        if (moveBits >= 30) {
            moveBits -= 30
            idx++
        }

        var endpointStart = new Uint8Array(3)
        var endpointEnd = new Uint8Array(3)
        for (var j = 0; j < 3; j++) {
            endpointStart[j] = endpoint[2 * subsetIndex[i] * 3 + j];
            endpointEnd[j] = endpoint[(2 * subsetIndex[i] + 1) * 3 + j];
        }

        outputBuffer[i * rgbaPixelSize]  = interpolate(endpointStart[0], endpointEnd[0], colorIndex, 3)
        outputBuffer[i * rgbaPixelSize + 1] = interpolate(endpointStart[1], endpointEnd[1], colorIndex, 3)
        outputBuffer[i * rgbaPixelSize + 2] = interpolate(endpointStart[2], endpointEnd[2], colorIndex, 3)
        outputBuffer[i * rgbaPixelSize + 3] = 0xFF
    }

    return outputBuffer
}

export function decodeBC7Block(inputBuffer: Uint8Array, size: FormatSize): Buffer {
    const data = new Uint32Array(inputBuffer.buffer, inputBuffer.byteOffset, 4)
    const mode = extractMode(inputBuffer[0])
    var index: number = mode + 1

    if (mode === 1) {
        return decoodeBlockBC7Mode1(inputBuffer, size)
    }

    var nuSubsets: number = 1
    var partitionSetId: number = 0
    if (modeHasPartitionBits[mode] === 1 ) {
        
        const numOfPartitionBits: number = PartitionBits[mode]
        nuSubsets = bc7NS[mode]
        partitionSetId = blockExtractBits(data, index, numOfPartitionBits)
        index += numOfPartitionBits
    }

    const numOfRotationBits: number = RotationBits[mode]
    const rotation: number = blockExtractBits(data, index, numOfRotationBits)
    index += numOfRotationBits
    
    var indexSelectionBit: number = 0
    if (mode === 4) {
        indexSelectionBit = blockExtractBits(data, index, 1)
        index += 1
    }

    const alphaIndexBitcount: number = bc7TableAlphaIndexBitcount[mode] - indexSelectionBit
    const colorIndexBitcount: number = bc7TableColorIndexBitcount[mode] + indexSelectionBit
    
    var endpoint = new Uint8Array(24)

    // extract endpoints
    const componentsInQWORD0: number = bc7TableComponentsInQWORD0[mode]
    const precision: number = bc7TableColorPrecision[mode]

    for (var i = 0; i < componentsInQWORD0; i++) { // for each color component
        for (var j = 0; j < nuSubsets; j++) { // for each subset
            for (var k = 0; k < 2; k++) { // For each endpoint
                endpoint[j * 8 + k * 4 + i] = blockExtractBits(data, index, precision)
                index += precision
            }
        }
    }

    if (componentsInQWORD0 < 3) {
        const i: number = componentsInQWORD0
        for (var j = 0; j < nuSubsets; j++) { // for each subset
            for (var k = 0; k < 2; k++) { // For each endpoint
                endpoint[j * 8 + k * 4 + i] = blockExtractBits(data, index, precision)
                index += precision
            }
        }
    }

    if (componentsInQWORD0 < 2) {
        const i: number = 2
        for (var j = 0; j < nuSubsets; j++) { // for each subset
            for (var k = 0; k < 2; k++) { // For each endpoint
                endpoint[j * 8 + k * 4 + i] = blockExtractBits(data, index, precision)
                index += precision
            }
        }
    }
    
    const alphaPrecision: number = bc7TableAlphaPrecision[mode]
    if (alphaPrecision > 0) {
        for (var j = 0; j < nuSubsets; j++) { // for each subset
            for (var k = 0; k < 2; k++) { // For each endpoint
                endpoint[j * 8 + k * 4 + 3] = blockExtractBits(data, index, alphaPrecision)
                index += alphaPrecision
            }
        }
    }
    // end extract endpoints

    // fully decode endpoints
    if (bc7TableModeHasPBits[mode]) {
        for (var i = 0; i < nuSubsets * 2; i++) {
            const bit: number = blockExtractBits(data, index, 1)
            index += 1

            endpoint[i * 4 + 0] <<= 1
            endpoint[i * 4 + 1] <<= 1
            endpoint[i * 4 + 2] <<= 1
            endpoint[i * 4 + 3] <<= 1
            endpoint[i * 4 + 0] |= bit
            endpoint[i * 4 + 1] |= bit
            endpoint[i * 4 + 2] |= bit
            endpoint[i * 4 + 3] |= bit
            
        }
    }

    const colorPrec: number = bc7TableColorPrecisionPlusPBit[mode]
    const alphaPrec: number = bc7TableAlphaPrecisionPlusPBit[mode]

    for (var i = 0; i < nuSubsets * 2; i++) {
        // Color_component_precision & alpha_component_precision includes pbit
        // left shift endpoint components so that their MSB lies in bit 7
        endpoint[i * 4 + 0] <<= (8 - colorPrec);
        endpoint[i * 4 + 1] <<= (8 - colorPrec);
        endpoint[i * 4 + 2] <<= (8 - colorPrec);
        endpoint[i * 4 + 3] <<= (8 - alphaPrec);

        // Replicate each component's MSB into the LSBs revealed by the left-shift operation above.
        endpoint[i * 4 + 0] |= (endpoint[i * 4 + 0] >> colorPrec);
        endpoint[i * 4 + 1] |= (endpoint[i * 4 + 1] >> colorPrec);
        endpoint[i * 4 + 2] |= (endpoint[i * 4 + 2] >> colorPrec);
        endpoint[i * 4 + 3] |= (endpoint[i * 4 + 3] >> alphaPrec);
    }

    if (mode <= 3) {
        for (var i = 0; i < nuSubsets * 2; i++) {
            endpoint[i * 4 + 3] = 0xFF
        }
    }
    // end fully decode endpoints

    var subsetIndex = new Uint8Array(16)
    for (var i = 0; i < 16; i++) {
        if (nuSubsets == 1) {
            subsetIndex[i] = 0
        }
        else if (nuSubsets == 2) {
            subsetIndex[i] = bptcTableP2[partitionSetId * 16 + i]
        }
        else {
            subsetIndex[i] = bptcTableP3[partitionSetId * 16 + i]
        }
    }

    var anchorIndex = new Uint8Array(4)
    for (var i = 0; i < nuSubsets; i++) {
        if (i == 0) {
            anchorIndex[i] = 0
        }
        else if (nuSubsets == 2) {
            anchorIndex[i] = bptcTableAnchorIndexSecondSubset[partitionSetId]
        }
        else if (i == 1) {
            anchorIndex[i] = bptcTableAnchorIndexSecondSubsetOfThree[partitionSetId]
        }
        else {
            anchorIndex[i] = bptcTableAnchorIndexThirdSubset[partitionSetId]
        }
    }

    var colorIndex = new Uint8Array(16)
    var alphaIndex = new Uint8Array(16)

    if (index >= 64) { // this implies the mode is not 4.
        const bits1: number = bc7TableInterpalationBits[mode]
        const bits2: number = bits1 - 1
        for (var i = 0; i < 16; i++) {
            if (i === anchorIndex[subsetIndex[i]]) {
                alphaIndex[i] = colorIndex[i] = blockExtractBits(data, index, bits2)
                index += bits2
            }
            else {
                alphaIndex[i] = colorIndex[i] = blockExtractBits(data, index, bits1)
                index += bits1
            }
        }
    }
    else { // Implies mode 4.
        for (var i = 0; i < 16; i++) {
            const bits: number = i === anchorIndex[subsetIndex[i]] ? 1 : 2
            if (indexSelectionBit) {
                alphaIndex[i] = blockExtractBits(data, index, bits)
            }
            else {
                colorIndex[i] = blockExtractBits(data, index, bits)
            }
            index += bits
        }
    }

    if (bc7TableInterpalationBits2[mode] > 0) {
        const bits1: number = bc7TableInterpalationBits2[mode]
        const bits2: number = bits1 - 1
        for (var i = 0; i < 16; i++) {
            if (i === anchorIndex[subsetIndex[i]]) {
                if (indexSelectionBit) {
                    colorIndex[i] = blockExtractBits(data, index, 2)
                    index += 2
                }
                else {
                    alphaIndex[i] = blockExtractBits(data, index, bits2)
                    index += bits2
                }
            }
            else {
                if (indexSelectionBit) {
                    colorIndex[i] = blockExtractBits(data, index, 3)
                    index += 3
                }
                else {
                    alphaIndex[i] = blockExtractBits(data, index, bits1)
                    index += bits1
                }
            }
        }
    }

    var endpointStart = new Uint8Array(4)
    var endpointEnd = new Uint8Array(4)

    const blockSizeInPixels: number = size.blockWidth * size.blockHeight
    var outputBuffer = Buffer.alloc(blockSizeInPixels * rgbaPixelSize)
    for (var i = 0; i < blockSizeInPixels; i++) {
        for (var j = 0; j < 4; j++) {
            endpointStart[j] = endpoint[2 * subsetIndex[i] * 4 + j]
            endpointEnd[j] = endpoint[(2 * subsetIndex[i] + 1) * 4 + j]
        }

        if (rotation > 0) {
            if (rotation == 1) {
                outputBuffer[i * rgbaPixelSize]  = interpolate(endpointStart[3], endpointEnd[3], alphaIndex[i], alphaIndexBitcount) 
                outputBuffer[i * rgbaPixelSize + 1] = interpolate(endpointStart[1], endpointEnd[1], colorIndex[i], colorIndexBitcount)
                outputBuffer[i * rgbaPixelSize + 2] = interpolate(endpointStart[2], endpointEnd[2], colorIndex[i], colorIndexBitcount)
                outputBuffer[i * rgbaPixelSize + 3] = interpolate(endpointStart[0], endpointEnd[0], colorIndex[i], colorIndexBitcount)
            }
            else if (rotation == 2) {
                outputBuffer[i * rgbaPixelSize]  = interpolate(endpointStart[0], endpointEnd[0], colorIndex[i], colorIndexBitcount)
                outputBuffer[i * rgbaPixelSize + 1] = interpolate(endpointStart[3], endpointEnd[3], alphaIndex[i], alphaIndexBitcount)
                outputBuffer[i * rgbaPixelSize + 2] = interpolate(endpointStart[2], endpointEnd[2], colorIndex[i], colorIndexBitcount)
                outputBuffer[i * rgbaPixelSize + 3] = interpolate(endpointStart[1], endpointEnd[1], colorIndex[i], colorIndexBitcount)
            }
            else {
                outputBuffer[i * rgbaPixelSize]  = interpolate(endpointStart[0], endpointEnd[0], colorIndex[i], colorIndexBitcount)
                outputBuffer[i * rgbaPixelSize + 1] = interpolate(endpointStart[1], endpointEnd[1], colorIndex[i], colorIndexBitcount)
                outputBuffer[i * rgbaPixelSize + 2] = interpolate(endpointStart[3], endpointEnd[3], alphaIndex[i], alphaIndexBitcount)
                outputBuffer[i * rgbaPixelSize + 3] = interpolate(endpointStart[2], endpointEnd[2], colorIndex[i], colorIndexBitcount)
            }
        }
        else {
            outputBuffer[i * rgbaPixelSize]  = interpolate(endpointStart[0], endpointEnd[0], colorIndex[i], colorIndexBitcount)
            outputBuffer[i * rgbaPixelSize + 1] = interpolate(endpointStart[1], endpointEnd[1], colorIndex[i], colorIndexBitcount)
            outputBuffer[i * rgbaPixelSize + 2] = interpolate(endpointStart[2], endpointEnd[2], colorIndex[i], colorIndexBitcount)
            outputBuffer[i * rgbaPixelSize + 3] = interpolate(endpointStart[3], endpointEnd[3], alphaIndex[i], alphaIndexBitcount)
        }
    }

    return outputBuffer
}