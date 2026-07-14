import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test, vi } from "vitest"
import { writeFilesToClipboard } from "./fileClipboard.js"

describe("writeFilesToClipboard", () => {
  test("validates paths and passes normalized files without shell interpolation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xiranite-clipboard-"))
    const first = path.join(root, "a file.txt")
    const second = path.join(root, "quote'file.txt")
    await Promise.all([writeFile(first, "a"), writeFile(second, "b")])
    const runPowerShell = vi.fn(async () => undefined)
    try {
      await writeFilesToClipboard([first, second, first], { platform: "win32", runPowerShell })
      expect(runPowerShell).toHaveBeenCalledTimes(1)
      expect(JSON.parse(runPowerShell.mock.calls[0]![1])).toEqual([first, second])
      expect(runPowerShell.mock.calls[0]![0]).toMatch(/^[A-Za-z0-9+/=]+$/)
      const script = Buffer.from(runPowerShell.mock.calls[0]![0], "base64").toString("utf16le")
      expect(script).toContain("Clipboard]::SetFileDropList")
      expect(script).toContain("XIRANITE_CLIPBOARD_FILES")
      expect(script).not.toContain(first)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects unsupported platforms and missing paths before launching PowerShell", async () => {
    const runPowerShell = vi.fn(async () => undefined)
    await expect(writeFilesToClipboard(["missing"], { platform: "linux", runPowerShell })).rejects.toThrow("Windows only")
    await expect(writeFilesToClipboard(["missing"], { platform: "win32", runPowerShell })).rejects.toThrow("not found")
    expect(runPowerShell).not.toHaveBeenCalled()
  })
})
