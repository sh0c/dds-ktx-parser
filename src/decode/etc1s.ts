// ETC1S, supercompressed with BasisLZ: Basis Universal's small mode.
//
// Ported from Binomial's basis_universal transcoder
// (basisu_lowlevel_etc1s_transcoder: decode_palettes, decode_tables and
// transcode_slice, with the bitwise_decoder, huffman_decoding_table and
// approx_move_to_front they use; transcoder/basisu_transcoder.cpp and
// basisu_transcoder_internal.h, v2_50), Apache License 2.0 — see
// THIRD-PARTY-NOTICES.md. Changed from the original: rewritten in
// TypeScript, decoding only to RGBA, and with a counting Huffman decoder in
// place of its lookup tables, which gives the same canonical codes.
//
// A file carries, once, a palette of endpoints (a 5-bit colour and an
// intensity table), a palette of selectors (a 2-bit index for each of 16
// texels) and four Huffman tables. Each image is then a stream of which
// endpoint and which selector each 4×4 block takes, predicted from its
// neighbours and a history of recent selectors. A block is an ETC1 block with
// one colour and one table: its texels are that colour plus the table's
// offset their selector picks.
//
// Compared with KTX-Software's `ktx transcode --target rgba8` on files its
// `ktx create --encode basis-lz` wrote (see tests/oracle).

class Bits {
    private at = 0
    constructor(private readonly bytes: Uint8Array) {}

    // Bits least significant first, as zeros past the end.
    get(count: number): number {
        let value = 0
        for (let i = 0; i < count; i++, this.at++) {
            const byte = this.bytes[this.at >> 3] ?? 0
            value |= ((byte >> (this.at & 7)) & 1) << i
        }
        return value >>> 0
    }

    bit(): number {
        return this.get(1)
    }

    // A value in chunks of @chunkBits, each followed by a bit saying whether
    // another comes.
    vlc(chunkBits: number): number {
        let value = 0
        let shift = 0
        for (;;) {
            const s = this.get(chunkBits + 1)
            value |= (s & ((1 << chunkBits) - 1)) << shift
            shift += chunkBits
            if ((s & (1 << chunkBits)) === 0 || shift >= 32) break
        }
        return value >>> 0
    }
}

// A canonical Huffman code, from each symbol's code length: codes assigned
// in symbol order, shortest first, and read a bit at a time with the first
// bit the code's most significant — as Deflate's are.
class Huffman {
    private readonly counts: number[]
    private readonly symbols: number[]
    readonly size: number

    constructor(lengths: number[]) {
        this.size = lengths.length
        this.counts = new Array(32).fill(0)
        for (const l of lengths) this.counts[l]++
        this.counts[0] = 0
        const offsets = new Array(33).fill(0)
        for (let l = 1; l < 32; l++) offsets[l + 1] = offsets[l] + this.counts[l]
        this.symbols = new Array(offsets[32])
        lengths.forEach((l, symbol) => {
            if (l) this.symbols[offsets[l]++] = symbol
        })
    }

    get valid(): boolean {
        return this.size > 0
    }

    decode(bits: Bits): number {
        let code = 0
        let first = 0
        let index = 0
        for (let length = 1; length < 32; length++) {
            code |= bits.bit()
            const count = this.counts[length]
            if (code - first < count) return this.symbols[index + (code - first)]
            index += count
            first = (first + count) << 1
            code <<= 1
        }
        throw new Error('ETC1S: a Huffman code that is not in its table')
    }
}

// The order the code-length code's lengths are stored in.
const CODE_LENGTH_ORDER = [17, 18, 19, 20, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15, 16]

