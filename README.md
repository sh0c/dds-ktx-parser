# dds-ktx-parser

### HEADER PARSING

Parse .DDS and .KTX files and return ImageInfo about format, mipmaps and shape of image
 - [x] DDS file parse
 - [ ] KTX file parse (TODO)

On ERROR function will return undefined
```ts
interface ImageInfo {
    readonly shape: ImageShape // width and height
    readonly layers: Array<LayerInfo>; // mipmap info
    readonly format: ImageFormat // format of image
}
```

Supported parse Image formats:
 - [x] Compressed (BC1, BC2, BC3, BC4, BC5, BC6H, BC7)
 - [ ] Raw formats (RGBA, RGB, RG, R) (TODO)

### DATA PARSING

Image can be decode to RGBA Buffer layer by layer.
Supproted decode formats:
 - [x] BC1
 - [x] BC2
 - [x] BC3
 - [ ] BC4 (TODO)
 - [ ] BC5 (TODO)
 - [ ] BC6H (TODO)
 - [ ] BC7 (TODO)
 - [ ] Raw formats - R, RG, RGB (TODO)

 ### EXAMPLE

```ts
import { parseDDSHeader, decodeImage } from './src'
import * as fs from "fs";

const buffer = fs.readFileSync('./tests/resources/dds/bc1.dds')
const imageInfo = parseDDSHeader(buffer)
if (imageInfo) {
    const rgbaBuffer = decodeImage(buffer, imageInfo.format, imageInfo.layer[0])
}
```
