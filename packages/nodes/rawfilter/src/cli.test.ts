import { afterEach, describe, expect, test } from "vitest"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { RawfilterResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/rawfilter-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("rawfilter CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("plan --path")
    expect(host.stderrText()).toContain("--json")
  })

  test("plans duplicate archive operations as JSON without mutating files", async () => {
    const fixture = await createFixture("json-plan")
    const host = createHost()

    await runProgram(["plan", "--path", fixture, "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as RawfilterResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Plan generated: 1 operation(s).")
    expect(result.data?.archiveCount).toBe(2)
    expect(result.data?.duplicateGroups).toBe(1)
    expect(result.data?.plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: "Game RAW.rar", destination: "trash", status: "pending" }),
      expect.objectContaining({ fileName: "Game [Chinese].zip", destination: "keep", status: "kept" }),
    ]))
  })
})

async function createFixture(name: string): Promise<string> {
  const dir = resolve(RUN_ROOT, `${name}-${randomUUID()}`, "中文 rawfilter")
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, "Game [Chinese].zip"), new Uint8Array([1, 2, 3]))
  await writeFile(resolve(dir, "Game RAW.rar"), new Uint8Array([4, 5, 6]))
  cases.add(resolve(dir, ".."))
  return dir
}

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
