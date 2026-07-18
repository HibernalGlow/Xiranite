import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { DissolvefResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/dissolvef-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("dissolvef CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xdissolvef")
    expect(host.stderrText()).toContain("xdissolvef ui")
  })

  test("runs real nested dissolve and undo with pure JSON output", async () => {
    const fixture = await createNestedFixture("nested-undo")
    const runHost = createHost()

    await runProgram([
      "nested",
      "--path",
      fixture.folder,
      "--historyPath",
      fixture.historyPath,
      "--similarityThreshold",
      "0",
      "--json",
    ], runHost)

    expect(process.exitCode).toBe(0)
    expect(runHost.stdoutText().trim().startsWith("{")).toBe(true)
    expect(runHost.stderrText()).toBe("")
    const result = JSON.parse(runHost.stdoutText()) as DissolvefResult
    expect(result.success).toBe(true)
    expect(result.data?.nestedCount).toBe(1)
    expect(result.data?.successCount).toBe(2)
    expect(existsSync(join(fixture.folder, "page.txt"))).toBe(true)
    expect(existsSync(join(fixture.folder, "inner"))).toBe(false)

    const undoHost = createHost()
    await runProgram(["undo", "--historyPath", fixture.historyPath, "--json"], undoHost)

    const undo = JSON.parse(undoHost.stdoutText()) as DissolvefResult
    expect(undo.success).toBe(true)
    expect(undo.data?.successCount).toBe(2)
    expect(existsSync(fixture.deepFile)).toBe(true)
  })
})

async function createNestedFixture(name: string): Promise<{ root: string; folder: string; deepFile: string; historyPath: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const folder = join(root, "outer")
  const deepest = join(folder, "inner", "leaf")
  const deepFile = join(deepest, "page.txt")
  const historyPath = join(root, "history.json")
  await mkdir(deepest, { recursive: true })
  await writeFile(deepFile, "hello", "utf8")
  cases.add(root)
  return { root, folder, deepFile, historyPath }
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
