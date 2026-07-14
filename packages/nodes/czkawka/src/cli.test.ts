import { describe, expect, test } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"

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
})
