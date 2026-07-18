import { describe, expect, it, vi } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseSevenZipVersion, resolveSevenZipExecutable, runSevenZipTextCommand } from "./SevenZipExecutable.js"

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

  it("[neoview.sevenzip.password-stdin] sends bounded password bytes only through stdin", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xiranite-sevenzip-stdin-"))
    const script = join(directory, "capture-password.mjs")
    await writeFile(script, `
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), stdin: Buffer.concat(chunks).toString("utf8") }))
`)
    try {
      const password = new TextEncoder().encode("fixture-secret")
      const result = await runSevenZipTextCommand(process.execPath, [script, "probe"], { password })
      expect(JSON.parse(result.stdout)).toEqual({ argv: ["probe"], stdin: "fixture-secret\n" })
      expect(password).toEqual(new TextEncoder().encode("fixture-secret"))
      await expect(runSevenZipTextCommand(process.execPath, [script], {
        password: new TextEncoder().encode("unsafe\npassword"),
      })).rejects.toThrow("NUL, CR, or LF")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
