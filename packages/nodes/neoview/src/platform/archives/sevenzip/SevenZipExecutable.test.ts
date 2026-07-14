import { describe, expect, it, vi } from "vitest"

import { parseSevenZipVersion, resolveSevenZipExecutable } from "./SevenZipExecutable.js"

describe("SevenZipExecutable resolver", () => {
  it("[neoview.sevenzip.capability] uses explicit configuration and parses the technical version banner", async () => {
    const probe = vi.fn(async () => "\n7-Zip 26.02 (x64) : Copyright\n")
    await expect(resolveSevenZipExecutable({ executablePath: "D:/tools/7z.exe", probe })).resolves.toEqual({
      path: "D:/tools/7z.exe",
      version: "26.02",
      majorVersion: 26,
    })
    expect(probe).toHaveBeenCalledWith("D:/tools/7z.exe", undefined)
  })

  it("[neoview.sevenzip.capability] skips broken PATH candidates without invoking a shell", async () => {
    const which = vi.fn(async (name: string) => name === "7zz" ? "bad-7zz" : name === "7z" ? "good-7z" : undefined)
    const probe = vi.fn(async (path: string) => {
      if (path === "bad-7zz") throw new Error("not executable")
      return "7-Zip 24.09 (x64)"
    })
    await expect(resolveSevenZipExecutable({ environment: {}, which, probe })).resolves.toMatchObject({
      path: "good-7z",
      version: "24.09",
    })
    expect(which).toHaveBeenCalledTimes(3)
  })

  it("[neoview.sevenzip.capability-errors] reports missing and invalid executables", async () => {
    await expect(resolveSevenZipExecutable({ environment: {}, which: async () => undefined })).rejects.toThrow("not found")
    await expect(resolveSevenZipExecutable({ executablePath: "broken", probe: async () => "not seven zip" }))
      .rejects.toThrow("No usable")
    expect(() => parseSevenZipVersion("7-Zip unknown")).toThrow("version banner")
  })
})
