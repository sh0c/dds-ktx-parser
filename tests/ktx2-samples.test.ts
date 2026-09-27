// KTX 2 files written by Khronos's own tools, from KTX-Software's test
// resources — checked when they are to hand, and skipped when not. They are
// not in this repository: they are KTX-Software's, and large.
//
// To run it, fetch them into a folder and point KTX2_SAMPLES at it:
//
//   base=https://media.githubusercontent.com/media/KhronosGroup/KTX-Software/main/tests/resources
//   for f in color_grid_zstd_5 pattern_02_bc2 bc3_unorm_array_7 r8g8b8a8_srgb_array_7_mip \
//            skybox_zstd_22 Desk_small_zstd_15 cubemap_yokohama_blze; do
//     curl -fLo $f.ktx2 $base/ktx2/$f.ktx2
//   done
//   curl -fLo color_grid.png $base/input/png/color_grid.png
//   curl -fLo pattern_02_bc2.ktx $base/ktx/pattern_02_bc2.ktx
//   KTX2_SAMPLES=$PWD npm test
import * as fs from 'fs'
import * as path from 'path'
import { PNG } from './vendor/pngjs/lib/png'
import { decodeImage, decodeImageFloat, describeKTX2, findLayer, inMemory, parseKTXHeader, readImageInfo, readLayer } from '../src'

const dir = process.env.KTX2_SAMPLES
const when = dir && fs.existsSync(dir) ? describe : describe.skip
const load = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(dir ?? '', name)))

async function level(file: Uint8Array, levelIndex = 0, face = 0, element = 0) {
    const info = (await readImageInfo(inMemory(file), file.length))!
    const layer = findLayer(info, levelIndex, face, element)!
    return { info, layer, bytes: await readLayer(inMemory(file), layer) }
}

when("KTX-Software's own files", () => {
    test('lossless RGBA8 with Zstandard is its source picture, byte for byte', async () => {
        const { info, layer, bytes } = await level(load('color_grid_zstd_5.ktx2'))
        expect([info.format, info.srgb, info.supercompression]).toEqual(['RGBA8', true, 'zstd'])
        const png = PNG.sync.read(fs.readFileSync(path.join(dir!, 'color_grid.png')))
        expect(Buffer.compare(decodeImage(bytes, info.format, { ...layer, offset: 0 }), png.data)).toBe(0)
    })

    test('BC2 as KTX 2 is the same as the KTX 1 of it, all eleven levels', async () => {
        const one = load('pattern_02_bc2.ktx')
        const first = parseKTXHeader(one)!
        const two = load('pattern_02_bc2.ktx2')
        for (let l = 0; l < 11; l++) {
            const { info, layer, bytes } = await level(two, l)
            const a = decodeImage(bytes, info.format, { ...layer, offset: 0 })
            expect(Buffer.compare(a, decodeImage(one, first.format, findLayer(first, l)!))).toBe(0)
        }
    })

    test('a BC3 array of seven and an sRGB RGBA8 array with its levels', async () => {
        const bc3 = await level(load('bc3_unorm_array_7.ktx2'), 0, 0, 6)
        expect([bc3.info.format, bc3.info.arraySize]).toEqual(['BC3', 7])
        expect(decodeImage(bc3.bytes, 'BC3', { ...bc3.layer, offset: 0 }).length).toBe(256 * 256 * 4)
        const rgba = await level(load('r8g8b8a8_srgb_array_7_mip.ktx2'), 4, 0, 6)
        expect([rgba.info.levels, rgba.info.arraySize, rgba.layer.shape.width]).toEqual([5, 7, 1])
    })

    test('HDR: RGB16F and a B10G11R11 cube map, finite and past 1.0', async () => {
        // RGB16F is signed, and this photograph has some values below zero —
        // 2.6% of them, down to -15 — as processed HDR often does. The packed
        // floats of B10G11R11 have no sign, so none of its may be.
        for (const [name, format, face, unsigned] of [
            ['Desk_small_zstd_15.ktx2', 'RGB16F', 0, false],
            ['skybox_zstd_22.ktx2', 'RG11B10F', 5, true],
        ] as const) {
            const { info, layer, bytes } = await level(load(name), 0, face)
            expect(info.format).toBe(format)
            const values = decodeImageFloat(bytes, info.format, { ...layer, offset: 0 })
            expect(values.every((v) => Number.isFinite(v))).toBe(true)
            if (unsigned) expect(values.every((v) => v >= 0)).toBe(true)
            let brightest = 0
            for (let i = 0; i < values.length; i++) if (i % 4 !== 3) brightest = Math.max(brightest, values[i])
            expect(brightest).toBeGreaterThan(1)
        }
    })

    test('an ETC1S cube map, BasisLZ, every face read by range', async () => {
        const basis = load('cubemap_yokohama_blze.ktx2')
        expect(describeKTX2(basis)).toMatchObject({ vkFormat: 0, supercompression: 'basislz', colorModel: 163 })
        const info = (await readImageInfo(inMemory(basis), basis.length))!
        expect([info.format, info.faces, info.supercompression]).toEqual(['ETC1S_RGB', 6, 'basislz'])
        for (let face = 0; face < 6; face++) {
            const { layer, bytes } = await level(basis, 0, face)
            const decoded = decodeImage(bytes, info.format, { ...layer, offset: 0 })
            expect(decoded.length).toBe(layer.shape.width * layer.shape.height * 4)
            // A photograph: not one colour.
            expect(new Set(Array.from({ length: 64 }, (_, i) => decoded[i * 997 * 4])).size).toBeGreaterThan(4)
        }
    })
})
