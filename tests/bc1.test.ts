import { parseDDSHeader } from '../src'

import * as fs from "fs";

test('check DXT1 image', () => {
    const data = fs.readFileSync('./tests/resources/dds/dxt1.dds')
    const imageInfo = parseDDSHeader(data)

    expect(imageInfo).not.toBe(undefined)
    if (imageInfo) {
        expect(imageInfo.format).toBe('BC1')
        expect(imageInfo.shape.width).toBe(512)
        expect(imageInfo.shape.height).toBe(512)
        expect(imageInfo.layers.length).toBe(4)
        let width = imageInfo.shape.width
        let height = imageInfo.shape.height
        imageInfo.layers.forEach(e => {
            expect(e.shape.width).toBe(width)
            expect(e.shape.height).toBe(height)

            width = Math.floor(width / 2)
            height = Math.floor(height / 2)
        })
    }
})

test('check BC1 image', () => {
    const data = fs.readFileSync('./tests/resources/dds/bc1.dds')
    const imageInfo = parseDDSHeader(data)

    expect(imageInfo).not.toBe(undefined)
    if (imageInfo) {
        expect(imageInfo.format).toBe('BC1')
        expect(imageInfo.shape.width).toBe(512)
        expect(imageInfo.shape.height).toBe(512)
        expect(imageInfo.layers.length).toBe(4)
        let width = imageInfo.shape.width
        let height = imageInfo.shape.height
        imageInfo.layers.forEach(e => {
            expect(e.shape.width).toBe(width)
            expect(e.shape.height).toBe(height)

            width = Math.floor(width / 2)
            height = Math.floor(height / 2)
        })
    }
})
