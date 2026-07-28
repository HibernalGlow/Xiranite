import { win32 } from "node:path"
import { describe, expect, test } from "vitest"
import { createDirectorySourcePolicy } from "./source-discovery.js"

describe("XLchemy directory source policy", () => {
  test("excludes the configured output subtree across equivalent Windows path spellings", () => {
    const policy = createDirectorySourcePolicy({
      action: "convert",
      outputMode: "directory",
      outputDir: "d:/images/output/",
      sourceRoots: ["D:\\images"],
      generatedExtensions: [".avif"],
      extname: win32.extname,
      relative: win32.relative,
    })

    expect(policy.traversesDirectory("D:\\images\\output")).toBe(false)
    expect(policy.traversesDirectory("D:\\images\\output\\nested")).toBe(false)
    expect(policy.traversesDirectory("D:\\images\\other")).toBe(true)
  })
})
