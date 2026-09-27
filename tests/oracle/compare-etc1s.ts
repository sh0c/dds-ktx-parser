// Compare this package's ETC1S decoder with KTX-Software's. See README.md.
//
//   KTX="path/to/ktx" npx ts-node tests/oracle/compare-etc1s.ts
//   KTX="wsl -d Ubuntu-22.04 -- /path/to/ktx" npx ts-node tests/oracle/compare-etc1s.ts
//
// `ktx create --encode basis-lz` encodes generated test images — colour and
// alpha, opaque, grey, grey and alpha, smooth — linear and sRGB, at low,
// middle and high quality, with mipmaps, in sizes that are not a multiple
// of four, as arrays and as cube maps; `ktx transcode --target rgba8`
// decodes each; and every value of every image is compared with this
// package's, which reads each image by range the way an application would.
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PNG } from '../vendor/pngjs/lib/png'
import { decodeImage, inMemory, parseKTX2Header, readImageInfo, readLayer } from '../../src'

const [tool, ...prefix] = (process.env.KTX ?? 'ktx').split(' ')
const toolPath = (p: string): string =>
    tool === 'wsl' ? p.replace(/^([A-Za-z]):/, (_, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/') : p
const ktx = (...args: string[]) =>
    execFileSync(tool!, [...prefix, ...args.map((a) => (a.includes(path.sep) || /^[A-Za-z]:/.test(a) ? toolPath(a) : a))], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })

function random(seed: number): () => number {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return (t ^ (t >>> 14)) >>> 0
    }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etc1s-'))

type Kind = 'rgba' | 'opaque' | 'grey' | 'grey-alpha' | 'smooth'
// A generated image, as an 8-bit PNG of as many channels as @kind has.
function image(kind: Kind, width: number, height: number, seed: number): string {
    const next = random(seed * 31 + kind.length)
    const channels = kind === 'grey' ? 1 : kind === 'grey-alpha' ? 2 : kind === 'rgba' ? 4 : 3
    const data = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const region = (x >> 4) + 4 * (y >> 4) + seed
            let px: number[]
            if (kind === 'smooth') px = [x * 4, y * 4, 255 - (x + y) * 2, 255 - x]
            else if (region % 3 === 0) px = [x * 4, y * 4, 255 - x * 2, 255 - y * 3]
            else if (region % 3 === 1) px = [next() & 255, next() & 255, next() & 255, next() & 255]
            else px = [(x ^ y) & 8 ? 230 : 25, 120, (x * y) & 255, x < 32 ? 255 : 60]
            data.set(px.map((v) => v & 255), (y * width + x) * 4)
        }
    const file = path.join(dir, `${kind}-${width}x${height}-${seed}.png`)
    const colorType = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6
    // The vendored pngjs's types leave out its options, which it takes.
    const write = PNG.sync.write as unknown as (png: object, options: object) => Buffer
    fs.writeFileSync(file, write({ width, height, data }, { colorType, inputColorType: 6, inputHasAlpha: true }))
    return file
}

const FORMAT: Record<Kind, [string, string]> = {
    rgba: ['R8G8B8A8_UNORM', 'R8G8B8A8_SRGB'],
    opaque: ['R8G8B8_UNORM', 'R8G8B8_SRGB'],
    grey: ['R8_UNORM', 'R8_SRGB'],
    'grey-alpha': ['R8G8_UNORM', 'R8G8_SRGB'],
    smooth: ['R8G8B8A8_UNORM', 'R8G8B8A8_SRGB'],
}

