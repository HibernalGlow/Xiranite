import * as iconv from "iconv-lite"
import { describe, expect, test } from "vitest"
import { autoTranscodeName, decodeHashUnicodeEscapes, iconvTranscodeName } from "./platform.js"

describe("Encodeb automatic transcoding", () => {
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

  test("uses high-confidence chardet candidates without bypassing safe recoding", () => {
    const original = "繁體中文封面"
    const mojibake = iconv.decode(iconv.encode(original, "big5"), "cp437")
    let calls = 0

    const recovered = autoTranscodeName(mojibake, (bytes) => {
      calls += 1
      expect(bytes).toEqual(iconv.encode(mojibake, "cp437"))
      return [{ name: "Big5", confidence: 90 }]
    })

    expect(calls).toBe(1)
    expect(recovered).toBe(original)
  })

  test("does not inspect clean filenames", () => {
    expect(autoTranscodeName("already-normal-name.jpg", () => {
      throw new Error("clean names must not reach chardet")
    })).toBe("already-normal-name.jpg")
  })
})
