import { describe, expect, test } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"

describe("czkawka CLI", () => {
  test("prints usage without loading the native binding", async () => {
    let output = ""
    const sink = { write: (chunk: unknown) => { output += String(chunk); return true } }
    const host = { cwd: process.cwd(), env: {}, stdin: { isTTY: true }, stdout: sink, stderr: sink } as unknown as CliHost
    await runProgram([], host)
    expect(output).toContain("czkawka")
    expect(output).toContain("--help")
  })
})
