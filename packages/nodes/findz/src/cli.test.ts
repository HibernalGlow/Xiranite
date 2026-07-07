import { afterEach, describe, expect, test } from "vitest"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { FindzResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/findz-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("findz CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xfindz")
    expect(host.stderrText()).toContain("--json")
  })

  test("prints pure JSON search results for real files", async () => {
    const fixture = await createFixture("json-search")
    const host = createHost()

    await runProgram([
      "search",
      "--path",
      fixture.root,
      "--where",
      'ext IN ("jpg", "png")',
      "--noArchive",
      "--json",
    ], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as FindzResult
    expect(result.success).toBe(true)
    expect(result.data?.totalCount).toBe(2)
    expect(result.data?.files.map((file) => file.name).sort()).toEqual(["a.jpg", "c.png"])
  })
})

async function createFixture(name: string): Promise<{ root: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`, "真实 findz")
  await mkdir(root, { recursive: true })
  await writeFile(join(root, "a.jpg"), "jpg", "utf8")
  await writeFile(join(root, "b.txt"), "txt", "utf8")
  await writeFile(join(root, "c.png"), "png", "utf8")
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
