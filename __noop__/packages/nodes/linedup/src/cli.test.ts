import { afterEach, describe, expect, test } from "vitest"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { LinedupFilterResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/linedup-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("linedup CLI", () => {
  test("refuses the configured UI outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xlinedup ui")
  })

  test("filters inline text and prints JSON for scripted use", async () => {
    const host = createHost()

    await runProgram(["filter", "--source", "alpha\\nbeta-one\\ngamma", "--filter", "beta", "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as LinedupFilterResult
    expect(result.filteredLines).toEqual(["alpha", "gamma"])
    expect(result.removedLines).toEqual(["beta-one"])
    expect(result.keptCount).toBe(2)
    expect(result.removedCount).toBe(1)
  })

  test("reads source/filter files and writes kept lines into an ignored fixture output", async () => {
    // @xiranite-real-run linedup
    const fixture = await createFixture("file-output")
    const host = createHost()

    await runProgram([
      "filter",
      "--sourceFile",
      resolve(fixture, "source.txt"),
      "--filterFile",
      resolve(fixture, "filter.txt"),
      "--outputFile",
      resolve(fixture, "kept.txt"),
      "--preserveOrder",
    ], host)

    expect(process.exitCode).toBe(0)
    expect(await readFile(resolve(fixture, "kept.txt"), "utf8")).toBe("gamma\nalpha\n")
    expect(host.stdoutText()).toContain("gamma\nalpha")
    expect(host.stdoutText()).toContain("kept=2 removed=2")
  })
})

async function createFixture(name: string): Promise<string> {
  const dir = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, "source.txt"), "gamma\nbeta-one\nalpha\nbeta-two\n", "utf8")
  await writeFile(resolve(dir, "filter.txt"), "beta\n", "utf8")
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