// A Huffman table as the stream stores it: its code lengths, themselves
// Huffman coded, with runs of zeros and repeats.
function readTable(bits: Bits): Huffman {
    const used = bits.get(14)
    if (!used) return new Huffman([])
    const codes = bits.get(5)
    if (codes < 1 || codes > 21) throw new Error('ETC1S: a Huffman table that cannot be read')
    const codeLengths = new Array(21).fill(0)
    for (let i = 0; i < codes; i++) codeLengths[CODE_LENGTH_ORDER[i]] = bits.get(3)
    const lengthCode = new Huffman(codeLengths)
    const lengths = new Array(used).fill(0)
    let at = 0
    while (at < used) {
        const c = lengthCode.decode(bits)
        if (c <= 16) lengths[at++] = c
        else if (c === 17) at += bits.get(3) + 3
        else if (c === 18) at += bits.get(7) + 11
        else {
            if (at === 0) throw new Error('ETC1S: a repeat with nothing before it')
            const run = c === 19 ? bits.get(2) + 3 : bits.get(7) + 7
            const previous = lengths[at - 1]
            if (!previous) throw new Error('ETC1S: a repeat of an unused length')
            for (let i = 0; i < run; i++) {
                if (at >= used) throw new Error('ETC1S: a repeat past the table')
                lengths[at++] = previous
            }
        }
    }
    if (at !== used) throw new Error('ETC1S: a table longer than it said')
    return new Huffman(lengths)
}

interface Endpoint {
    r: number
    g: number
    b: number
    inten: number
}

// The shared palettes and tables, decoded once for a file.
export interface ETC1SCodebook {
    endpoints: Endpoint[]
    // Each selector: 4 rows, each 4 two-bit indices, x = 0 in the low bits.
    selectors: Uint8Array[]
    endpointPred: Huffman
    deltaEndpoint: Huffman
    selector: Huffman
    selectorHistoryRle: Huffman
    historySize: number
}

export function decodeCodebook(
    endpointCount: number,
    endpointsData: Uint8Array,
    selectorCount: number,
    selectorsData: Uint8Array,
    tablesData: Uint8Array,
): ETC1SCodebook {
    // Endpoints: each colour channel and intensity a delta from the last.
    let bits = new Bits(endpointsData)
    const colourModels = [readTable(bits), readTable(bits), readTable(bits)]
    const intenModel = readTable(bits)
    if (!colourModels.every((m) => m.valid) || !intenModel.valid) throw new Error('ETC1S: the endpoint palette cannot be read')
    const grey = bits.bit() === 1
    const endpoints: Endpoint[] = []
    const previous = [16, 16, 16]
    let previousInten = 0
    for (let i = 0; i < endpointCount; i++) {
        const inten = (intenModel.decode(bits) + previousInten) & 7
        previousInten = inten
        for (let c = 0; c < (grey ? 1 : 3); c++) {
            const model = previous[c] <= 9 ? colourModels[0] : previous[c] <= 21 ? colourModels[1] : colourModels[2]
            previous[c] = (previous[c] + model.decode(bits)) & 31
        }
        endpoints.push(grey ? { r: previous[0], g: previous[0], b: previous[0], inten } : { r: previous[0], g: previous[1], b: previous[2], inten })
    }

    // Selectors: raw, or each row a Huffman-coded XOR with the last.
    bits = new Bits(selectorsData)
    if (bits.bit() === 1) throw new Error('ETC1S: a global selector codebook, which files do not use any more')
    if (bits.bit() === 1) throw new Error('ETC1S: a hybrid selector codebook, which files do not use any more')
    const raw = bits.bit() === 1
    const selectors: Uint8Array[] = []
    if (raw) {
        for (let i = 0; i < selectorCount; i++) selectors.push(Uint8Array.from([bits.get(8), bits.get(8), bits.get(8), bits.get(8)]))
    } else {
        const model = readTable(bits)
        if (selectorCount > 1 && !model.valid) throw new Error('ETC1S: the selector palette cannot be read')
        const rows = [0, 0, 0, 0]
        for (let i = 0; i < selectorCount; i++) {
            for (let j = 0; j < 4; j++) rows[j] = i === 0 ? bits.get(8) : model.decode(bits) ^ rows[j]
            selectors.push(Uint8Array.from(rows))
        }
    }

    bits = new Bits(tablesData)
    const endpointPred = readTable(bits)
    const deltaEndpoint = readTable(bits)
    const selector = readTable(bits)
    const selectorHistoryRle = readTable(bits)
    const historySize = bits.get(13)
    if (!endpointPred.size || !deltaEndpoint.size || !selector.size || !selectorHistoryRle.size)
        throw new Error('ETC1S: the tables cannot be read')
    return { endpoints, selectors, endpointPred, deltaEndpoint, selector, selectorHistoryRle, historySize }
}

