import { afterEach, describe, expect, test, vi } from "vitest"
import { analyzeEfuUrl, parseEfuBytes, parseEfuText } from "./efu"

afterEach(() => vi.unstubAllGlobals())

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

  test("streams a compact analysis without retaining EFU paths", async () => {
    const source = [
      "Filename,Size,Date Modified",
      '"D:\\Pictures\\set one\\a, one.png",100,0',
      '"D:\\Pictures\\set one\\b.jpg",300,0',
      '"D:\\Pictures\\set two\\notes.txt",900,0',
      '"D:\\Pictures\\set two\\c.png",500,0',
    ].join("\r\n")
    const bytes = new TextEncoder().encode(source)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7))
        controller.close()
      },
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)))

    await expect(analyzeEfuUrl("local://list.efu")).resolves.toMatchObject({
      totalFiles: 3,
      totalSize: 900,
      minSize: 100,
      medianSize: 300,
      maxSize: 500,
      formats: [{ key: "png", count: 2, size: 600 }, { key: "jpg", count: 1, size: 300 }],
    })
  })

  test("streams UTF-16LE analysis across byte boundaries", async () => {
    const source = "Filename,Size\r\nD:/images/a.png,42\r\n"
    const bytes = new Uint8Array(2 + source.length * 2)
    bytes.set([0xff, 0xfe])
    for (let index = 0; index < source.length; index += 1) { const code = source.charCodeAt(index); bytes[2 + index * 2] = code & 0xff; bytes[3 + index * 2] = code >> 8 }
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)))
    await expect(analyzeEfuUrl("local://utf16.efu")).resolves.toMatchObject({ totalFiles: 1, totalSize: 42, formats: [{ key: "png", count: 1, size: 42 }] })
  })
})
