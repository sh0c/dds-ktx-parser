import { ImageFormat, ImageInfo, LayerInfo, ParseOptions, channelsOf, levelLength, plausible } from './header-info'
import { align, u32 } from './bytes'

enum InternalFormat
{
    RGB_UNORM= 0x1907,			//GL_RGB
    BGR_UNORM = 0x80E0,		//GL_BGR
    RGBA_UNORM = 0x1908,		//GL_RGBA
    BGRA_UNORM = 0x80E1,		//GL_BGRA
    BGRA8_UNORM = 0x93A1,		//GL_BGRA8_EXT

    // unorm formats
    R8_UNORM = 0x8229,			//GL_R8
    RG8_UNORM = 0x822B,		//GL_RG8
    RGB8_UNORM = 0x8051,		//GL_RGB8
    RGBA8_UNORM = 0x8058,		//GL_RGBA8

    R16_UNORM = 0x822A,		//GL_R16
    RG16_UNORM = 0x822C,		//GL_RG16
    RGB16_UNORM = 0x8054,		//GL_RGB16
    RGBA16_UNORM = 0x805B,		//GL_RGBA16

    RGB10A2_UNORM = 0x8059,	//GL_RGB10_A2
    RGB10A2_SNORM_EXT = 0xFFFC,

    // snorm formats
    R8_SNORM = 0x8F94,			//GL_R8_SNORM
    RG8_SNORM = 0x8F95,		//GL_RG8_SNORM
    RGB8_SNORM = 0x8F96,		//GL_RGB8_SNORM
    RGBA8_SNORM = 0x8F97,		//GL_RGBA8_SNORM

    R16_SNORM = 0x8F98,		//GL_R16_SNORM
    RG16_SNORM= 0x8F99,		//GL_RG16_SNORM
    RGB16_SNORM= 0x8F9A,		//GL_RGB16_SNORM
    RGBA16_SNORM = 0x8F9B,		//GL_RGBA16_SNORM

    // unsigned integer formats
    R8U = 0x8232,				//GL_R8UI
    RG8U = 0x8238,				//GL_RG8UI
    RGB8U = 0x8D7D,			//GL_RGB8UI
    RGBA8U = 0x8D7C,			//GL_RGBA8UI

    R16U = 0x8234,				//GL_R16UI
    RG16U = 0x823A,			//GL_RG16UI
    RGB16U = 0x8D77,			//GL_RGB16UI
    RGBA16U = 0x8D76,			//GL_RGBA16UI

    R32U = 0x8236,				//GL_R32UI
    RG32U = 0x823C,			//GL_RG32UI
    RGB32U = 0x8D71,			//GL_RGB32UI
    RGBA32U = 0x8D70,			//GL_RGBA32UI

    RGB10A2U = 0x906F,			//GL_RGB10_A2UI
    RGB10A2I_EXT = 0xFFFB,

    // signed integer formats
    R8I = 0x8231,				//GL_R8I
    RG8I = 0x8237,				//GL_RG8I
    RGB8I = 0x8D8F,			//GL_RGB8I
    RGBA8I = 0x8D8E,			//GL_RGBA8I

    R16I = 0x8233,				//GL_R16I
    RG16I = 0x8239,			//GL_RG16I
    RGB16I = 0x8D89,			//GL_RGB16I
    RGBA16I = 0x8D88,			//GL_RGBA16I

    R32I = 0x8235,				//GL_R32I
    RG32I = 0x823B,			//GL_RG32I
    RGB32I = 0x8D83,			//GL_RGB32I
    RGBA32I = 0x8D82,			//GL_RGBA32I

    // Floating formats
    R16F = 0x822D,				//GL_R16F
    RG16F = 0x822F,			//GL_RG16F
    RGB16F = 0x881B,			//GL_RGB16F
    RGBA16F = 0x881A,			//GL_RGBA16F

    R32F = 0x822E,				//GL_R32F
    RG32F = 0x8230,			//GL_RG32F
    RGB32F = 0x8815,			//GL_RGB32F
    RGBA32F = 0x8814,			//GL_RGBA32F

    R64F_EXT = 0xFFFA,			//GL_R64F
    RG64F_EXT = 0xFFF9,		//GL_RG64F
    RGB64F_EXT = 0xFFF8,		//GL_RGB64F
    RGBA64F_EXT = 0xFFF7,		//GL_RGBA64F

