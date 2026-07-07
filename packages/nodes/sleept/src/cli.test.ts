import { afterEach, describe, expect, test } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { SleeptResult } from "./core.js"

afterEach(() => {
  process.exitCode = 0
})

describe("sleept CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xsleept")
    expect(host.stderrText()).toContain("--json")
  })

  test("prints system stats as JSON for scripted use", async () => {
    const host = createHost()

    await runProgram(["status", "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as SleeptResult
    expect(result.success).toBe(true)
    expect(result.message).toContain("CPU:")
    expect(result.data?.timerStatus).toBe("idle")
    expect(typeof result.data?.currentCpu).toBe("number")
  }, 20_000)

  test("runs a short countdown dry-run as JSON", async () => {
    const host = createHost()

    await runProgram(["countdown", "--seconds", "1", "--dryrun", "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as SleeptResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("[dryrun] Countdown completed; simulated sleep.")
    expect(result.data?.timerStatus).toBe("completed")
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
