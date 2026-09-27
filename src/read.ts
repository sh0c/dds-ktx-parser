import { ImageInfo, LayerInfo, ParseOptions } from './header-info'
import { DDS_HEADER_BYTES, parseDDSHeader } from './parse-dds'
import { detectContainer, walkKTX } from './parse-ktx'
import { ktx2IndexBytes, parseKTX2Header } from './parse-ktx2'
import { parseASTCHeader } from './parse-astc'
import { decompress } from './decompress'
import { u32 } from './bytes'
import { packETC1S } from './decode/etc1s'

// Reads @length bytes of a file from @offset: a fetch with a Range header,
// a file handle's read, a slice of a buffer.
export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>

// A ReadRange over a file already in memory.
export function inMemory(bytes: Uint8Array): ReadRange {
    return async (offset, length) => bytes.subarray(offset, offset + length)
}

// Parse a DDS, KTX 1 or KTX 2 file by reading only what its header needs,
// not the file: one read for a DDS; for a KTX 1, the header and four bytes
// a level; for a KTX 2, the header and its level index, in one read or two.
//
// Answers undefined for what it cannot read — detectContainer and
// describeKTX2 say what it is.
export async function readImageInfo(
    read: ReadRange,
    fileSize: number,
    options?: ParseOptions,
): Promise<ImageInfo | undefined> {
    const want = Math.min(fileSize, DDS_HEADER_BYTES)
    if (want < 4) return undefined
    const head = await read(0, want)
    if (head.length < want) return undefined

    switch (detectContainer(head)) {
        case 'dds':
            return parseDDSHeader(head, fileSize, options)
        case 'astc':
            return parseASTCHeader(head, fileSize, options)
        case 'ktx': {
            const walk = walkKTX(head, fileSize, options)
            let step = walk.next()
            while (!step.done) {
                const word = await read(step.value, 4)
                step = walk.next(word.length === 4 ? u32(word, 0) : NaN)
            }
            return step.value
        }
        case 'ktx2': {
            if (head.length < 80) return undefined
            const index = Math.min(ktx2IndexBytes(head), fileSize)
            const bytes = index <= head.length ? head : await read(0, index)
            return bytes.length < index ? undefined : parseKTX2Header(bytes, fileSize, options)
        }
    }
    return undefined
}

// Read one image of the file, and nothing else — decompressing its level
// first if it is supercompressed — ready for
// `decodeImage(bytes, info.format, { ...layer, offset: 0 })`.
export async function readLayer(read: ReadRange, layer: LayerInfo): Promise<Uint8Array> {
    if (!layer.source) {
        const bytes = await read(layer.offset, layer.length)
        if (bytes.length !== layer.length) throw new RangeError('the file ended before the image did')
        return bytes
    }
    const { source } = layer
    if (source.scheme === 'basislz') return readETC1S(read, source)
    const stored = await read(source.offset, source.length)
    if (stored.length !== source.length) throw new RangeError('the file ended before the level did')
    const level = decompress(source.scheme, stored, source.uncompressedLength)
    return level.subarray(layer.offset, layer.offset + layer.length)
}

type BasisSource = Extract<NonNullable<LayerInfo['source']>, { scheme: 'basislz' }>

// An ETC1S image: the supercompression global data — a 20-byte header, 20
// bytes on each image, then the palettes and tables every image shares —
// and the image's colour and alpha slices, where its entry says, within its
// level. The palettes are read with the index; the slices, which are next
// to each other, in one read.
async function readETC1S(read: ReadRange, source: BasisSource): Promise<Uint8Array> {
    const global = await read(source.offset, source.length)
    if (global.length !== source.length || global.length < 20 + source.imageCount * 20)
        throw new RangeError('the file ended before its BasisLZ global data did')
    const view = new DataView(global.buffer, global.byteOffset, global.byteLength)
    const codebooksAt = 20 + source.imageCount * 20
    const codebooksLength = view.getUint32(4, true) + view.getUint32(8, true) + view.getUint32(12, true)
    if (codebooksAt + codebooksLength > global.length) throw new RangeError('the BasisLZ palettes run past their data')
    const entry = 20 + source.image * 20
    const flags = view.getUint32(entry, true)
    if (flags & 2) throw new Error('a BasisLZ video frame, which needs the frame before it; this reads still images')
    const colourAt = view.getUint32(entry + 4, true)
    const colourLength = view.getUint32(entry + 8, true)
    const alphaAt = view.getUint32(entry + 12, true)
    const alphaLength = view.getUint32(entry + 16, true)
    const from = alphaLength ? Math.min(colourAt, alphaAt) : colourAt
    const to = alphaLength ? Math.max(colourAt + colourLength, alphaAt + alphaLength) : colourAt + colourLength
    if (to > source.level.length) throw new RangeError('a BasisLZ image runs past its level')
    const slices = await read(source.level.offset + from, to - from)
    if (slices.length !== to - from) throw new RangeError('the file ended before the image did')
    return packETC1S(
        global,
        global.subarray(codebooksAt, codebooksAt + codebooksLength),
        slices.subarray(colourAt - from, colourAt - from + colourLength),
        slices.subarray(alphaAt - from, alphaAt - from + alphaLength),
    )
}
