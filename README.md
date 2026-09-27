# dds-ktx-parser

[![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

Parse DDS, KTX 1 and KTX 2 textures and decode them to RGBA. No
dependencies, and nothing from Node: it runs the same in Node, a browser page
and a Web Worker. The code it needs for KTX 2's supercompression — fzstd for
Zstandard, tiny-inflate for zlib — is in the package, not a dependency (see
`THIRD-PARTY-NOTICES.md`).

It can read **only the bytes it needs**. A texture's header says where every
mip level is, so a viewer can read the header, pick the level it will draw,
and read that level and nothing else — for a 4096² texture shown at 1024²,
a sixteenth of the file.

## Reading the header

```ts
interface ImageInfo {
    readonly container: 'dds' | 'ktx' | 'ktx2'
    readonly shape: ImageShape // width and height
    readonly format: ImageFormat // 'BC7', 'RGBA8', 'R16F', ...
    readonly srgb: boolean // sRGB-encoded rather than linear
    readonly channels: Channels // 'R', 'RG', 'RGB', 'RGBA', 'L' or 'A'
    readonly levels: number
    readonly faces: number // 6 for a cube map
    readonly arraySize: number
    readonly depth: number // slices, for a volume texture
    readonly supercompression: 'none' | 'zstd' | 'zlib' // KTX 2 only
    readonly layers: Array<LayerInfo> // every image in the file: offset, length,
                                      // shape, level, face, arrayIndex, depth
}
```

From a file in memory:

```ts
import { parseDDSHeader, parseKTXHeader } from 'dds-ktx-parser'

const info = parseDDSHeader(bytes) // or parseKTXHeader, or parseKTX2Header
```

From a file read by range — `read` is anything that answers bytes for an
offset and a length: a `fetch` with a `Range` header, a file handle:

```ts
import { readImageInfo, readLayer, decodeImage, findLayer } from 'dds-ktx-parser'

const info = await readImageInfo(read, fileSize)
// DDS: one read, of the header. KTX: the header, and four bytes a level.
// KTX 2: the header and its level index.
const layer = findLayer(info, 2)! // level 2 of face 0 of element 0
const bytes = await readLayer(read, layer) // decompressed if it needs to be
const rgba = decodeImage(bytes, info.format, { ...layer, offset: 0 })
```

A KTX 2 level that is supercompressed is stored, and read, whole: each level
is compressed on its own, so `readLayer` reads that one level's stored bytes
and decompresses them. It does so each time it is called; to show several
faces of one compressed level, keep what it answered. `inMemory(bytes)`
makes a `read` over a file already in memory.

`parseDDSHeader` also works from just the header, given the file's size:
`parseDDSHeader(first148Bytes, fileSize)`.

Anything the parser cannot read, or whose numbers cannot be right — a size
past the limit (16384 by default; `{ maxDimension }` to change it), more
mip levels than halving allows, an image past the end of the file, a KTX
level whose size does not add up — answers `undefined`. `detectContainer`
says what kind of file it is, and `describeKTX2` what a KTX 2 file holds
that is not read: Basis Universal (ETC1S or UASTC, which need a transcoder
this package does not have), ETC, ASTC and other formats with no decoder
here.

## Decoding

- `decodeImage(bytes, format, layer, slice?)` — RGBA, a byte a channel.
  HDR values past 1.0 are clamped. Signed formats show -1 as 0 and 1 as 255.
- `decodeImageFloat(bytes, format, layer, slice?)` — RGBA floats: HDR as it
  is, signed formats in [-1, 1].

Channels a format has not got are 0 and alpha is 1, as a GPU samples them;
`channels` says which are real, so an R texture can be shown in grey.

| | formats |
|---|---|
| block compressed | BC1 (DXT1), BC2 (DXT2, DXT3), BC3 (DXT4, DXT5), BC4, BC4_SNORM, BC5, BC5_SNORM, BC6H, BC6H_SF16, BC7 — sRGB variants included |
| 8 bits a channel | RGBA8, RGBX8, BGRA8, BGRX8, RGB8, BGR8, R8, RG8, R8_SNORM, RG8_SNORM, L8, A8 |
| 16 bits a channel | R16, RG16, R16_SNORM, RG16_SNORM, L16 |
| packed | RGB10A2, B5G6R5, B5G5R5A1, B4G4R4A4 |
| float | R16F, RG16F, RGB16F, RGBA16F, R32F, RG32F, RGB32F, RGBA32F, RG11B10F (B10G11R11), RGB9E5 |

DDS with and without the DX10 header, cube maps, arrays and volume textures;
KTX 1, little-endian, with its row padding; KTX 2, stored or supercompressed
with Zstandard or zlib.

BC6H_SF16 has no reference file, so `tests/bc6h-signed.test.ts` checks it
against the BC6H specification's own arithmetic, written out in the test,
on blocks built bit by bit — having first checked the unsigned decoder
agrees on the same blocks.

## Tests

`npm test`. `tests/golden/decoded.json` holds what every level of every
fixture decodes to, and how close level 0 is to `tests/resources/logo.png`,
the picture the fixtures were made from; the tests hold the decoders to it.
`tests/helpers/make.ts` builds small DDS and KTX files byte by byte for the
formats and headers no fixture has. PNGs are read with a copy of
[pngjs](https://github.com/pngjs/pngjs) in `tests/vendor/pngjs` (MIT), used by
the tests only. `tests/ktx2-samples.test.ts` checks files written by
Khronos's own tools when `KTX2_SAMPLES` points at a folder holding them; its
header says how to fetch them.

## 2.0.0

- Reads a texture by range: `readImageInfo`, and `parseDDSHeader` from its
  header alone.
- No Node `Buffer`: takes and returns `Uint8Array`, so it runs in a browser.
  `decodeImage` returns a `Uint8Array`.
- KTX 2, stored or supercompressed, with `readLayer` to read one image.
- Uncompressed formats, signed BC4 and BC5, BC6H as floats
  (`decodeImageFloat`) and signed BC6H checked against the specification,
  HDR packed formats, sRGB, channels, cube maps, arrays and volume textures.
- Fixed: BC2's alpha had its top and bottom halves swapped. BC6H values past
  1.0 wrapped round to dark instead of clamping. An uncompressed DDS was
  reported as BC1. Cube maps were never found (the flags were read from the
  wrong field). A DDS with a mip count of 0 had no images. KTX's signed RGTC
  was read as unsigned, and its sRGB compressed formats not at all.
  Unaligned input threw. Every subnormal half float decoded wrong — 0x0001
  as 2^-20, not 2^-24 — in BC6H and the half-float formats.
- Headers are checked before anything is allocated for them.
- BC6H decodes about eleven times faster.
