import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { MvzResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/mvz-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("mvz CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xmvz extract --entry")
    expect(host.stderrText()).toContain("--json")
  })

  test("prints pure JSON dry-run extract plan for a real entry path", async () => {
    const fixture = await createFixture("json-extract")
    const host = createHost()

    await runProgram(["extract", "--entry", `${fixture.archive}//page/001.jpg`, "--near", "--autoDir", "--dryRun", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as MvzResult
    expect(result.success).toBe(true)
    expect(result.data?.totalArchives).toBe(1)
    expect(result.data?.preview[0]?.command).toContain("7z x")
    expect(result.data?.preview[0]?.files).toEqual(["page/001.jpg"])
  })

  test("prints pure JSON dry-run rename plan from a real entries file", async () => {
    const fixture = await createFixture("json-rename")
    const entriesFile = join(fixture.root, "entries.txt")
    await writeFile(entriesFile, `${fixture.archive}//page/001.jpg\n`, "utf8")
    const host = createHost()

    await runProgram(["rename", "--file", entriesFile, "--pattern", "^page/", "--replacement", "images/", "--dryRun", "--json"], host)

    const result = JSON.parse(host.stdoutText()) as MvzResult
    expect(result.success).toBe(true)
    expect(result.data?.preview[0]?.renames).toEqual([{ old: "page/001.jpg", next: "images/001.jpg" }])
  })
})

async function createFixture(name: string): Promise<{ root: string; archive: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const archive = join(root, "book.zip")
  await mkdir(root, { recursive: true })
  await writeFile(archive, "not a real zip for dry-run", "utf8")
  cases.add(root)
  return { root, archive }
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
