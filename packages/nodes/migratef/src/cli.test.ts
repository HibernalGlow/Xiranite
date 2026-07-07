import { afterEach, describe, expect, test } from "vitest"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { MigratefResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/migratef-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("migratef CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xmigratef")
    expect(host.stderrText()).toContain("--json")
  })

  test("prints pure JSON plan for a real unicode fixture", async () => {
    const fixture = await createFixture("json-plan")
    const host = createHost()

    await runProgram([
      "plan",
      "--source",
      fixture.sourceRoot,
      "--target",
      fixture.targetRoot,
      "--mode",
      "flat",
      "--json",
    ], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as MigratefResult
    expect(result.success).toBe(true)
    expect(result.data?.plan).toEqual([expect.objectContaining({
      sourcePath: join(fixture.sourceRoot, "一号.txt"),
      targetPath: join(fixture.targetRoot, "一号.txt"),
      action: "move",
      status: "pending",
    })])
  })

  test("copies real files, records history, and undoes the copied target inside ignored fixtures", async () => {
    const fixture = await createFixture("copy-undo")
    const copyHost = createHost()

    await runProgram([
      "copy",
      "--source",
      fixture.sourceFile,
      "--target",
      fixture.targetRoot,
      "--mode",
      "direct",
      "--historyPath",
      fixture.historyPath,
      "--json",
    ], copyHost)

    const copyResult = JSON.parse(copyHost.stdoutText()) as MigratefResult
    expect(process.exitCode).toBe(0)
    expect(copyResult.success).toBe(true)
    expect(copyResult.data?.migratedCount).toBe(1)
    expect(await readFile(join(fixture.targetRoot, "一号.txt"), "utf8")).toBe("alpha")

    const historyHost = createHost()
    await runProgram(["history", "--historyPath", fixture.historyPath, "--json"], historyHost)
    const historyResult = JSON.parse(historyHost.stdoutText()) as MigratefResult
    expect(historyResult.success).toBe(true)
    expect(historyResult.data?.history).toHaveLength(1)

    const undoHost = createHost()
    await runProgram(["undo", "--historyPath", fixture.historyPath, "--json"], undoHost)
    const undoResult = JSON.parse(undoHost.stdoutText()) as MigratefResult
    expect(undoResult.success).toBe(true)
    await expect(stat(join(fixture.targetRoot, "一号.txt"))).rejects.toThrow()
  })
})

async function createFixture(name: string): Promise<{
  root: string
  sourceRoot: string
  sourceFile: string
  targetRoot: string
  historyPath: string
}> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`, "真实 migratef")
  const sourceRoot = join(root, "source")
  const targetRoot = join(root, "target")
  const historyPath = join(root, "history.json")
  const sourceFile = join(sourceRoot, "一号.txt")
  await mkdir(sourceRoot, { recursive: true })
  await mkdir(targetRoot, { recursive: true })
  await writeFile(sourceFile, "alpha", "utf8")
  cases.add(root)
  return { root, sourceRoot, sourceFile, targetRoot, historyPath }
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
