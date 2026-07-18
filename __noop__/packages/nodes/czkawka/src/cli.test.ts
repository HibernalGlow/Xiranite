import { describe, expect, test } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { formatCzkawkaPipeResult, runProgram } from "./cli.js"

// @xiranite-real-run czkawka — scripts/smoke-cli.mjs executes duplicate, basic, and media scans through the built pipe CLI and release Node-API.

describe("czkawka CLI", () => {
  test("prints usage without loading the native binding", async () => {
    let output = ""
    const sink = { write: (chunk: unknown) => { output += String(chunk); return true } }
    const host = { cwd: process.cwd(), env: {}, stdin: { isTTY: true }, stdout: sink, stderr: sink } as unknown as CliHost
    await runProgram([], host)
    expect(output).toContain("czkawka")
    expect(output).toContain("--help")
  })

  test("rejects an invalid operation tool instead of dropping safety semantics", async () => {
    const sink = { write: () => true }
    const host = { cwd: process.cwd(), env: {}, stdin: { isTTY: true }, stdout: sink, stderr: sink } as unknown as CliHost
    await expect(runProgram(["delete", "D:/empty", "--tool", "empty-folder", "--json"], host)).rejects.toThrow("Unsupported Czkawka tool")
  })

  test("formats pipe scan results in the requested language", () => {
    const result = { success: true, message: "raw core message", data: { action: "scan" as const, tool: "similar-images" as const, groups: [], entries: [], messages: "", stopped: false, groupCount: 0, fileCount: 0, totalBytes: 0, reclaimableBytes: 0, affectedCount: 0, errorCount: 0, similarFolders: [] } }
    expect(formatCzkawkaPipeResult(result, "zh")).toEqual(["找到 0 项，共 0 组。", "格式: 无", "相似文件夹: 无"])
    expect(formatCzkawkaPipeResult(result, "en")).toEqual(["Found 0 item(s) in 0 group(s).", "Formats: none", "Similar folders: none"])
  })
})
