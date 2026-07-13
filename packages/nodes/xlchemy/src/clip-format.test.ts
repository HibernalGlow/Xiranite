import { describe, expect, test } from "vitest"
import { deflateSync } from "node:zlib"
import { decodeBitmap } from "./clip-to-psd.js"
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
    expect(image).toMatchObject({ width: 2, height: 1 })
    expect([...image.data.slice(0, 4)]).toEqual([10, 20, 30, 128])
  })
})

function offscreenAttribute(width: number, height: number) {
  const values: Buffer[] = []
  const u32 = (value: number) => { const output = Buffer.alloc(4); output.writeUInt32BE(value); values.push(output) }
  const utf16 = (value: string) => { u32(value.length); const output = Buffer.from(value, "utf16le"); output.swap16(); values.push(output) }
  u32(16); u32(102); u32(42); u32(0)
  utf16("Parameter")
  u32(width); u32(height); u32(1); u32(1)
  const packing = Array(16).fill(0); packing[1] = 1; packing[2] = 4
  for (const value of packing) u32(value)
  utf16("InitColor")
  u32(0); u32(0); u32(0); u32(0); u32(0)
  return Buffer.concat(values)
}
