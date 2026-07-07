import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { BandiaResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/bandia-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("bandia CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xbandia extract --path <archive> --dryRun --json")
  })

  test("prints pure JSON dry-run compression for a real source folder", async () => {
    const fixture = await createFixture("json-compress")
    const host = createHost()

    await runProgram([
      "compress",
      "--path",
      fixture.source,
      "--outputDir",
      fixture.output,
      "--dryRun",
      "--json",
    ], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as BandiaResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Compress complete: 1 succeeded, 0 failed.")
    expect(result.data?.compressedCount).toBe(1)
    expect(result.data?.results[0]?.archivePath).toBe(join(fixture.output, "source folder.zip"))
    expect(result.data?.results[0]?.command).toContain(fixture.output)
  })

  test("exports a real EFU file as pure JSON", async () => {
    const fixture = await createFixture("json-efu")
    const host = createHost()
    const efuPath = join(fixture.root, "out.efu")

    await runProgram(["export-efu", "--path", fixture.file, "--outputPath", efuPath, "--json"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as BandiaResult
    expect(result.success).toBe(true)
    expect(result.data?.exportedCount).toBe(1)
    expect(result.data?.efuPath).toBe(efuPath)
    const efu = await readFile(efuPath, "utf8")
    expect(efu).toContain("Filename")
    expect(efu).toContain("page.jpg")
  })
})

async function createFixture(name: string): Promise<{ root: string; source: string; output: string; file: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const source = join(root, "source folder")
  const output = join(root, "archives")
  const file = join(source, "page.jpg")
  await mkdir(source, { recursive: true })
  await mkdir(output, { recursive: true })
  await writeFile(file, "jpg", "utf8")
  cases.add(root)
  return { root, source, output, file }
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