    // sRGB formats
    SR8 = 0x8FBD,				//GL_SR8_EXT
    SRG8 = 0x8FBE,				//GL_SRG8_EXT
    SRGB8 = 0x8C41,			//GL_SRGB8
    SRGB8_ALPHA8 = 0x8C43,		//GL_SRGB8_ALPHA8

    // Packed formats
    RGB9E5 = 0x8C3D,			//GL_RGB9_E5
    RG11B10F = 0x8C3A,			//GL_R11F_G11F_B10F
    RG3B2 = 0x2A10,			//GL_R3_G3_B2
    R5G6B5 = 0x8D62,			//GL_RGB565
    RGB5A1 = 0x8057,			//GL_RGB5_A1
    RGBA4 = 0x8056,			//GL_RGBA4

    RG4_EXT = 0xFFFE,

    // Luminance Alpha formats
    LA4 = 0x8043,				//GL_LUMINANCE4_ALPHA4
    L8 = 0x8040,				//GL_LUMINANCE8
    A8 = 0x803C,				//GL_ALPHA8
    LA8 = 0x8045,				//GL_LUMINANCE8_ALPHA8
    L16 = 0x8042,				//GL_LUMINANCE16
    A16 = 0x803E,				//GL_ALPHA16
    LA16 = 0x8048,				//GL_LUMINANCE16_ALPHA16

    // Depth formats
    D16 = 0x81A5,				//GL_DEPTH_COMPONENT16
    D24 = 0x81A6,				//GL_DEPTH_COMPONENT24
    D16S8_EXT = 0xFFF6,
    D24S8 = 0x88F0,			//GL_DEPTH24_STENCIL8
    D32 = 0x81A7,				//GL_DEPTH_COMPONENT32
    D32F = 0x8CAC,				//GL_DEPTH_COMPONENT32F
    D32FS8X24 = 0x8CAD,		//GL_DEPTH32F_STENCIL8
    S8_EXT = 0x8D48,			//GL_STENCIL_INDEX8

    // Compressed formats
    RGB_DXT1 = 0x83F0,						//GL_COMPRESSED_RGB_S3TC_DXT1_EXT
    RGBA_DXT1 = 0x83F1,					//GL_COMPRESSED_RGBA_S3TC_DXT1_EXT
    RGBA_DXT3 = 0x83F2,					//GL_COMPRESSED_RGBA_S3TC_DXT3_EXT
    RGBA_DXT5 = 0x83F3,					//GL_COMPRESSED_RGBA_S3TC_DXT5_EXT
    R_ATI1N_UNORM = 0x8DBB,				//GL_COMPRESSED_RED_RGTC1
    R_ATI1N_SNORM = 0x8DBC,				//GL_COMPRESSED_SIGNED_RED_RGTC1
    RG_ATI2N_UNORM = 0x8DBD,				//GL_COMPRESSED_RG_RGTC2
    RG_ATI2N_SNORM = 0x8DBE,				//GL_COMPRESSED_SIGNED_RG_RGTC2
    RGB_BP_UNSIGNED_FLOAT = 0x8E8F,		//GL_COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT
    RGB_BP_SIGNED_FLOAT = 0x8E8E,			//GL_COMPRESSED_RGB_BPTC_SIGNED_FLOAT
    RGB_BP_UNORM = 0x8E8C,					//GL_COMPRESSED_RGBA_BPTC_UNORM
    RGB_PVRTC_4BPPV1 = 0x8C00,				//GL_COMPRESSED_RGB_PVRTC_4BPPV1_IMG
    RGB_PVRTC_2BPPV1 = 0x8C01,				//GL_COMPRESSED_RGB_PVRTC_2BPPV1_IMG
    RGBA_PVRTC_4BPPV1 = 0x8C02,			//GL_COMPRESSED_RGBA_PVRTC_4BPPV1_IMG
    RGBA_PVRTC_2BPPV1 = 0x8C03,			//GL_COMPRESSED_RGBA_PVRTC_2BPPV1_IMG
    RGBA_PVRTC_4BPPV2 = 0x9137,			//GL_COMPRESSED_RGBA_PVRTC_4BPPV2_IMG
    RGBA_PVRTC_2BPPV2 = 0x9138,			//GL_COMPRESSED_RGBA_PVRTC_2BPPV2_IMG
    ATC_RGB = 0x8C92,						//GL_ATC_RGB_AMD
    ATC_RGBA_EXPLICIT_ALPHA = 0x8C93,		//GL_ATC_RGBA_EXPLICIT_ALPHA_AMD
    ATC_RGBA_INTERPOLATED_ALPHA = 0x87EE,	//GL_ATC_RGBA_INTERPOLATED_ALPHA_AMD

