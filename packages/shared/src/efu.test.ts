import { describe, expect, test } from "vitest"

import { decodeEfuBytes, parseEfuRecords, streamEfuRecords } from "./efu.js"

describe("shared Everything EFU parser", () => {
  test("parses optional metadata, quoted commas, and embedded CSV newlines", () => {
    const records = parseEfuRecords([
      "Filename,Size,Date Modified,Attributes",
      '"D:\\Pictures\\a, one.png",123,133801632000000000,32',
      '"D:\\Pictures\\multi',
      'line.png",456,2024-01-02T03:04:05Z,32',
    ].join("\r\n"))
    expect(records).toEqual([
      { filename: "D:\\Pictures\\a, one.png", size: "123", dateModified: "133801632000000000", attributes: "32" },
      { filename: "D:\\Pictures\\multi\r\nline.png", size: "456", dateModified: "2024-01-02T03:04:05Z", attributes: "32" },
    ])
  })

  test("decodes UTF-16LE and streams across single-byte boundaries", async () => {
    const source = "Filename,Size\r\nD:/images/a.png,42\r\n"
    const bytes = utf16Le(source)
    expect(decodeEfuBytes(bytes)).toBe(source)
    const records = []
    async function* chunks() {
      for (const byte of bytes) yield Uint8Array.of(byte)
    }
    for await (const record of streamEfuRecords(chunks())) records.push(record)
    expect(records).toEqual([{ filename: "D:/images/a.png", size: "42" }])
  })

  test("rejects CSV without the required Filename column", () => {
    expect(() => parseEfuRecords("Path,Size\r\nD:/images/a.png,1")).toThrow("Filename")
  })
})

function utf16Le(source: string): Uint8Array {
  const bytes = new Uint8Array(2 + source.length * 2)
  bytes.set([0xff, 0xfe])
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    bytes[2 + index * 2] = code & 0xff
    bytes[3 + index * 2] = code >> 8
  }
  return bytes
}
