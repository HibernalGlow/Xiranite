import { afterEach, describe, expect, test } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { RecycleuResult } from "./core.js"

afterEach(() => {
  process.exitCode = 0
})

describe("recycleu CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xrecycleu")
    expect(host.stderrText()).toContain("--json")
  })

  test("prints pure JSON status without touching the recycle bin", async () => {
    const host = createHost()

    await runProgram(["status", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as RecycleuResult
    expect(result.success).toBe(true)
    expect(result.data?.timerStatus).toBe("idle")
    expect(result.data?.remainingSeconds).toBe(0)
  })
})

function createHost(): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  return {
    cwd: process.cwd(),
    env: { ...process.env, XIRANITE_CLI_COLUMNS: "120" },
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        stdout += chunk
        return true
      },
    },
    stderr: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        stderr += chunk
        return true
      },
    },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}
