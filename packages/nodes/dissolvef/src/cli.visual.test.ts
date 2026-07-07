import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"

const RUN_ROOT = resolve("artifacts/test-runs/dissolvef-cli-visual")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("dissolvef CLI visual output", () => {
  test("plan subcommand renders rich summary panel without --json", async () => {
    const fixture = await createArchiveFixture("visual-plan")
    const host = createHost()
    process.exitCode = 0

    await runProgram(["plan", "--path", fixture, "--archive", "--similarityThreshold", "0"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Plan generated")
    expect(stdout).toContain("解散操作总结")
    expect(stdout).toContain("planned")
    expect(stdout).toContain("move")
  })

  test("nested subcommand visual output contains summary and operation lines", async () => {
    const fixture = await createNestedFixture("visual-nested")
    const host = createHost()
    process.exitCode = 0

    await runProgram(["nested", "--path", fixture, "--similarityThreshold", "0"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Dissolve completed")
    expect(stdout).toContain("解散操作总结")
    expect(stdout).toContain("nested")
    expect(stdout).toContain("move")
  })

  test("archive subcommand visual output marks archive mode", async () => {
    const fixture = await createArchiveFixture("visual-archive")
    const host = createHost()
    process.exitCode = 0

    await runProgram(["archive", "--path", fixture, "--similarityThreshold", "0"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Dissolve completed")
    expect(stdout).toContain("解散操作总结")
    expect(stdout).toContain("archive")
  })

  test("guided mode refusal prints scripted-use hint with xdissolvef", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    const stderr = host.stderrText()
    expect(stderr).toContain("Guided mode requires an interactive terminal")
    expect(stderr).toContain("xdissolvef plan --path <folder> --json")
  })
})

async function createNestedFixture(name: string): Promise<string> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const inner = join(root, "outer", "inner", "leaf")
  await mkdir(inner, { recursive: true })
  await writeFile(join(inner, "page.txt"), "hello", "utf8")
  cases.add(root)
  return join(root, "outer")
}

async function createArchiveFixture(name: string): Promise<string> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const folder = join(root, "book")
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, "comic.cbz"), "archive", "utf8")
  cases.add(root)
  return folder
}

function createHost(): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  return {
    cwd: process.cwd(),
    env: { ...process.env, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
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
