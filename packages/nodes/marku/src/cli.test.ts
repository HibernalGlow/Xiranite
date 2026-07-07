import { afterEach, describe, expect, test } from "vitest"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { MarkuResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/marku-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("marku CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("text --input '# A' --json")
  })

  test("processes inline markdown text as JSON", async () => {
    const host = createHost()

    await runProgram(["text", "--module", "markt", "--input", "# Title\n## Child", "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Text processed: changed.")
    expect(result.data?.outputText).toBe("- Title\n  - Child")
    expect(result.data?.filesChanged).toBe(1)
  })

  test("reads an input file and writes text-mode output into an ignored fixture", async () => {
    const fixture = await createFixture("file-output")
    const host = createHost()
    const input = resolve(fixture, "input.md")
    const output = resolve(fixture, "output.md")

    await runProgram(["text", "--module", "title_convert", "--inputFile", input, "--outputFile", output], host)

    expect(process.exitCode).toBe(0)
    expect(await readFile(output, "utf8")).toBe("# Messy Title\n")
    expect(host.stdoutText()).toContain("Text processed: changed.")
    expect(host.stdoutText()).toContain("# Messy Title")
  })
})

async function createFixture(name: string): Promise<string> {
  const dir = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, "input.md"), "#   Messy    Title\n", "utf8")
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