// Basis's "approximate move to front": recent selectors, the one used moved
// half way to the front.
class History {
    private readonly values: number[]
    private rover: number
    constructor(readonly size: number) {
        this.values = new Array(size).fill(0)
        this.rover = size >> 1
    }
    get(i: number): number {
        return this.values[i]
    }
    add(value: number): void {
        this.values[this.rover++] = value
        if (this.rover === this.size) this.rover = this.size >> 1
    }
    use(i: number): void {
        if (i) {
            const x = this.values[i >> 1]
            this.values[i >> 1] = this.values[i]
            this.values[i] = x
        }
    }
}

const INTEN = [
    [-8, -2, 2, 8],
    [-17, -5, 5, 17],
    [-29, -9, 9, 29],
    [-42, -13, 13, 42],
    [-60, -18, 18, 60],
    [-80, -24, 24, 80],
    [-106, -33, 33, 106],
    [-183, -47, 47, 183],
]
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v)
const extend5 = (v: number): number => (v << 3) | (v >> 2)

// Decode one slice — an image's colour, or its alpha — into @out, RGBA rows
// of @width. Colour writes red, green and blue; alpha writes the alpha
// channel from the slice's green, as Basis does.
export function decodeSlice(
    book: ETC1SCodebook,
    data: Uint8Array,
    width: number,
    height: number,
    out: Uint8Array,
    alpha: boolean,
): void {
    const bits = new Bits(data)
    const blocksX = (width + 3) >> 2
    const blocksY = (height + 3) >> 2
    const history = new History(book.historySize)
    const selectorCount = book.selectors.length
    const endpointCount = book.endpoints.length
    const historyRleSymbol = book.historySize + selectorCount
    // Two rows of what the row above chose: its prediction bits and endpoints.
    const predBits = [new Uint8Array(blocksX), new Uint8Array(blocksX)]
    const endpointAbove = [new Uint32Array(blocksX), new Uint32Array(blocksX)]
    let currentPred = 0
    let previousPredSymbol = 0
    let predRepeat = 0
    let previousEndpoint = 0
    let selectorRun = 0
    const colours = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
    ]

    for (let by = 0; by < blocksY; by++) {
        const row = by & 1
        for (let bx = 0; bx < blocksX; bx++) {
            // One prediction symbol for each 2 × 2 group of blocks: two bits a block.
            if ((bx & 1) === 0) {
                if ((by & 1) === 0) {
                    if (predRepeat) {
                        predRepeat--
                        currentPred = previousPredSymbol
                    } else {
                        currentPred = book.endpointPred.decode(bits)
                        if (currentPred === 256) {
                            predRepeat = bits.vlc(4) + 3 - 1
                            currentPred = previousPredSymbol
                        } else previousPredSymbol = currentPred
                    }
                    predBits[row ^ 1][bx] = currentPred >> 4
                } else currentPred = predBits[row][bx]
            }

            let endpoint: number
            const pred = currentPred & 3
            currentPred >>= 2
            if (pred === 0) {
                if (!bx) throw new Error('ETC1S: a block predicted from the left, with nothing to its left')
                endpoint = previousEndpoint
            } else if (pred === 1) {
                if (!by) throw new Error('ETC1S: a block predicted from above, with nothing above')
                endpoint = endpointAbove[row ^ 1][bx]
            } else if (pred === 2) {
                if (!bx || !by) throw new Error('ETC1S: a block predicted from above left, with nothing there')
                endpoint = endpointAbove[row ^ 1][bx - 1]
            } else {
                endpoint = book.deltaEndpoint.decode(bits) + previousEndpoint
                if (endpoint >= endpointCount) endpoint -= endpointCount
            }
            endpointAbove[row][bx] = endpoint
            previousEndpoint = endpoint

            let symbol: number
            if (selectorRun > 0) {
                selectorRun--
                symbol = selectorCount
            } else {
                symbol = book.selector.decode(bits)
                if (symbol === historyRleSymbol) {
                    const run = book.selectorHistoryRle.decode(bits)
                    selectorRun = run === 63 ? bits.vlc(7) + 3 : run + 3
                    if (selectorRun > blocksX * blocksY) throw new Error('ETC1S: a run longer than the image')
                    symbol = selectorCount
                    selectorRun--
                }
            }
            let selector: number
            if (symbol >= selectorCount) {
                const at = symbol - selectorCount
                if (at >= history.size) throw new Error('ETC1S: a selector from past the history')
                selector = history.get(at)
                if (at) history.use(at)
            } else {
                selector = symbol
                if (history.size) history.add(selector)
            }
            if (endpoint >= endpointCount || selector >= selectorCount) throw new Error('ETC1S: an index past its palette')

            const e = book.endpoints[endpoint]
            const table = INTEN[e.inten]
            const base = [extend5(e.r), extend5(e.g), extend5(e.b)]
            for (let s = 0; s < 4; s++) for (let c = 0; c < 3; c++) colours[s][c] = clamp255(base[c] + table[s])
            const rows = book.selectors[selector]
            for (let y = 0; y < 4; y++) {
                const py = by * 4 + y
                if (py >= height) break
                for (let x = 0; x < 4; x++) {
                    const px = bx * 4 + x
                    if (px >= width) break
                    const colour = colours[(rows[y] >> (x * 2)) & 3]
                    const o = (py * width + px) * 4
                    if (alpha) out[o + 3] = colour[1]
                    else {
                        out[o] = colour[0]
                        out[o + 1] = colour[1]
                        out[o + 2] = colour[2]
                    }
                }
            }
        }
    }
}

