import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { SeriexResult } from "./core.js"

// @xiranite-real-run seriex

const RUN_ROOT = resolve("artifacts/test-runs/seriex-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("seriex CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xseriex")
    expect(host.stderrText()).toContain("plan --path")
    expect(host.stderrText()).toContain("--json")
  })

  test("prints a pure JSON plan for real series files", async () => {
    const fixture = await createFixture("plan")
    const host = createHost()

    await runProgram(["plan", "--path", fixture.root, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as SeriexResult
    expect(result.success).toBe(true)
    expect(result.data?.totalSeries).toBe(2)
    expect(result.data?.totalFiles).toBe(4)
    expect(result.data?.planItems.map((item) => item.folder).sort()).toEqual(["[#s]Alpha", "[#s]Beta"])
  })

  test("moves real files into generated series folders", async () => {
    const fixture = await createFixture("execute")
    const host = createHost()

    await runProgram(["execute", "--path", fixture.root, "--json"], host)

    const result = JSON.parse(host.stdoutText()) as SeriexResult
    expect(result.success).toBe(true)
    expect(result.data?.movedCount).toBe(4)
    expect(result.data?.failedCount).toBe(0)
    expect(existsSync(join(fixture.root, "[#s]Alpha", "Alpha 01.mp4"))).toBe(true)
    expect(existsSync(join(fixture.root, "[#s]Alpha", "Alpha 02.mp4"))).toBe(true)
    expect(existsSync(join(fixture.root, "[#s]Beta", "Beta 01.mp4"))).toBe(true)
    expect(existsSync(join(fixture.root, "[#s]Beta", "Beta 02.mp4"))).toBe(true)
  })
})

async function createFixture(name: string): Promise<{ root: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  await mkdir(root, { recursive: true })
  await writeFile(join(root, "Alpha 01.mp4"), "alpha-1", "utf8")
  await writeFile(join(root, "Alpha 02.mp4"), "alpha-2", "utf8")
  await writeFile(join(root, "Beta 01.mp4"), "beta-1", "utf8")
  await writeFile(join(root, "Beta 02.mp4"), "beta-2", "utf8")
  cases.add(root)
  return { root }
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
