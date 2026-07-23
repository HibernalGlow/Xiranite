import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { parseCsvLine, streamEfuPaths } from "./efu-stream.js"

describe("streaming EFU reader", () => {
  test("parses quoted CSV fields without loading the complete file", async () => {
    const root = await mkdtemp(join(tmpdir(), "xlchemy-efu-"))
    const path = join(root, "quoted.efu")
    try {
      await writeFile(path, ['Filename,Size', '"D:\\Images\\a, one.png",123', '"D:\\Images\\quote""name.jpg",456'].join("\r\n"))
      const paths: string[] = []
      for await (const item of streamEfuPaths(path)) paths.push(item)
      expect(paths).toEqual(["D:\\Images\\a, one.png", 'D:\\Images\\quote"name.jpg'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("decodes UTF-16LE Everything exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "xlchemy-efu-"))
    const path = join(root, "utf16.efu")
    try {
      await writeFile(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Filename,Size\r\nD:/images/a.png,1\r\n", "utf16le")]))
      const paths: string[] = []
      for await (const item of streamEfuPaths(path)) paths.push(item)
      expect(paths).toEqual(["D:/images/a.png"])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("handles escaped quotes", () => {
    expect(parseCsvLine('"a""b,c",2')).toEqual(['a"b,c', "2"])
  })
})
