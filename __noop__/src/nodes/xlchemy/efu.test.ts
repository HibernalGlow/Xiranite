import { describe, expect, test } from "vitest"
import { parseEfuBytes, parseEfuText } from "./efu"

describe("Everything EFU parser", () => {
  test("parses quoted paths and commas with the CSV parser", () => {
    const text = [
      "Filename,Size,Date Modified,Attributes",
      '"D:\\Pictures\\a, one.png",123,0,32',
      '"D:\\Pictures\\b.png",456,0,32',
    ].join("\r\n")
    expect(parseEfuText(text)).toEqual(["D:\\Pictures\\a, one.png", "D:\\Pictures\\b.png"])
  })

  test("decodes Everything UTF-16LE exports", () => {
    const source = "Filename,Size\r\nD:/images/a.png,1\r\n"
    const utf16 = new Uint8Array(2 + source.length * 2)
    utf16[0] = 0xff; utf16[1] = 0xfe
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index)
      utf16[2 + index * 2] = code & 0xff
      utf16[3 + index * 2] = code >> 8
    }
    expect(parseEfuBytes(utf16)).toEqual(["D:/images/a.png"])
  })

  test("rejects non-EFU CSV files without Filename", () => {
    expect(() => parseEfuText("path,size\r\nD:/images/a.png,1")).toThrow("Filename")
  })
})
