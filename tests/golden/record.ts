// Records what every level of every fixture decodes to, as a SHA-256 of the
// RGBA bytes, and how close level 0 is to the picture the fixtures were made
// from. tests/golden.test.ts holds the decoders to what it wrote; run it
// again only for a change meant to alter what a fixture decodes to:
// `npx ts-node tests/golden/record.ts`.
import * as fs from 'fs'
import * as crypto from 'crypto'
import { PNG } from '../vendor/pngjs/lib/png'
import { parseDDSHeader, parseKTXHeader, decodeImage } from '../../src'

const logo = PNG.sync.read(fs.readFileSync('tests/resources/logo.png'))
const out: Record<string, { levels: string[]; psnr: number[] }> = {}
for (const kind of ['dds', 'ktx']) {
  for (const file of fs.readdirSync(`tests/resources/${kind}`).sort()) {
    const bytes = fs.readFileSync(`tests/resources/${kind}/${file}`)
    const info = kind === 'dds' ? parseDDSHeader(bytes) : parseKTXHeader(bytes)
    if (!info) throw new Error(`${file}: no info`)
    const levels = info.layers.map((layer) =>
      crypto.createHash('sha256').update(decodeImage(bytes, info.format, layer)).digest('hex'),
    )
    const zero = decodeImage(bytes, info.format, info.layers[0]!)
    const psnr = [0, 1, 2, 3].map((c) => {
      let sum = 0
      for (let i = 0; i < 512 * 512; i++) {
        const d = zero[i * 4 + c]! - logo.data[i * 4 + c]!
        sum += d * d
      }
      const mse = sum / (512 * 512)
      return mse === 0 ? Infinity : Math.round(10 * Math.log10((255 * 255) / mse) * 10) / 10
    })
    out[`${kind}/${file}`] = { levels, psnr }
  }
}
fs.writeFileSync('tests/golden/decoded.json', JSON.stringify(out, null, 2) + '\n')
for (const [name, { psnr }] of Object.entries(out)) console.log(name.padEnd(14), 'PSNR r g b a', psnr.join('  '))