async function compare(label: string, encoded: string): Promise<number> {
    const rgba = encoded.replace(/\.ktx2$/, '.rgba.ktx2')
    ktx('transcode', '--target', 'rgba8', encoded, rgba)
    const theirsFile = new Uint8Array(fs.readFileSync(rgba))
    const theirs = parseKTX2Header(theirsFile)!
    const file = new Uint8Array(fs.readFileSync(encoded))
    const read = inMemory(file)
    const info = (await readImageInfo(read, file.length))!
    if (!info) throw new Error(`${label}: not read`)
    if (info.layers.length !== theirs.layers.length) throw new Error(`${label}: ${info.layers.length} images, ktx has ${theirs.layers.length}`)
    let wrong = 0
    let values = 0
    for (let i = 0; i < info.layers.length; i++) {
        const layer = info.layers[i]!
        const packed = await readLayer(read, layer)
        const ours = decodeImage(packed, info.format, { ...layer, offset: 0 })
        const other = theirs.layers.find((l) => l.level === layer.level && l.face === layer.face && l.arrayIndex === layer.arrayIndex)!
        const t = decodeImage(theirsFile, theirs.format, other)
        // ktx gives a grey file back in the channels it was made from — grey
        // in red, and alpha in green — where this package gives grey in red,
        // green and blue, and alpha as alpha.
        const expected = new Uint8Array(t.length)
        for (let p = 0; p < t.length; p += 4) {
            if (info.channels === 'L') expected.set([t[p]!, t[p]!, t[p]!, 255], p)
            else if (info.channels === 'LA') expected.set([t[p]!, t[p]!, t[p]!, t[p + 1]!], p)
            else expected.set(t.subarray(p, p + 4), p)
        }
        values += t.length
        for (let v = 0; v < t.length; v++)
            if (ours[v] !== expected[v] && wrong++ < 3)
                console.log(`  ${label} level ${layer.level} face ${layer.face} element ${layer.arrayIndex} texel ${v >> 2} channel ${v & 3}: ours ${ours[v]} theirs ${expected[v]}`)
    }
    console.log(
        `${label.padEnd(44)} ${info.format.padEnd(10)} ${info.channels.padEnd(4)} ${info.layers.length} images, ${values} values: ${wrong === 0 ? 'identical' : `${wrong} DIFFERENT`}`,
    )
    return wrong
}

async function main(): Promise<void> {
    let failures = 0
    let n = 0
    const encode = async (label: string, kind: Kind, srgb: boolean, inputs: string[], options: string[]) => {
        const out = path.join(dir, `${n++}.ktx2`)
        ktx(
            'create',
            '--format', FORMAT[kind][srgb ? 1 : 0],
            ...(srgb ? [] : ['--assign-tf', 'linear']),
            '--encode', 'basis-lz',
            ...options,
            ...inputs, out,
        )
        failures += await compare(label, out)
    }

    for (const kind of ['rgba', 'opaque', 'grey', 'grey-alpha', 'smooth'] as Kind[])
        for (const srgb of [false, true])
            for (const qlevel of ['1', '128', '255'])
                await encode(`${kind} ${srgb ? 'sRGB' : 'linear'} qlevel ${qlevel}`, kind, srgb, [image(kind, 64, 64, 1)], ['--qlevel', qlevel])

    // Mipmaps, down to 1 × 1, from a size that is not a multiple of four.
    for (const kind of ['rgba', 'opaque'] as Kind[])
        await encode(`${kind} 61 × 37, mipmaps`, kind, false, [image(kind, 61, 37, 2)], ['--generate-mipmap', '--clevel', '2'])
    // An array and a cube map: images that share the palettes.
    await encode('rgba array of 3, mipmaps', 'rgba', false, [1, 2, 3].map((s) => image('rgba', 32, 32, s)), ['--layers', '3', '--generate-mipmap'])
    await encode('opaque cube map', 'opaque', true, [1, 2, 3, 4, 5, 6].map((s) => image('opaque', 32, 32, s + 10)), ['--cubemap'])
    // Many endpoints and selectors, for long palettes and deltas.
    await encode('rgba 256 × 256, max endpoints and selectors', 'rgba', false, [image('rgba', 256, 256, 7)], ['--max-endpoints', '16128', '--max-selectors', '16128'])
    // Few, for runs and repeats.
    await encode('opaque 128 × 128, 16 endpoints and selectors', 'opaque', false, [image('opaque', 128, 128, 8)], ['--max-endpoints', '16', '--max-selectors', '16'])

    fs.rmSync(dir, { recursive: true })
    process.exit(failures ? 1 : 0)
}
void main()
