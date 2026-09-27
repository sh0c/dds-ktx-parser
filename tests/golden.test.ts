// Every level of every fixture decodes to what tests/golden/decoded.json
// recorded, and level 0 stays as close to the picture the fixtures were made
// from as it was.
//
// decoded.json was first recorded from the decoders as they were, before
// they were rewritten, and the rewrite was held to it: every level of every
// fixture identical, except two changes, each explained byte by byte —
// BC2's alpha, whose two halves had been swapped (19.9 dB against the
// picture before, 53.2 after), and BC6H's levels 1 to 3, where values up to
// 1.258 had wrapped round to dark and now clamp to 255.
//
// Re-record it with `npx ts-node tests/golden/record.ts`, and only for a
// change meant to alter what a fixture decodes to.
import * as fs from 'fs'
import * as crypto from 'crypto'
import { PNG } from './vendor/pngjs/lib/png'
import { parseDDSHeader, parseKTXHeader, decodeImage } from '../src'

const golden: Record<string, { levels: string[]; psnr: number[] }> = JSON.parse(
    fs.readFileSync('tests/golden/decoded.json', 'utf8'),
)
const logo = PNG.sync.read(fs.readFileSync('tests/resources/logo.png'))

function psnr(a: Uint8Array, b: Uint8Array, channel: number): number {
    let sum = 0
    for (let i = channel; i < a.length; i += 4) sum += (a[i] - b[i]) ** 2
    const mse = sum / (a.length / 4)
    return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse)
}

// The least each format should manage against the picture, a channel at a
// time: what it can carry, and nothing for what it cannot (BC4 has no green).
const floors: Record<string, number[]> = {
    bc1: [30, 30, 30, 0],
    dxt1: [30, 30, 30, 0],
    bc2: [30, 30, 30, 50],
    dxt3: [30, 30, 30, 50],
    bc3: [30, 30, 30, 30],
    dxt5: [30, 30, 30, 30],
    bc4: [28, 0, 0, 0],
    bc5: [28, 28, 0, 0],
    bc6h: [33, 33, 33, 0],
    bc7: [50, 50, 50, 30],
}

for (const [name, expected] of Object.entries(golden)) {
    test(`${name} decodes as recorded`, () => {
        const bytes = fs.readFileSync(`tests/resources/${name}`)
        const info = name.startsWith('dds/') ? parseDDSHeader(bytes) : parseKTXHeader(bytes)
        expect(info).toBeDefined()
        const levels = info!.layers.map((layer) =>
            crypto.createHash('sha256').update(decodeImage(bytes, info!.format, layer)).digest('hex'),
        )
        expect(levels).toEqual(expected.levels)

        const zero = decodeImage(bytes, info!.format, info!.layers[0])
        const floor = floors[name.replace(/^.*\/|\..*$/g, '')]
        floor.forEach((least, channel) => expect(psnr(zero, logo.data, channel)).toBeGreaterThanOrEqual(least))
    })
}
