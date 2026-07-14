import { describe, expect, test } from "vitest"
import type { EncodebEntry } from "./core.js"
import { createEncodebMappings, findSuspicious, isSuspiciousName, runEncodeb, sortReplaceMappings } from "./core.js"

const entries: EncodebEntry[] = [
  { path: "root/garbled", name: "garbled", type: "dir", rootPath: "root", relativeParts: ["garbled"], depth: 1, separator: "/" },
  { path: "root/garbled/a.txt", name: "a.txt", type: "file", rootPath: "root", relativeParts: ["garbled", "a.txt"], depth: 2, separator: "/" },
  { path: "root/╘.txt", name: "╘.txt", type: "file", rootPath: "root", relativeParts: ["╘.txt"], depth: 1, separator: "/" },
]

describe("encodeb core", () => {
  test("detects suspicious names", () => {
    expect(isSuspiciousName("╘.txt")).toBe(true)
    expect(isSuspiciousName("ã‚»ãƒ¼ãƒ©ãƒ¼.txt")).toBe(true)
    expect(isSuspiciousName("#U30BB#U30FC.txt")).toBe(true)
    expect(isSuspiciousName("正常な日本語.txt")).toBe(false)
    expect(findSuspicious(entries).map((entry) => entry.path)).toEqual(["root/╘.txt"])
  })

  test("creates changed mappings with injected transcoder", () => {
    const mappings = createEncodebMappings(entries, { srcEncoding: "x", dstEncoding: "y", transform: "recode", limit: 10 }, (name) => name.replace("garbled", "fixed"))

    expect(mappings).toEqual([
      { src: "root/garbled", dst: "root/fixed", type: "dir", depth: 1 },
      { src: "root/garbled/a.txt", dst: "root/fixed/a.txt", type: "file", depth: 2 },
    ])
  })

  test("sorts replace mappings deepest first", () => {
    const mappings = createEncodebMappings(entries, { srcEncoding: "x", dstEncoding: "y", transform: "recode", limit: 10 }, (name) => name.replace("garbled", "fixed"))
    expect(sortReplaceMappings(mappings)[0]?.src).toBe("root/garbled/a.txt")
  })

  test("runs preview through runtime transcoder", async () => {
    const result = await runEncodeb(
      { action: "preview", paths: ["root"] },
      {
        scanPath: async () => entries,
        recoverPath: async () => "root",
        transcodeName: (name) => name.replace("garbled", "fixed"),
      },
    )

    expect(result.success).toBe(true)
    expect(result.data?.mappings).toHaveLength(2)
  })
})
