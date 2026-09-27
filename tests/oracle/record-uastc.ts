// Record the UASTC fixtures and what KTX-Software decodes them to. See
// README.md.
//
//   KTX="path/to/ktx" npx ts-node tests/oracle/record-uastc.ts
//
// Encodes generated 32 × 32 images with `ktx create --encode uastc` into
// tests/resources/uastc/, decodes each with `ktx transcode --target rgba8`,
// and writes tests/golden/uastc.json: the digest of that decoding, which
// tests/uastc.test.ts holds this package's decoding to.
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uastc-rec-'))
const W = 32
const H = 32
function image(alpha: boolean, seed: number): string {
    let s = seed
    const next = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) & 255
    const data = Buffer.alloc(W * H * 4)
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const r = (x >> 3) + 4 * (y >> 3)
            const px = r % 3 === 0 ? [x * 8, y * 8, 255 - x * 4, 255 - y * 6] : r % 3 === 1 ? [next(), next(), next(), next()] : [(x ^ y) & 4 ? 230 : 25, 120, (x * y) & 255, x < 16 ? 255 : 60]
            if (!alpha) px[3] = 255
            data.set(px, (y * W + x) * 4)
        }
    const file = path.join(dir, `${alpha}-${seed}.png`)
    fs.writeFileSync(file, PNG.sync.write({ width: W, height: H, data }))
    return file
}

const FIXTURES: Array<[string, boolean, boolean, string[]]> = [
    ['rgba-linear', true, false, ['--uastc-quality', '2']],
    ['rgb-srgb', false, true, ['--uastc-quality', '0']],
    ['rgba-rdo', true, false, ['--uastc-quality', '1', '--uastc-rdo']],
]
const out: Record<string, string> = {}
fs.mkdirSync('tests/resources/uastc', { recursive: true })
FIXTURES.forEach(([name, alpha, srgb, options], i) => {
    const fixture = path.join('tests/resources/uastc', `${name}.ktx2`)
    ktx('create', '--format', srgb ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM', '--assign-tf', srgb ? 'srgb' : 'linear', '--encode', 'uastc', ...options, image(alpha, i + 1), fixture)
    const decoded = path.join(dir, `${name}.rgba.ktx2`)
    ktx('transcode', '--target', 'rgba8', fixture, decoded)
    const bytes = new Uint8Array(fs.readFileSync(decoded))
    const info = parseKTX2Header(bytes)!
    out[`${name}.ktx2`] = crypto.createHash('sha256').update(decodeImage(bytes, info.format, info.layers[0]!)).digest('hex')
    console.log(name, fs.statSync(fixture).size, 'bytes')
})
fs.writeFileSync('tests/golden/uastc.json', JSON.stringify(out, null, 2) + '\n')
fs.rmSync(dir, { recursive: true })
