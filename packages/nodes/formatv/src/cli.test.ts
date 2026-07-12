import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { FormatvResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/formatv-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("formatv CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xformatv")
    expect(host.stderrText()).toContain("xformatv ui")
  })

  test("prints pure JSON scan results for real video files", async () => {
    const fixture = await createFixture("json-scan")
    const host = createHost()

    await runProgram(["scan", "--path", fixture.root, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as FormatvResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Scan completed: 1 normal, 1 .nov.")
    expect(result.data?.normalFiles).toEqual([fixture.normal])
    expect(result.data?.novFiles).toEqual([fixture.nov])
    expect(result.data?.prefixedFiles.hb).toEqual([fixture.prefixed])
    expect(result.data?.normalCount).toBe(1)
    expect(result.data?.novCount).toBe(1)
    expect(result.data?.prefixedCounts.hb).toBe(1)
  })
})

async function createFixture(name: string): Promise<{ root: string; normal: string; nov: string; prefixed: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`, "real-formatv")
  const normal = join(root, "a.mp4")
  const nov = join(root, "b.mkv.nov")
  const prefixed = join(root, "[#hb]c.mp4")
  await mkdir(root, { recursive: true })
  await writeFile(normal, "mp4", "utf8")
  await writeFile(nov, "mkv", "utf8")
  await writeFile(prefixed, "prefixed", "utf8")
  await writeFile(join(root, "readme.txt"), "txt", "utf8")
  cases.add(resolve(root, ".."))
  return { root, normal, nov, prefixed }
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
