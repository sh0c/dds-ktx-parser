export function blockExtractBits(block: Uint32Array, startIdx: number, numBits: number): number {
    const bitsPerElement: number = (Uint32Array.BYTES_PER_ELEMENT * 8)
    var value: number = 0

    for (var i = 0; i < numBits; i++) {
        const moveIdx:number = Math.floor(startIdx / bitsPerElement)
        const moveBits = moveIdx * bitsPerElement
        const shift: number = startIdx - i - moveBits

        if (shift < 0) {
            value |= (block[moveIdx] & (1 << (startIdx - moveBits))) << (-shift)
        }
        else {
            value |= Math.abs((block[moveIdx] & (1 << (startIdx - moveBits))) >> shift)
        }
        startIdx++
    }

    return value
}