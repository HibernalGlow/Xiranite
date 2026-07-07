import { afterEach, describe, expect, test } from "vitest"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { CleanfResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/cleanf-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("cleanf CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("preview --help")
  })

  test("prints pure JSON preview for a real ignored fixture", async () => {
    const fixture = await createFixture("json-preview")
    const host = createHost()

    await runProgram(["preview", "--paths", fixture, "--presets", "backup_files,temp_folders", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as CleanfResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Preview completed, found 2 item(s).")
    expect(result.data?.previewFiles.some((path) => path.endsWith("old.bak"))).toBe(true)
    expect(result.data?.previewFiles.some((path) => path.endsWith("temp_cache"))).toBe(true)
  })
})

async function createFixture(name: string): Promise<string> {
  const dir = resolve(RUN_ROOT, `${name}-${randomUUID()}`, "中文 cleanf")
  await mkdir(resolve(dir, "temp_cache"), { recursive: true })
  await writeFile(resolve(dir, "old.bak"), "backup", "utf8")
  await writeFile(resolve(dir, "keep.txt"), "keep", "utf8")
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