    RGB_ETC = 0x8D64,						//GL_COMPRESSED_RGB8_ETC1
    RGB_ETC2 = 0x9274,						//GL_COMPRESSED_RGB8_ETC2
    RGBA_PUNCHTHROUGH_ETC2 = 0x9276,		//GL_COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2
    RGBA_ETC2 = 0x9278,					//GL_COMPRESSED_RGBA8_ETC2_EAC
    R11_EAC = 0x9270,						//GL_COMPRESSED_R11_EAC
    SIGNED_R11_EAC = 0x9271,				//GL_COMPRESSED_SIGNED_R11_EAC
    RG11_EAC = 0x9272,						//GL_COMPRESSED_RG11_EAC
    SIGNED_RG11_EAC = 0x9273,				//GL_COMPRESSED_SIGNED_RG11_EAC

    RGBA_ASTC_4x4 = 0x93B0,				//GL_COMPRESSED_RGBA_ASTC_4x4_KHR
    RGBA_ASTC_5x4 = 0x93B1,				//GL_COMPRESSED_RGBA_ASTC_5x4_KHR
    RGBA_ASTC_5x5 = 0x93B2,				//GL_COMPRESSED_RGBA_ASTC_5x5_KHR
    RGBA_ASTC_6x5 = 0x93B3,				//GL_COMPRESSED_RGBA_ASTC_6x5_KHR
    RGBA_ASTC_6x6 = 0x93B4,				//GL_COMPRESSED_RGBA_ASTC_6x6_KHR
    RGBA_ASTC_8x5 = 0x93B5,				//GL_COMPRESSED_RGBA_ASTC_8x5_KHR
    RGBA_ASTC_8x6 = 0x93B6,				//GL_COMPRESSED_RGBA_ASTC_8x6_KHR
    RGBA_ASTC_8x8 = 0x93B7,				//GL_COMPRESSED_RGBA_ASTC_8x8_KHR
    RGBA_ASTC_10x5 = 0x93B8,				//GL_COMPRESSED_RGBA_ASTC_10x5_KHR
    RGBA_ASTC_10x6 = 0x93B9,				//GL_COMPRESSED_RGBA_ASTC_10x6_KHR
    RGBA_ASTC_10x8 = 0x93BA,				//GL_COMPRESSED_RGBA_ASTC_10x8_KHR
    RGBA_ASTC_10x10 = 0x93BB,				//GL_COMPRESSED_RGBA_ASTC_10x10_KHR
    RGBA_ASTC_12x10 = 0x93BC,				//GL_COMPRESSED_RGBA_ASTC_12x10_KHR
    RGBA_ASTC_12x12 = 0x93BD,				//GL_COMPRESSED_RGBA_ASTC_12x12_KHR

    // sRGB formats
    SRGB_DXT1 = 0x8C4C,					//GL_COMPRESSED_SRGB_S3TC_DXT1_EXT
    SRGB_ALPHA_DXT1 = 0x8C4D,				//GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT
    SRGB_ALPHA_DXT3 = 0x8C4E,				//GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT
    SRGB_ALPHA_DXT5 = 0x8C4F,				//GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT
    SRGB_BP_UNORM = 0x8E8D,				//GL_COMPRESSED_SRGB_ALPHA_BPTC_UNORM
    SRGB_PVRTC_2BPPV1 = 0x8A54,			//GL_COMPRESSED_SRGB_PVRTC_2BPPV1_EXT
    SRGB_PVRTC_4BPPV1 = 0x8A55,			//GL_COMPRESSED_SRGB_PVRTC_4BPPV1_EXT
    SRGB_ALPHA_PVRTC_2BPPV1 = 0x8A56,		//GL_COMPRESSED_SRGB_ALPHA_PVRTC_2BPPV1_EXT
    SRGB_ALPHA_PVRTC_4BPPV1 = 0x8A57,		//GL_COMPRESSED_SRGB_ALPHA_PVRTC_4BPPV1_EXT
    SRGB_ALPHA_PVRTC_2BPPV2 = 0x93F0,		//COMPRESSED_SRGB_ALPHA_PVRTC_2BPPV2_IMG
    SRGB_ALPHA_PVRTC_4BPPV2 = 0x93F1,		//GL_COMPRESSED_SRGB_ALPHA_PVRTC_4BPPV2_IMG
    SRGB8_ETC2 = 0x9275,						//GL_COMPRESSED_SRGB8_ETC2
    SRGB8_PUNCHTHROUGH_ALPHA1_ETC2 = 0x9277,	//GL_COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2
    SRGB8_ALPHA8_ETC2_EAC = 0x9279,			//GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC
    SRGB8_ALPHA8_ASTC_4x4 = 0x93D0,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR
    SRGB8_ALPHA8_ASTC_5x4 = 0x93D1,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR
    SRGB8_ALPHA8_ASTC_5x5 = 0x93D2,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR
    SRGB8_ALPHA8_ASTC_6x5 = 0x93D3,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR
    SRGB8_ALPHA8_ASTC_6x6 = 0x93D4,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR
    SRGB8_ALPHA8_ASTC_8x5 = 0x93D5,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR
    SRGB8_ALPHA8_ASTC_8x6 = 0x93D6,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR
    SRGB8_ALPHA8_ASTC_8x8 = 0x93D7,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR
    SRGB8_ALPHA8_ASTC_10x5 = 0x93D8,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR
    SRGB8_ALPHA8_ASTC_10x6 = 0x93D9,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR
    SRGB8_ALPHA8_ASTC_10x8 = 0x93DA,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR
    SRGB8_ALPHA8_ASTC_10x10 = 0x93DB,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR
    SRGB8_ALPHA8_ASTC_12x10 = 0x93DC,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR
    SRGB8_ALPHA8_ASTC_12x12 = 0x93DD,		//GL_COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR
    
