import { describe, expect, it } from "vitest"

import { parseSevenZipSlt } from "./sevenzip-slt.js"

describe("parseSevenZipSlt", () => {
  it("[neoview.sevenzip.index] parses Unicode entry metadata and archive solid state", () => {
    const index = parseSevenZipSlt(listing([
      entry("pages/第一话.jpg", { size: "5", packed: "4", crc: "470B99F4", method: "LZMA2:12", block: "0" }),
      entry("pages/002.jpg", { size: "3", packed: "", crc: "55BC801D", method: "LZMA2:12", block: "0", encrypted: "+" }),
      entry("empty", { folder: "+", attributes: "D", size: "0", packed: "0" }),
    ], "7z", "+"))
    expect(index).toMatchObject({ archiveType: "7z", solid: true })
    expect(index.entries).toEqual([
      expect.objectContaining({ path: "pages/第一话.jpg", kind: "file", uncompressedSize: 5, compressedSize: 4, crc32: 0x470b99f4, encrypted: false }),
      expect.objectContaining({ path: "pages/002.jpg", kind: "file", uncompressedSize: 3, compressedSize: undefined, encrypted: true }),
      expect.objectContaining({ path: "empty", kind: "directory", uncompressedSize: 0 }),
    ])
  })

  it("[neoview.sevenzip.index] derives solid blocks when archive metadata omits Solid", () => {
    const index = parseSevenZipSlt(listing([
      entry("a.jpg", { size: "1", block: "3" }),
      entry("b.jpg", { size: "1", block: "3" }),
    ], "Rar", undefined))
    expect(index.solid).toBe(true)
  })

  it("[neoview.sevenzip.security] rejects traversal, duplicates, malformed CRC and unsafe sizes", () => {
    expect(() => parseSevenZipSlt(listing([entry("../escape.jpg", { size: "1" })]))).toThrow("Unsafe")
    expect(() => parseSevenZipSlt(listing([entry("a.jpg", { size: "1" }), entry("./a.jpg", { size: "1" })]))).toThrow("Duplicate")
    expect(() => parseSevenZipSlt(listing([entry("a.jpg", { size: "1", crc: "bad" })]))).toThrow("CRC")
    expect(() => parseSevenZipSlt(listing([entry("a.jpg", { size: String(9 * 1024 ** 3) })]))).toThrow("size limit")
  })

  it("[neoview.sevenzip.index-errors] rejects output without a technical separator or required fields", () => {
    expect(() => parseSevenZipSlt("not a technical listing")).toThrow("separator")
    expect(() => parseSevenZipSlt(listing(["Size = 1\n"]))).toThrow("missing Path")
  })
})

function listing(records: string[], type = "7z", solid: string | undefined = "-"): string {
  return [
    "7-Zip 26.02 (x64)",
    "",
    "Path = fixture.7z",
    `Type = ${type}`,
    ...(solid === undefined ? [] : [`Solid = ${solid}`]),
    "Blocks = 1",
    "",
    "----------",
    ...records,
  ].join("\n")
}

function entry(path: string, options: {
  size?: string
  packed?: string
  crc?: string
  method?: string
  block?: string
  encrypted?: string
  folder?: string
  attributes?: string
} = {}): string {
  return [
    `Path = ${path}`,
    `Folder = ${options.folder ?? "-"}`,
    `Size = ${options.size ?? "0"}`,
    `Packed Size = ${options.packed ?? options.size ?? "0"}`,
    "Modified = 2024-01-02 03:04:06",
    `Attributes = ${options.attributes ?? "A"}`,
    `CRC = ${options.crc ?? ""}`,
    `Encrypted = ${options.encrypted ?? "-"}`,
    `Method = ${options.method ?? "LZMA2:12"}`,
    `Block = ${options.block ?? "0"}`,
    "",
  ].join("\n")
}
