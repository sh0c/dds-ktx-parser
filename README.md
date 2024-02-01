# dds-ktx-parser

### HEADER PARSING

Parse .DDS and .KTX files and return ImageInfo about format, mipmaps and shape of image
 - [x] DDS file parse
 - [ ] KTX file parse (TODO)

On ERROR function will return **undefined**
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

Image can be decoded to **RGBA Buffer** layer by layer without external dependencies (only CPU usage)
Supproted decode formats:
 - [x] BC1
 - [x] BC2
 - [x] BC3
 - [x] BC4
 - [x] BC5
 - [X] BC6H
 - [X] BC7
 - [ ] Raw formats - R, RG, RGB (TODO)

 ### EXAMPLE

```ts
import { parseDDSHeader, decodeImage } from './src'
import * as fs from "fs";

const buffer = fs.readFileSync('./tests/resources/dds/bc1.dds')
const imageInfo = parseDDSHeader(buffer)
if (imageInfo) {
    const rgbaBuffer = decodeImage(buffer, imageInfo.format, imageInfo.layers[0])
}
```
