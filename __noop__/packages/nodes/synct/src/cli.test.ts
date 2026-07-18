import { afterEach, describe, expect, test } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"

afterEach(() => { process.exitCode = 0 })

describe("synct CLI interaction routing", () => {
  test("refuses the default UI outside an interactive terminal", async () => {
    const host = memoryHost()
    await runProgram([], host)
    expect(process.exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xsynct ui")
  })
})

function memoryHost(): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = "", stderr = ""
  return { cwd: process.cwd(), env: { ...process.env }, stdin: { isTTY: false } as CliHost["stdin"], stdout: { isTTY: false, columns: 120, write(chunk: string) { stdout += chunk; return true } }, stderr: { isTTY: false, columns: 120, write(chunk: string) { stderr += chunk; return true } }, stdoutText: () => stdout, stderrText: () => stderr }
}
