import { afterEach, describe, expect, test } from "vitest"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { EncodebResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/encodeb-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("encodeb CLI", () => {
  test("refuses interactive mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xencodeb")
    expect(host.stderrText()).toContain("--help")
  })

  test("prints pure JSON find results for a real suspicious filename", async () => {
    const fixture = await createFixture("json-find")
    const host = createHost()

    await runProgram(["find", "--paths", fixture.root, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as EncodebResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Find completed, 1 item(s).")
    expect(result.data?.matches).toEqual([fixture.badFile])
  })
})

async function createFixture(name: string): Promise<{ root: string; badFile: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`, "真实 encodeb")
  const badFile = join(root, "╘bad.txt")
  await mkdir(root, { recursive: true })
  await writeFile(badFile, "garbled", "utf8")
  await writeFile(join(root, "normal.txt"), "normal", "utf8")
  cases.add(root)
  return { root, badFile }
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
