import { ImageInfo, ParseOptions } from './header-info'
import { DDS_HEADER_BYTES, parseDDSHeader } from './parse-dds'
import { detectContainer, walkKTX } from './parse-ktx'
import { u32 } from './bytes'

// Reads @length bytes of a file from @offset: a fetch with a Range header,
// a file handle's read, a slice of a buffer.
export type ReadRange = (offset: number, length: number) => Promise<Uint8Array>

// Parse a DDS or KTX 1 file by reading only what its header needs, not the
// file: one read for a DDS; for a KTX, one for the header and four bytes for
// each mip level. Then decodeImage can be given just the level wanted —
// read it with `read(layer.offset, layer.length)` and pass
// `{ ...layer, offset: 0 }`.
//
// Answers undefined for what it cannot read, including a KTX 2 file —
// detectContainer tells that apart from a file that is not a texture.
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
    }
    return undefined
}