    ALPHA8 = 0x803C,
    ALPHA16 = 0x803E,
    LUMINANCE8 = 0x8040,
    LUMINANCE16 = 0x8042,
    LUMINANCE8_ALPHA8 = 0x8045,
    LUMINANCE16_ALPHA16 = 0x8048,
    
    R8_USCALED_GTC = 0xF000,
    R8_SSCALED_GTC,
    RG8_USCALED_GTC,
    RG8_SSCALED_GTC,
    RGB8_USCALED_GTC,
    RGB8_SSCALED_GTC,
    RGBA8_USCALED_GTC,
    RGBA8_SSCALED_GTC,
    RGB10A2_USCALED_GTC,
    RGB10A2_SSCALED_GTC,
    R16_USCALED_GTC,
    R16_SSCALED_GTC,
    RG16_USCALED_GTC,
    RG16_SSCALED_GTC,
    RGB16_USCALED_GTC,
    RGB16_SSCALED_GTC,
    RGBA16_USCALED_GTC,
    RGBA16_SSCALED_GTC,
}

// GL data types, for the unsized internal formats that need one to say
// what their bytes are.
const GL_UNSIGNED_BYTE: number = 0x1401

// Formats that are not in the table above under a sized name.
const GL_ALPHA: number = 0x1906
const GL_LUMINANCE: number = 0x1909

type Format = [ImageFormat, boolean] // the format, and whether it is sRGB

