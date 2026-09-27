// Compare this package's ETC and EAC decoders with etcdec's, block by block,
// on random blocks — every bit pattern is a valid ETC block, so random ones
// reach every mode, T, H and planar included. See README.md.
//
//   npx ts-node tests/oracle/compare-etc.ts ORACLE [BLOCKS]
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
    decodeEACR11Block,
    decodeEACRG11Block,
    decodeETC2A1Block,
    decodeETC2Block,
    decodeETC2RGBABlock,
} from '../../src/decode/etc'

const oracle = process.argv[2]
const count = Number(process.argv[3] ?? 200000)

// A seeded generator, so a failure can be found again.
function random(seed: number): () => number {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) & 0xff
    }
}

let failures = 0
for (const [mode, size] of [['rgb', 8], ['a1', 8], ['rgba', 16], ['r11', 8], ['rg11', 16]] as const) {
    const next = random(0x5eed + size + mode.length)
    const blocks = new Uint8Array(count * size)
    for (let i = 0; i < blocks.length; i++) blocks[i] = next()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etc-'))
    fs.writeFileSync(path.join(dir, 'in'), blocks)
    execFileSync(oracle, [mode, path.join(dir, 'in'), path.join(dir, 'out')])
    const expected = new Uint8Array(fs.readFileSync(path.join(dir, 'out')))
    fs.rmSync(dir, { recursive: true })

    let wrong = 0
    for (let b = 0; b < count; b++) {
        const block = blocks.subarray(b * size, (b + 1) * size)
        for (let p = 0; p < 16 && wrong < 5; p++) {
            let ours: number[]
            let theirs: number[]
            if (mode === 'r11' || mode === 'rg11') {
                const f = mode === 'r11' ? decodeEACR11Block(block, false) : decodeEACRG11Block(block, false)
                const channels = mode === 'r11' ? 1 : 2
                ours = Array.from({ length: channels }, (_, c) => Math.round(f[p * 4 + c] * 2047))
                theirs = Array.from({ length: channels }, (_, c) => {
                    const at = (p * channels + c) * 2
                    return (expected[b * 16 * channels * 2 + at] | (expected[b * 16 * channels * 2 + at + 1] << 8)) >> 5
                })
            } else {
                const px = mode === 'rgb' ? decodeETC2Block(block) : mode === 'a1' ? decodeETC2A1Block(block) : decodeETC2RGBABlock(block)
                ours = Array.from(px.subarray(p * 4, p * 4 + 4))
                theirs = Array.from(expected.subarray(b * 64 + p * 4, b * 64 + p * 4 + 4))
                // etcdec leaves alpha unwritten for RGB; it is 255 here.
                if (mode === 'rgb') theirs[3] = 255
            }
            if (ours.join() !== theirs.join()) {
                wrong++
                console.log(`${mode} block ${b} pixel ${p}: ours ${ours} theirs ${theirs}  block ${Buffer.from(block).toString('hex')}`)
            }
        }
    }
    console.log(`${mode.padEnd(5)} ${count} blocks: ${wrong === 0 ? 'identical' : 'DIFFERENT'}`)
    failures += wrong
}
process.exit(failures ? 1 : 0)
