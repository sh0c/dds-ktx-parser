import { ImageInfo, LayerInfo, ParseOptions } from './header-info'
import { DDS_HEADER_BYTES, parseDDSHeader } from './parse-dds'
import { detectContainer, walkKTX } from './parse-ktx'
import { ktx2IndexBytes, parseKTX2Header } from './parse-ktx2'
import { decompress } from './decompress'
import { u32 } from './bytes'

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
    const stored = await read(source.offset, source.length)
    if (stored.length !== source.length) throw new RangeError('the file ended before the level did')
    const level = decompress(source.scheme, stored, source.uncompressedLength)
    return level.subarray(layer.offset, layer.offset + layer.length)
}
