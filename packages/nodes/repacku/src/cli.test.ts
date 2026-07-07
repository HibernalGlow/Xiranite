import { afterEach, describe, expect, test } from "vitest"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { RepackuResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/repacku-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("repacku CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xrepacku compress --path <folder>")
  })

  test("runs scriptable compress dry-run as JSON against an ignored workspace fixture", async () => {
    const fixture = await createFixture("json-dry-run")
    const host = createHost()
    process.exitCode = 0

    await runProgram(["compress", "--path", fixture, "--types", "image", "--min-count", "1", "--dry-run", "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as RepackuResult
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true)
    expect(result.message).toBe("Compression plan complete: 1 operation(s).")
    expect(result.data?.plannedCount).toBe(1)
    expect(result.data?.operations[0]?.status).toBe("planned")
    expect(result.data?.operations[0]?.sourcePath.endsWith("\\book") || result.data?.operations[0]?.sourcePath.endsWith("/book")).toBe(true)
  })
})

async function createFixture(name: string): Promise<string> {
  const dir = resolve(RUN_ROOT, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const book = resolve(dir, "book")
  await mkdir(book, { recursive: true })
  await writeFile(resolve(book, "001.jpg"), new Uint8Array([1, 2, 3]))
  await writeFile(resolve(book, "002.png"), new Uint8Array([4, 5, 6]))
  cases.add(dir)
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