// An ETC1S image as readLayer hands it over: what decoding it needs from
// the file, gathered from the three places it is in, so that the image
// decodes on its own. Little-endian:
//
//   u32 colour slice length, u32 alpha slice length (0: no alpha),
//   the 20-byte header of the file's supercompression global data — u16
//   endpoint count, u16 selector count, u32 endpoints, selectors, tables and
//   extended byte lengths — then the endpoints, selectors and tables it
//   says, then the colour slice, then the alpha slice.
export const PACKED_HEADER_BYTES = 28

export function packETC1S(globalHeader: Uint8Array, codebooks: Uint8Array, colour: Uint8Array, alpha: Uint8Array): Uint8Array {
    const out = new Uint8Array(PACKED_HEADER_BYTES + codebooks.length + colour.length + alpha.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, colour.length, true)
    view.setUint32(4, alpha.length, true)
    out.set(globalHeader.subarray(0, 20), 8)
    out.set(codebooks, PACKED_HEADER_BYTES)
    out.set(colour, PACKED_HEADER_BYTES + codebooks.length)
    out.set(alpha, PACKED_HEADER_BYTES + codebooks.length + colour.length)
    return out
}

// Decode a packed ETC1S image (packETC1S) to RGBA, a byte a channel. With
// no alpha slice, alpha is 255; with one, it is that slice's green.
export function decodeETC1S(packed: Uint8Array, width: number, height: number): Uint8Array {
    if (packed.length < PACKED_HEADER_BYTES) throw new RangeError('ETC1S: the image is shorter than its header')
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength)
    const colourLength = view.getUint32(0, true)
    const alphaLength = view.getUint32(4, true)
    const endpointCount = view.getUint16(8, true)
    const selectorCount = view.getUint16(10, true)
    const endpointsLength = view.getUint32(12, true)
    const selectorsLength = view.getUint32(16, true)
    const tablesLength = view.getUint32(20, true)
    let at = PACKED_HEADER_BYTES
    const take = (length: number): Uint8Array => {
        if (at + length > packed.length) throw new RangeError('ETC1S: the image is shorter than its header says')
        const part = packed.subarray(at, at + length)
        at += length
        return part
    }
    const endpoints = take(endpointsLength)
    const selectors = take(selectorsLength)
    const tables = take(tablesLength)
    const colour = take(colourLength)
    const alpha = take(alphaLength)
    if (!endpointCount || !selectorCount) throw new Error('ETC1S: an empty palette')
    const book = decodeCodebook(endpointCount, endpoints, selectorCount, selectors, tables)
    const out = new Uint8Array(width * height * 4).fill(255)
    decodeSlice(book, colour, width, height, out, false)
    if (alphaLength) decodeSlice(book, alpha, width, height, out, true)
    return out
}