function fromGL(internalFormat: number, type: number): Format | undefined {
    switch (internalFormat) {
        case InternalFormat.RGB_DXT1:
        case InternalFormat.RGBA_DXT1:
            return ['BC1', false]
        case InternalFormat.SRGB_DXT1:
        case InternalFormat.SRGB_ALPHA_DXT1:
            return ['BC1', true]
        case InternalFormat.RGBA_DXT3:
            return ['BC2', false]
        case InternalFormat.SRGB_ALPHA_DXT3:
            return ['BC2', true]
        case InternalFormat.RGBA_DXT5:
            return ['BC3', false]
        case InternalFormat.SRGB_ALPHA_DXT5:
            return ['BC3', true]
        case InternalFormat.R_ATI1N_UNORM:
            return ['BC4', false]
        case InternalFormat.R_ATI1N_SNORM:
            return ['BC4_SNORM', false]
        case InternalFormat.RG_ATI2N_UNORM:
            return ['BC5', false]
        case InternalFormat.RG_ATI2N_SNORM:
            return ['BC5_SNORM', false]
        case InternalFormat.RGB_BP_UNSIGNED_FLOAT:
            return ['BC6H', false]
        case InternalFormat.RGB_BP_SIGNED_FLOAT:
            return ['BC6H_SF16', false]
        case InternalFormat.RGB_BP_UNORM:
            return ['BC7', false]
        case InternalFormat.SRGB_BP_UNORM:
            return ['BC7', true]
        case InternalFormat.RGB_ETC:
            return ['ETC1', false]
        case InternalFormat.RGB_ETC2:
            return ['ETC2_RGB', false]
        case InternalFormat.SRGB8_ETC2:
            return ['ETC2_RGB', true]
        case InternalFormat.RGBA_PUNCHTHROUGH_ETC2:
            return ['ETC2_RGB_A1', false]
        case InternalFormat.SRGB8_PUNCHTHROUGH_ALPHA1_ETC2:
            return ['ETC2_RGB_A1', true]
        case InternalFormat.RGBA_ETC2:
            return ['ETC2_RGBA', false]
        case InternalFormat.SRGB8_ALPHA8_ETC2_EAC:
            return ['ETC2_RGBA', true]
        case InternalFormat.R11_EAC:
            return ['EAC_R11', false]
        case InternalFormat.SIGNED_R11_EAC:
            return ['EAC_R11_SNORM', false]
        case InternalFormat.RG11_EAC:
            return ['EAC_RG11', false]
        case InternalFormat.SIGNED_RG11_EAC:
            return ['EAC_RG11_SNORM', false]
        case InternalFormat.RGBA8_UNORM:
            return ['RGBA8', false]
        case InternalFormat.SRGB8_ALPHA8:
            return ['RGBA8', true]
        case InternalFormat.RGB8_UNORM:
            return ['RGB8', false]
        case InternalFormat.SRGB8:
            return ['RGB8', true]
        case InternalFormat.BGRA8_UNORM:
            return ['BGRA8', false]
        case InternalFormat.R8_UNORM:
            return ['R8', false]
        case InternalFormat.RG8_UNORM:
            return ['RG8', false]
        case InternalFormat.R8_SNORM:
            return ['R8_SNORM', false]
        case InternalFormat.RG8_SNORM:
            return ['RG8_SNORM', false]
        case InternalFormat.R16_UNORM:
            return ['R16', false]
        case InternalFormat.RG16_UNORM:
            return ['RG16', false]
        case InternalFormat.R16_SNORM:
            return ['R16_SNORM', false]
        case InternalFormat.RG16_SNORM:
            return ['RG16_SNORM', false]
        case InternalFormat.L16:
            return ['L16', false]
        case InternalFormat.RGB10A2_UNORM:
            return ['RGB10A2', false]
        // GL_RGB565 is red in the top five bits, as B5G6R5 is.
        case InternalFormat.R5G6B5:
            return ['B5G6R5', false]
        case InternalFormat.R16F:
            return ['R16F', false]
        case InternalFormat.RG16F:
            return ['RG16F', false]
        case InternalFormat.RGBA16F:
            return ['RGBA16F', false]
        case InternalFormat.RGB16F:
            return ['RGB16F', false]
        case InternalFormat.RGB32F:
            return ['RGB32F', false]
        case InternalFormat.RG11B10F:
            return ['RG11B10F', false]
        case InternalFormat.RGB9E5:
            return ['RGB9E5', false]
        case InternalFormat.R32F:
            return ['R32F', false]
        case InternalFormat.RG32F:
            return ['RG32F', false]
        case InternalFormat.RGBA32F:
            return ['RGBA32F', false]
    }
    // Unsized formats, as older writers use: what the bytes are is the type.
    if (type === GL_UNSIGNED_BYTE) {
        switch (internalFormat) {
            case InternalFormat.RGBA_UNORM:
                return ['RGBA8', false]
            case InternalFormat.RGB_UNORM:
                return ['RGB8', false]
            case InternalFormat.BGRA_UNORM:
                return ['BGRA8', false]
            case GL_LUMINANCE:
                return ['L8', false]
            case GL_ALPHA:
                return ['A8', false]
        }
    }
    return undefined
}

const magic: Uint8Array = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])
const magic2: Uint8Array = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])

// The header, identifier included: all of it that a parse reads in one go.
export const KTX_HEADER_BYTES: number = 64

// Byte offsets of the header's fields, from
// https://registry.khronos.org/KTX/specs/1.0/ktxspec.v1.html
const at = {
    endianness: 12,
    glType: 16,
    glFormat: 24,
    glInternalFormat: 28,
    width: 36,
    height: 40,
    depth: 44,
    arrayElements: 48,
    faces: 52,
    levels: 56,
    keyValueBytes: 60,
}
const LITTLE_ENDIAN: number = 0x04030201

function same(bytes: Uint8Array, expected: Uint8Array): boolean {
    return bytes.length >= expected.length && expected.every((value, i) => bytes[i] === value)
}

