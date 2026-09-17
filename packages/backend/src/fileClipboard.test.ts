import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test, vi } from "vitest"
import { clearFileClipboard, readFilesFromClipboard, writeFilesToClipboard, type ClipboardCommandRunner } from "./fileClipboard.js"

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
      expect(runPowerShell.mock.calls[0]![2]).toBe("copy")
      expect(runPowerShell.mock.calls[0]![0]).toMatch(/^[A-Za-z0-9+/=]+$/)
      const script = Buffer.from(runPowerShell.mock.calls[0]![0], "base64").toString("utf16le")
      expect(script).toContain("$data.SetFileDropList")
      expect(script).toContain("Preferred DropEffect")
      expect(script).toContain("Clipboard]::SetDataObject")
      expect(script).toContain("XIRANITE_CLIPBOARD_FILES")
      expect(script).not.toContain(first)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("marks cut files with the Windows move drop effect", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xiranite-clipboard-move-"))
    const file = path.join(root, "move.txt")
    await writeFile(file, "move")
    const runPowerShell = vi.fn(async () => undefined)
    try {
      await writeFilesToClipboard([file], { platform: "win32", effect: "move", runPowerShell })
      expect(runPowerShell).toHaveBeenCalledWith(expect.any(String), JSON.stringify([file]), "move")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects unsupported platforms and missing paths before launching a clipboard tool", async () => {
    const runPowerShell = vi.fn(async () => undefined)
    await expect(writeFilesToClipboard(["missing"], { platform: "freebsd" as NodeJS.Platform, runPowerShell })).rejects.toThrow("not implemented")
    await expect(writeFilesToClipboard(["missing"], { platform: "win32", runPowerShell })).rejects.toThrow("not found")
    expect(runPowerShell).not.toHaveBeenCalled()
  })
})

describe("readFilesFromClipboard", () => {
  test("decodes a bounded native file list without exposing script input", async () => {
    const runPowerShell = vi.fn(async (encodedCommand: string) => {
      const script = Buffer.from(encodedCommand, "base64").toString("utf16le")
      expect(script).toContain("Clipboard]::GetFileDropList")
      expect(script).toContain("Preferred DropEffect")
      expect(script).toContain("ToBase64String")
      return Buffer.from(JSON.stringify({
        paths: ["D:/Media/a.jpg", "D:/Media/a.jpg", "D:/Media/b.jpg"],
        effect: "move",
      }), "utf8").toString("base64")
    })

    await expect(readFilesFromClipboard({ platform: "win32", runPowerShell })).resolves.toEqual({
      paths: ["D:/Media/a.jpg", "D:/Media/b.jpg"],
      effect: "move",
    })
    expect(runPowerShell).toHaveBeenCalledTimes(1)
  })

  test("rejects unsupported platforms and malformed native output", async () => {
    const runPowerShell = vi.fn(async () => "not-base64")
    await expect(readFilesFromClipboard({ platform: "freebsd" as NodeJS.Platform, runPowerShell })).rejects.toThrow("not implemented")
    await expect(readFilesFromClipboard({ platform: "win32", runPowerShell })).rejects.toThrow("invalid output")
    expect(runPowerShell).toHaveBeenCalledTimes(1)
  })
})

describe("clearFileClipboard", () => {
  test("uses the STA clipboard clear command", async () => {
    const runPowerShell = vi.fn(async (encodedCommand: string) => {
      const script = Buffer.from(encodedCommand, "base64").toString("utf16le")
      expect(script).toContain("Clipboard]::Clear")
      return ""
    })
    await expect(clearFileClipboard({ platform: "win32", runPowerShell })).resolves.toBeUndefined()
    await expect(clearFileClipboard({ platform: "freebsd" as NodeJS.Platform, runPowerShell })).rejects.toThrow("not implemented")
    expect(runPowerShell).toHaveBeenCalledTimes(1)
  })
})

describe("macOS clipboard", () => {
  test("writes the file list through osascript without interpolating paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xiranite-clipboard-mac-"))
    const file = path.join(root, "a file.txt")
    await writeFile(file, "a")
    const runCommand = vi.fn<ClipboardCommandRunner>(async () => ({ code: 0, stdout: "" }))
    try {
      await writeFilesToClipboard([file], { platform: "darwin", runCommand })
      expect(runCommand).toHaveBeenCalledTimes(1)
      const invocation = runCommand.mock.calls[0]![0]
      expect(invocation.command).toBe("osascript")
      expect(invocation.args.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"])
      expect(JSON.parse(invocation.env!.XIRANITE_CLIPBOARD_FILES!)).toEqual([file])
      expect(invocation.args.join("\n")).not.toContain(file)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("reads and decodes file-url items, defaulting to copy", async () => {
    const runCommand = vi.fn<ClipboardCommandRunner>(async () => ({ code: 0, stdout: "file:///tmp/a%20file.jpg\nfile:///tmp/b.jpg\n" }))
    await expect(readFilesFromClipboard({ platform: "darwin", runCommand })).resolves.toEqual({
      paths: ["/tmp/a file.jpg", "/tmp/b.jpg"],
      effect: "copy",
    })
  })

  test("clears through the pasteboard", async () => {
    const runCommand = vi.fn<ClipboardCommandRunner>(async () => ({ code: 0, stdout: "" }))
    await expect(clearFileClipboard({ platform: "darwin", runCommand })).resolves.toBeUndefined()
    expect(runCommand.mock.calls[0]![0].args.join(" ")).toContain("clearContents")
  })
})

describe("Linux clipboard", () => {
  const has = (name: string) => (candidate: string) => candidate === name

  test("writes a text/uri-list through wl-copy when available", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xiranite-clipboard-linux-"))
    const file = path.join(root, "a file.txt")
    await writeFile(file, "a")
    const runCommand = vi.fn<ClipboardCommandRunner>(async () => ({ code: 0, stdout: "" }))
    try {
      await writeFilesToClipboard([file], { platform: "linux", runCommand, isExecutableOnPath: has("wl-copy") })
      const invocation = runCommand.mock.calls[0]![0]
      expect(invocation.command).toBe("wl-copy")
      expect(invocation.args).toEqual(["--type", "text/uri-list"])
      expect(invocation.inputData).toContain("file://")
      expect(invocation.inputData).toContain("a%20file.txt")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("falls back to xclip and reads its uri list", async () => {
    const runCommand = vi.fn<ClipboardCommandRunner>(async () => ({ code: 0, stdout: "file:///tmp/a%20file.jpg\r\nfile:///tmp/b.jpg\r\n" }))
    await expect(readFilesFromClipboard({ platform: "linux", runCommand, isExecutableOnPath: has("xclip") })).resolves.toEqual({
      paths: ["/tmp/a file.jpg", "/tmp/b.jpg"],
      effect: "copy",
    })
    expect(runCommand.mock.calls[0]![0].command).toBe("xclip")
  })

  test("reports unavailable tooling clearly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xiranite-clipboard-linux-none-"))
    const file = path.join(root, "a.txt")
    await writeFile(file, "a")
    const runCommand = vi.fn<ClipboardCommandRunner>(async () => ({ code: 0, stdout: "" }))
    try {
      await expect(writeFilesToClipboard([file], { platform: "linux", runCommand, isExecutableOnPath: () => false }))
        .rejects.toThrow("wl-copy or xclip")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
