import { describe, expect, test } from "vitest"
import * as iconv from "iconv-lite"
import { autoTranscodeName, decodeHashUnicodeEscapes, iconvTranscodeName } from "./platform.js"

describe("encodeb platform transcoders", () => {
  test("repairs Latin-1 UTF-8 mojibake", () => {
    expect(iconvTranscodeName("ã‚»ãƒ¼ãƒ©ãƒ¼ãƒ ãƒ¼ãƒ³.txt", "windows-1252", "utf8")).toBe("セーラームーン.txt")
  })

  test("does not corrupt characters missing from the source encoding", () => {
    expect(iconvTranscodeName("正常中文.txt", "cp437", "cp936")).toBe("正常中文.txt")
    expect(iconvTranscodeName("正常な日本語.txt", "cp936", "cp932")).toBe("正常な日本語.txt")
  })

  test("decodes hash-U escapes and preserves invalid code points", () => {
    expect(decodeHashUnicodeEscapes("#U30BB#U30FC#U30E9#U30FC.txt")).toBe("セーラー.txt")
    expect(decodeHashUnicodeEscapes("#U110000.txt")).toBe("#U110000.txt")
  })

  test("normalizes the Japanese middle dot", () => {
    expect(iconvTranscodeName("魔法・少女.txt", "U+30FB", "U+00B7", "normalize-middle-dot")).toBe("魔法·少女.txt")
  })

  test("auto-detects explicit and Latin-1 mojibake", () => {
    expect(autoTranscodeName("#U30BB#U30FC#U30E9#U30FC.txt")).toBe("セーラー.txt")
    expect(autoTranscodeName("ã‚»ãƒ¼ãƒ©ãƒ¼ãƒ ãƒ¼ãƒ³.txt")).toBe("セーラームーン.txt")
  })

  test("auto-detects CP437 archive mojibake and leaves normal names alone", () => {
    const samples = [
      ["中文资料.txt", "cp936"],
      ["テスト.txt", "cp932"],
      ["한글자료.txt", "cp949"],
    ] as const
    for (const [expected, encoding] of samples) {
      const garbled = iconv.decode(iconv.encode(expected, encoding), "cp437")
      expect(autoTranscodeName(garbled)).toBe(expected)
    }
    expect(autoTranscodeName("正常な日本語.txt")).toBe("正常な日本語.txt")
    expect(autoTranscodeName("normal-file.txt")).toBe("normal-file.txt")
  })
})
