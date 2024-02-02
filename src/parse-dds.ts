import { ImageFormat, ImageInfo, LayerInfo, formatSizes } from './header-info'
import { fourCCToInt32, CUBEMAP_FLAGS, DDPF, D3DFMT, DXGI_FORMAT } from './dds-types'

const magic = fourCCToInt32('DDS ')

const headerSize : number = 124
const headerIntSize : number = headerSize / Uint32Array.BYTES_PER_ELEMENT

const magicPos : number = 0
const sizePos: number = 1
//const flagsPos: number = 2
const heightPos: number = 3
const widthPos: number = 4
//const pitchPos: number = 5
const depthPos: number = 6
const mipmapLevelsPos: number = 7
// skip reserved 11 bytes
//const formatSizePos: number = 19
const formatFlagsPos: number = 20
const formatFourCC: number = 21
const cubemapFlagsPos: number = 27

const dx10HeaderSize: number = 20
const dx10HeaderIntSize: number = dx10HeaderSize / Uint32Array.BYTES_PER_ELEMENT

const dx10FormatPos: number = 0

function incrementOnFlag(flag: number, flagID: CUBEMAP_FLAGS, value: number) {
    return (flag & flagID) !== 0 ? value + 1 : value
}

// parse DDS header from buffer from
// https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header
// and DDS DX10 header from
// https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dds-header-dxt10
// and fill ImageInfo with all data needed to decode image to RGBA buffer
export function parseDDSHeader(b: Buffer) : ImageInfo | undefined {
    const header = new Int32Array(b.buffer, b.byteOffset, headerIntSize)

    // check for dds magic
    if (header[magicPos] !== magic) {
        return undefined
    }
    var dataOffset: number = headerSize + Uint32Array.BYTES_PER_ELEMENT /*magic size*/
    // check for proper header size
    const size = header[sizePos]
    if (headerSize !== size) {
        return undefined
    }

    const levels = header[mipmapLevelsPos]
    const width = header[widthPos]
    const height = header[heightPos]
    const flags = header[formatFlagsPos]
    const cubemapFlags = header[cubemapFlagsPos]

    var faceCount: number = 1
    if ((cubemapFlags & CUBEMAP_FLAGS.CUBEMAP) !== 0) {
        faceCount = incrementOnFlag(cubemapFlags, CUBEMAP_FLAGS.CUBEMAP_NEGATIVEZ, faceCount)
        faceCount = incrementOnFlag(cubemapFlags, CUBEMAP_FLAGS.CUBEMAP_POSITIVEZ, faceCount)
        faceCount = incrementOnFlag(cubemapFlags, CUBEMAP_FLAGS.CUBEMAP_NEGATIVEY, faceCount)
        faceCount = incrementOnFlag(cubemapFlags, CUBEMAP_FLAGS.CUBEMAP_POSITIVEY, faceCount)
        faceCount = incrementOnFlag(cubemapFlags, CUBEMAP_FLAGS.CUBEMAP_NEGATIVEX, faceCount)
        faceCount = incrementOnFlag(cubemapFlags, CUBEMAP_FLAGS.CUBEMAP_POSITIVEX, faceCount)
    }

    var depthCount: number = 1
    if ((cubemapFlags & CUBEMAP_FLAGS.VOLUME) !== 0) {
        depthCount = header[depthPos]
    }

    var imageFormat: ImageFormat = 'BC1'
    if ((flags & DDPF.DDPF_FOURCC) !== 0) {
        const fourCC = header[formatFourCC]
        switch (fourCC) {
            case D3DFMT.DXT1:
                imageFormat = 'BC1'
                break
            case D3DFMT.DXT3:
                imageFormat = 'BC2'
                break
            case D3DFMT.DXT5:
                imageFormat = 'BC3'
                break
            case D3DFMT.ATI1:
                imageFormat = 'BC4'
                break
            case D3DFMT.ATI2:
                imageFormat = 'BC5'
                break
            case D3DFMT.DX10:
                const dx10Header = new Int32Array(b.buffer, b.byteOffset + dataOffset, dx10HeaderIntSize)
                const dx10fFormat = dx10Header[dx10FormatPos]
                switch (dx10fFormat) {
                    case DXGI_FORMAT.BC1_UNORM:
                    case DXGI_FORMAT.BC1_TYPELESS:
                    case DXGI_FORMAT.BC1_UNORM:
                        imageFormat = 'BC1'
                        break
                    case DXGI_FORMAT.BC2_UNORM:
                    case DXGI_FORMAT.BC2_TYPELESS:
                    case DXGI_FORMAT.BC2_UNORM_SRGB:
                        imageFormat = 'BC2'
                        break
                    case DXGI_FORMAT.BC3_UNORM:
                    case DXGI_FORMAT.BC3_TYPELESS:
                    case DXGI_FORMAT.BC3_UNORM_SRGB:
                        imageFormat = 'BC3'
                        break
                    case DXGI_FORMAT.BC4_UNORM:
                    case DXGI_FORMAT.BC4_TYPELESS:
                    case DXGI_FORMAT.BC4_SNORM:
                        imageFormat = 'BC4'
                        break
                    case DXGI_FORMAT.BC5_UNORM:
                    case DXGI_FORMAT.BC5_TYPELESS:
                    case DXGI_FORMAT.BC5_SNORM:
                        imageFormat = 'BC5'
                        break
                    case DXGI_FORMAT.BC6H_SF16:
                    case DXGI_FORMAT.BC6H_UF16:
                    case DXGI_FORMAT.BC6H_TYPELESS:
                        imageFormat = 'BC6H'
                        break    
                    case DXGI_FORMAT.BC7_TYPELESS:
                    case DXGI_FORMAT.BC7_UNORM:
                        imageFormat = 'BC7'
                        break
                    case DXGI_FORMAT.BC7_UNORM_SRGB:
                        imageFormat = 'BC7'
                        break
                }

                dataOffset = dataOffset + dx10HeaderSize
                break
            default:
                return undefined
        }
    }
    else {
        // TODO handle raw types (RGB, RGBA)
    }
    
    var layerInfo = new Array<LayerInfo>()
    if (imageFormat) {
        const formatSize = formatSizes[imageFormat]

        var workWidth = width
        var workHeight = height

        for (var i = 0; i < levels; i++) {

            const widthBlocks = Math.floor((workWidth + formatSize.blockWidth - 1) / formatSize.blockWidth)
            const heightBlocks = Math.floor((workHeight + formatSize.blockHeight - 1) / formatSize.blockHeight)

            const dataLength = widthBlocks * heightBlocks * formatSize.blockSize

            layerInfo.push({
                offset: dataOffset,
                length: dataLength,
                shape: {
                    width: workWidth,
                    height: workHeight
                }
            })

            dataOffset += dataLength;
            workWidth >>= 1
            workHeight >>= 1
        }

        return {
            shape: {
                width: width,
                height: height,
            },
            layers: layerInfo,
            format: imageFormat
        }
    }
    
    return undefined
}
