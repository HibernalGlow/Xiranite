import { describe, expect, test } from "vitest"
import { detectZipFilenameEncoding } from "./platform.js"

describe("SmartZip ZIP filename encoding inspection", () => {
  test("trusts explicit ZIP UTF-8 filename metadata", () => {
    const name = new TextEncoder().encode("日本語/测试.txt")
    const result = detectZipFilenameEncoding(zipWithCentralName(name, 0x0800), "unicode.zip")

    expect(result).toMatchObject({ recommendedCodePage: 65001, confidence: "certain", unicodeMetadata: true })
    expect(result.candidates[0]?.preview).toEqual(["日本語/测试.txt"])
  })

  test("recommends Shift_JIS when the filename preview contains kana", () => {
    const shiftJisName = Uint8Array.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x2e, 0x74, 0x78, 0x74]) // テスト.txt
    const result = detectZipFilenameEncoding(zipWithCentralName(shiftJisName), "legacy.zip")

    expect(result.recommendedCodePage).toBe(932)
    expect(result.candidates.find((candidate) => candidate.codePage === 932)?.preview).toEqual(["テスト.txt"])
    expect(["high", "medium", "low"]).toContain(result.confidence)
  })

  test("does not force a codepage for ASCII-only filenames", () => {
    const result = detectZipFilenameEncoding(zipWithCentralName(new TextEncoder().encode("folder/readme.txt")), "ascii.zip")

    expect(result.recommendedCodePage).toBeUndefined()
    expect(result.candidates).toEqual([])
    expect(result.confidence).toBe("certain")
  })
})

function zipWithCentralName(name: Uint8Array, flags = 0): Uint8Array {
  const central = Buffer.alloc(46 + name.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(flags, 8)
  central.writeUInt16LE(name.length, 28)
  Buffer.from(name).copy(central, 46)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(0, 16)
  return Buffer.concat([central, eocd])
}
