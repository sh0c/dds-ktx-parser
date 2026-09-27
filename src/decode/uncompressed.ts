import { UncompressedFormat } from '../header-info'
import { halfToFloat, u16, u32 } from '../bytes'

// A signed byte, or signed 16 bits, as SNORM means it: the most negative is
// read as one more, so -1 and 1 are both exact.
const snorm8 = (v: number): number => Math.max(-1, (v > 127 ? v - 256 : v) / 127)
const snorm16 = (v: number): number => Math.max(-1, (v > 32767 ? v - 65536 : v) / 32767)

// One row of pixels of an uncompressed format, as RGBA floats in @into from
// @at. Channels a format has not got are 0, and alpha is 1 — the way a GPU
// samples them — except L8, which is grey.
export function decodeRowFloat(
    bytes: Uint8Array,
    view: DataView,
    start: number,
    format: UncompressedFormat,
    width: number,
    into: Float32Array,
    at: number,
): void {
    for (let x = 0; x < width; x++) {
        let r = 0
        let g = 0
        let b = 0
        let a = 1
        switch (format) {
            case 'RGBA8':
            case 'RGBX8': {
                const p = start + x * 4
                r = bytes[p] / 255
                g = bytes[p + 1] / 255
                b = bytes[p + 2] / 255
                a = format === 'RGBA8' ? bytes[p + 3] / 255 : 1
                break
            }
            case 'BGRA8':
            case 'BGRX8': {
                const p = start + x * 4
                b = bytes[p] / 255
                g = bytes[p + 1] / 255
                r = bytes[p + 2] / 255
                a = format === 'BGRA8' ? bytes[p + 3] / 255 : 1
                break
            }
            case 'RGB8': {
                const p = start + x * 3
                r = bytes[p] / 255
                g = bytes[p + 1] / 255
                b = bytes[p + 2] / 255
                break
            }
            case 'BGR8': {
                const p = start + x * 3
                b = bytes[p] / 255
                g = bytes[p + 1] / 255
                r = bytes[p + 2] / 255
                break
            }
            case 'R8':
                r = bytes[start + x] / 255
                break
            case 'RG8':
                r = bytes[start + x * 2] / 255
                g = bytes[start + x * 2 + 1] / 255
                break
            case 'R8_SNORM':
                r = snorm8(bytes[start + x])
                break
            case 'RG8_SNORM':
                r = snorm8(bytes[start + x * 2])
                g = snorm8(bytes[start + x * 2 + 1])
                break
            case 'R16':
                r = u16(bytes, start + x * 2) / 65535
                break
            case 'RG16':
                r = u16(bytes, start + x * 4) / 65535
                g = u16(bytes, start + x * 4 + 2) / 65535
                break
            case 'R16_SNORM':
                r = snorm16(u16(bytes, start + x * 2))
                break
            case 'RG16_SNORM':
                r = snorm16(u16(bytes, start + x * 4))
                g = snorm16(u16(bytes, start + x * 4 + 2))
                break
            case 'L8':
                r = g = b = bytes[start + x] / 255
                break
            case 'L16':
                r = g = b = u16(bytes, start + x * 2) / 65535
                break
            case 'A8':
                a = bytes[start + x] / 255
                break
            case 'RGB10A2': {
                const v = u32(bytes, start + x * 4)
                r = (v & 0x3ff) / 1023
                g = ((v >>> 10) & 0x3ff) / 1023
                b = ((v >>> 20) & 0x3ff) / 1023
                a = (v >>> 30) / 3
                break
            }
            case 'B5G6R5': {
                const v = u16(bytes, start + x * 2)
                b = (v & 0x1f) / 31
                g = ((v >> 5) & 0x3f) / 63
                r = (v >> 11) / 31
                break
            }
            case 'B5G5R5A1': {
                const v = u16(bytes, start + x * 2)
                b = (v & 0x1f) / 31
                g = ((v >> 5) & 0x1f) / 31
                r = ((v >> 10) & 0x1f) / 31
                a = v >> 15
                break
            }
            case 'B4G4R4A4': {
                const v = u16(bytes, start + x * 2)
                b = (v & 0xf) / 15
                g = ((v >> 4) & 0xf) / 15
                r = ((v >> 8) & 0xf) / 15
                a = (v >> 12) / 15
                break
            }
            case 'R16F':
                r = halfToFloat(u16(bytes, start + x * 2))
                break
            case 'RG16F':
                r = halfToFloat(u16(bytes, start + x * 4))
                g = halfToFloat(u16(bytes, start + x * 4 + 2))
                break
            case 'RGBA16F': {
                const p = start + x * 8
                r = halfToFloat(u16(bytes, p))
                g = halfToFloat(u16(bytes, p + 2))
                b = halfToFloat(u16(bytes, p + 4))
                a = halfToFloat(u16(bytes, p + 6))
                break
            }
            case 'R32F':
                r = view.getFloat32(start + x * 4, true)
                break
            case 'RG32F':
                r = view.getFloat32(start + x * 8, true)
                g = view.getFloat32(start + x * 8 + 4, true)
                break
            case 'RGBA32F': {
                const p = start + x * 16
                r = view.getFloat32(p, true)
                g = view.getFloat32(p + 4, true)
                b = view.getFloat32(p + 8, true)
                a = view.getFloat32(p + 12, true)
                break
            }
        }
        const o = at + x * 4
        into[o] = r
        into[o + 1] = g
        into[o + 2] = b
        into[o + 3] = a
    }
}
