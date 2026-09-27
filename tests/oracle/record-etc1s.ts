// Record the ETC1S fixtures and what KTX-Software decodes them to. See
// README.md.
//
//   KTX="path/to/ktx" npx ts-node tests/oracle/record-etc1s.ts
//
// Encodes small generated images with `ktx create --encode basis-lz` into
// tests/resources/etc1s/, decodes each with `ktx transcode --target rgba8`,
// and writes tests/golden/etc1s.json: for every image of each file, the
// digest of that decoding — grey moved into red, green and blue, and alpha
// into alpha, as this package gives them — which tests/etc1s.test.ts holds
// this package's decoding to.
import { execFileSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PNG } from '../vendor/pngjs/lib/png'
import { decodeImage, parseKTX2Header } from '../../src'

const [tool, ...prefix] = (process.env.KTX ?? 'ktx').split(' ')
const toolPath = (p: string): string =>
    tool === 'wsl' ? p.replace(/^([A-Za-z]):/, (_, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/') : p
const ktx = (...args: string[]) =>
    execFileSync(tool!, [...prefix, ...args.map((a) => (a.includes(path.sep) || /^[A-Za-z]:/.test(a) ? toolPath(path.resolve(a)) : a))], { stdio: ['ignore', 'pipe', 'pipe'] })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etc1s-rec-'))
function image(channels: number, width: number, height: number, seed: number): string {
    let s = seed
    const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) & 255
    const data = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const r = (x >> 3) + 4 * (y >> 3) + seed
            const px = r % 3 === 0 ? [x * 8, y * 8, 255 - x * 4, 255 - y * 6] : r % 3 === 1 ? [next(), next(), next(), next()] : [(x ^ y) & 4 ? 230 : 25, 120, (x * y) & 255, x < 16 ? 255 : 60]
            data.set(px.map((v) => v & 255), (y * width + x) * 4)
        }
    const file = path.join(dir, `${channels}-${seed}.png`)
    const colorType = [0, 0, 4, 2, 6][channels]
    const write = PNG.sync.write as unknown as (png: object, options: object) => Buffer
    fs.writeFileSync(file, write({ width, height, data }, { colorType, inputColorType: 6, inputHasAlpha: true }))
    return file
}

// name, input channels, format, options
const FIXTURES: Array<[string, number, string, string[]]> = [
    ['rgba-linear-mipmaps', 4, 'R8G8B8A8_UNORM', ['--assign-tf', 'linear', '--generate-mipmap', '--qlevel', '128']],
    ['rgb-srgb', 3, 'R8G8B8_SRGB', ['--qlevel', '255']],
    ['grey-alpha-linear', 2, 'R8G8_UNORM', ['--assign-tf', 'linear', '--qlevel', '64']],
    ['grey-srgb', 1, 'R8_SRGB', ['--max-endpoints', '16', '--max-selectors', '16']],
]
const out: Record<string, string[]> = {}
fs.mkdirSync('tests/resources/etc1s', { recursive: true })
FIXTURES.forEach(([name, channels, format, options], i) => {
    const fixture = path.join('tests/resources/etc1s', `${name}.ktx2`)
    ktx('create', '--format', format, '--encode', 'basis-lz', ...options, image(channels, 37, 29, i + 1), fixture)
    const decoded = path.join(dir, `${name}.rgba.ktx2`)
    ktx('transcode', '--target', 'rgba8', fixture, decoded)
    const bytes = new Uint8Array(fs.readFileSync(decoded))
    const info = parseKTX2Header(bytes)!
    out[`${name}.ktx2`] = info.layers.map((layer) => {
        const t = decodeImage(bytes, info.format, layer)
        for (let p = 0; p < t.length; p += 4) {
            if (channels === 1) t.set([t[p]!, t[p]!, t[p]!, 255], p)
            else if (channels === 2) t.set([t[p]!, t[p]!, t[p]!, t[p + 1]!], p)
        }
        return crypto.createHash('sha256').update(t).digest('hex')
    })
    console.log(name, fs.statSync(fixture).size, 'bytes,', info.layers.length, 'images')
})
fs.writeFileSync('tests/golden/etc1s.json', JSON.stringify(out, null, 2) + '\n')
fs.rmSync(dir, { recursive: true })