// What kind of file @head starts: a DDS, a KTX 1, or a KTX 2 — which this
// cannot read yet, and which is worth telling apart from a file that is not
// a texture at all.
export function detectContainer(head: Uint8Array): 'dds' | 'ktx' | 'ktx2' | undefined {
    if (head.length >= 4 && head[0] === 0x44 && head[1] === 0x44 && head[2] === 0x53 && head[3] === 0x20)
        return 'dds'
    if (same(head, magic)) return 'ktx'
    if (same(head, magic2)) return 'ktx2'
    return undefined
}

// The walk through a KTX file's levels, written once for both ways of
// reading: it yields the position of each level's four-byte imageSize, and
// is given back the number found there — or NaN if it could not be read.
// So a file in memory and a file read by range go through the same checks.
//
// KTX 1 keeps, for each level, its imageSize and then every array element's
// every face; a cube map that is not an array pads each face to four bytes,
// and every level is padded to four bytes after it.
export function* walkKTX(
    head: Uint8Array,
    fileSize: number,
    options?: ParseOptions,
): Generator<number, ImageInfo | undefined, number> {
    if (head.length < KTX_HEADER_BYTES || !same(head, magic)) return undefined
    // A file written big-endian would need every value swapped; none is
    // known in the wild, and it is refused rather than misread.
    if (u32(head, at.endianness) !== LITTLE_ENDIAN) return undefined

    const format = fromGL(u32(head, at.glInternalFormat), u32(head, at.glType))
    if (!format) return undefined
    const [imageFormat, srgb] = format

    const width = u32(head, at.width)
    // 0 is how KTX says a dimension is not used: a 1D texture has no height.
    const height = Math.max(1, u32(head, at.height))
    const depth = Math.max(1, u32(head, at.depth))
    const arrayElements = u32(head, at.arrayElements)
    const arraySize = Math.max(1, arrayElements)
    const faces = u32(head, at.faces)
    // 0 asks a GL loader to make the levels; one is stored.
    const levels = Math.max(1, u32(head, at.levels))
    const keyValueBytes = u32(head, at.keyValueBytes)

    if (faces !== 1 && faces !== 6) return undefined
    if (!plausible(width, height, depth, levels, faces, arraySize, options)) return undefined
    if (KTX_HEADER_BYTES + keyValueBytes > fileSize) return undefined

    const cubeNotArray = faces === 6 && arrayElements === 0
    const layers = new Array<LayerInfo>()
    let position = KTX_HEADER_BYTES + keyValueBytes
    let w = width
    let h = height
    let d = depth
    for (let level = 0; level < levels; level++) {
        if (position + 4 > fileSize) return undefined
        const imageSize: number = yield position
        const { rowPitch, length } = levelLength(imageFormat, w, h, d, 4)
        // imageSize is one face for a cube map that is not an array, and the
        // whole level otherwise. Anything else is a file this does not
        // understand, or one that lies — and a size is not trusted to say
        // where the next level is until it has been checked.
        const expected = cubeNotArray ? length : length * faces * arraySize
        if (imageSize !== expected) return undefined

        const start = position + 4
        const faceStride = cubeNotArray ? align(length, 4) : length
        for (let arrayIndex = 0; arrayIndex < arraySize; arrayIndex++) {
            for (let face = 0; face < faces; face++) {
                const offset = start + (arrayIndex * faces + face) * faceStride
                if (offset + length > fileSize) return undefined
                layers.push({
                    offset,
                    length,
                    shape: { width: w, height: h },
                    level,
                    face,
                    arrayIndex,
                    depth: d,
                    rowPitch,
                })
            }
        }
        position = align(start + faceStride * faces * arraySize, 4)
        w = Math.max(1, w >> 1)
        h = Math.max(1, h >> 1)
        d = Math.max(1, d >> 1)
    }

    return {
        container: 'ktx',
        shape: { width, height },
        layers,
        format: imageFormat,
        srgb,
        channels: channelsOf(imageFormat),
        levels,
        faces,
        arraySize,
        depth,
        supercompression: 'none',
    }
}

// Parse a KTX 1 file held whole in @bytes, and say where every image in it
// is. Answers undefined for anything it cannot read, and for any file whose
// numbers cannot be right.
export function parseKTXHeader(bytes: Uint8Array, options?: ParseOptions): ImageInfo | undefined {
    const walk = walkKTX(bytes, bytes.length, options)
    let step = walk.next()
    while (!step.done) {
        const position = step.value
        step = walk.next(position + 4 <= bytes.length ? u32(bytes, position) : NaN)
    }
    return step.value
}
