import { parseDDSHeader, parseKTXHeader } from '../src'

import * as fs from "fs";

test('check DXT3 DDS image', () => {
    const data = fs.readFileSync('./tests/resources/dds/dxt3.dds')
    const imageInfo = parseDDSHeader(data)

    expect(imageInfo).not.toBe(undefined)
    if (imageInfo) {
        expect(imageInfo.format).toBe('BC2')
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

test('check BC2 DDS image', () => {
    const data = fs.readFileSync('./tests/resources/dds/bc2.dds')
    const imageInfo = parseDDSHeader(data)

    expect(imageInfo).not.toBe(undefined)
    if (imageInfo) {
        expect(imageInfo.format).toBe('BC2')
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

test('check DXT3 KTX image', () => {
    const data = fs.readFileSync('./tests/resources/ktx/dxt3.ktx')
    const imageInfo = parseKTXHeader(data)

    expect(imageInfo).not.toBe(undefined)
    if (imageInfo) {
        expect(imageInfo.format).toBe('BC2')
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

test('check BC2 KTX image', () => {
    const data = fs.readFileSync('./tests/resources/ktx/bc2.ktx')
    const imageInfo = parseKTXHeader(data)

    expect(imageInfo).not.toBe(undefined)
    if (imageInfo) {
        expect(imageInfo.format).toBe('BC2')
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