import { describe, expect, test } from "vitest"
import { deflateSync } from "node:zlib"
import { decodeBitmap, parseFilterAdjustment, parseGradientFill, parseTextAttributes } from "./clip-to-psd.js"
import { extractClipSqlite, parseClipChunks } from "./clip-format.js"

describe("native CLIP format parser", () => {
  test("extracts the embedded SQLite chunk", () => {
    const sqlite = Buffer.from("SQLite format 3\0fixture")
    const header = Buffer.alloc(24)
    header.write("CSFCHUNK", 0, "ascii")
    const chunk = Buffer.alloc(16)
    chunk.write("CHNKSQLi", 0, "ascii")
    chunk.writeUInt32BE(sqlite.length, 12)
    const chunks = parseClipChunks(Buffer.concat([header, chunk, sqlite]))
    expect(chunks).toMatchObject([{ name: "SQLi", offset: 24 }])
    expect(extractClipSqlite(chunks)).toEqual(sqlite)
  })

  test("rejects malformed CLIP headers before touching SQLite", () => {
    expect(() => parseClipChunks(Buffer.from("not-a-clip"))).toThrow("CSFCHUNK")
  })

  test("decodes CSP alpha plus BGRX bitmap blocks to RGBA", () => {
    const attribute = offscreenAttribute(2, 1)
    const pixels = Buffer.alloc(256 * 256 * 5)
    pixels[0] = 128
    const color = 256 * 256
    pixels[color] = 30
    pixels[color + 1] = 20
    pixels[color + 2] = 10
    const image = decodeBitmap(attribute, [deflateSync(pixels)])
    expect(image).toMatchObject({ left: 0, top: 0, imageData: { width: 2, height: 1 } })
    expect([...image.imageData.data.slice(0, 4)]).toEqual([10, 20, 30, 128])
  })

  test("allocates only the non-empty CLIP block bounds", () => {
    const attribute = offscreenAttribute(1024, 1024, 4, 4)
    const pixels = Buffer.alloc(256 * 256 * 5)
    const blocks = Array<Buffer | undefined>(16).fill(undefined); blocks[10] = deflateSync(pixels)
    const image = decodeBitmap(attribute, blocks)
    expect(image).toMatchObject({ left: 512, top: 512, imageData: { width: 256, height: 256 } })
    expect(image.imageData.data.byteLength).toBe(256 * 256 * 4)
  })

  test("decodes editable CLIP text defaults", () => {
    const font = Buffer.from("Noto Sans CJK", "utf8")
    const fontSize = Buffer.alloc(4); fontSize.writeUInt32LE(2400)
    const color = Buffer.alloc(12); color.writeUInt32LE(0xffffffff, 0); color.writeUInt32LE(0x7fffffff, 4); color.writeUInt32LE(0, 8)
    const attributes = Buffer.concat([textParam(31, font), textParam(32, fontSize), textParam(34, color)])
    expect(parseTextAttributes(attributes)).toMatchObject({ font: "Noto Sans CJK", fontSize: 2400, color: [1, expect.closeTo(0.5, 5), 0] })
  })

  test("decodes editable CLIP flat-color gradient layers", () => {
    const header = Buffer.alloc(8)
    const name = utf16be("GradationSettingAdd0001")
    const section = Buffer.alloc(16)
    section.writeUInt32BE(1, 0); section.writeUInt32BE(0x12000000, 4); section.writeUInt32BE(0x34000000, 8); section.writeUInt32BE(0x56000000, 12)
    const length = Buffer.alloc(4); length.writeUInt32BE(section.length)
    expect(parseGradientFill(Buffer.concat([header, name, length, section]))).toEqual({ flatColor: { r: 0x12, g: 0x34, b: 0x56 } })
  })

  test("maps CLIP brightness filters to ag-psd adjustments", () => {
    const data = Buffer.alloc(16)
    data.writeUInt32BE(1, 0); data.writeUInt32BE(8, 4); data.writeInt32BE(12, 8); data.writeInt32BE(-8, 12)
    expect(parseFilterAdjustment(data)).toEqual({ type: "brightness/contrast", brightness: 12, contrast: -8, meanValue: 127, useLegacy: true })
  })
})

function textParam(id: number, value: Buffer) { const header = Buffer.alloc(8); header.writeUInt32LE(id); header.writeUInt32LE(value.length, 4); return Buffer.concat([header, value]) }
function utf16be(value: string) { const length = Buffer.alloc(4); length.writeUInt32BE(value.length); const text = Buffer.from(value, "utf16le"); text.swap16(); return Buffer.concat([length, text]) }

function offscreenAttribute(width: number, height: number, gridWidth = 1, gridHeight = 1) {
  const values: Buffer[] = []
  const u32 = (value: number) => { const output = Buffer.alloc(4); output.writeUInt32BE(value); values.push(output) }
  const utf16 = (value: string) => { u32(value.length); const output = Buffer.from(value, "utf16le"); output.swap16(); values.push(output) }
  u32(16); u32(102); u32(42); u32(0)
  utf16("Parameter")
  u32(width); u32(height); u32(gridWidth); u32(gridHeight)
  const packing = Array(16).fill(0); packing[1] = 1; packing[2] = 4
  for (const value of packing) u32(value)
  utf16("InitColor")
  u32(0); u32(0); u32(0); u32(0); u32(0)
  return Buffer.concat(values)
}
