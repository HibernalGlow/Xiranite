import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { TrenameResult } from "./core.js"

// @xiranite-real-run trename

const RUN_ROOT = resolve("artifacts/test-runs/trename-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("trename CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("xtrename scan")
    expect(host.stderrText()).toContain("--json")
  })

  test("scans a real folder into pure JSON and writes the scan output file", async () => {
    const fixture = await createFixture("scan")
    const host = createHost()

    await runProgram(["scan", "--path", fixture.galleryRoot, "--output", fixture.scanOutput, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(existsSync(fixture.scanOutput)).toBe(true)
    const result = JSON.parse(host.stdoutText()) as TrenameResult
    expect(result.success).toBe(true)
    expect(result.data?.jsonContent).toContain("image-a.jpg")
    expect(result.data?.jsonContent).not.toContain("readme.txt")
    expect(result.data?.totalItems).toBe(2)
  })

  test("renames a real file, records history, and undoes the batch", async () => {
    const fixture = await createFixture("rename")
    const inputJson = join(fixture.root, "rename.json")
    await writeFile(inputJson, JSON.stringify({ root: [{ src: "a.jpg", tgt: "A.jpg" }] }), "utf8")

    const renameHost = createHost()
    await runProgram(["rename", "--input", inputJson, "--base", fixture.renameRoot, "--undoPath", fixture.undoPath, "--execute", "--json"], renameHost)

    const renamed = JSON.parse(renameHost.stdoutText()) as TrenameResult
    expect(renamed.success).toBe(true)
    expect(renamed.data?.successCount).toBe(1)
    expect(renamed.data?.operationId).toBeTruthy()
    await expectEntries(fixture.renameRoot, ["A.jpg"], ["a.jpg"])

    const historyHost = createHost()
    await runProgram(["history", "--undoPath", fixture.undoPath, "--json"], historyHost)
    const history = JSON.parse(historyHost.stdoutText()) as TrenameResult
    expect(history.success).toBe(true)
    expect(history.data?.history).toHaveLength(1)
    expect(history.data?.history[0]?.undone).toBe(false)

    const undoHost = createHost()
    await runProgram(["undo", "--undoPath", fixture.undoPath, "--json"], undoHost)

    const undone = JSON.parse(undoHost.stdoutText()) as TrenameResult
    expect(undone.success).toBe(true)
    expect(undone.data?.successCount).toBe(1)
    await expectEntries(fixture.renameRoot, ["a.jpg"], ["A.jpg"])
  })
})

async function createFixture(name: string): Promise<{ root: string; galleryRoot: string; renameRoot: string; scanOutput: string; undoPath: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const galleryRoot = join(root, "gallery")
  const renameRoot = join(root, "rename")
  const scanOutput = join(root, "scan.json")
  const undoPath = join(root, "trename-undo.json")
  await mkdir(galleryRoot, { recursive: true })
  await mkdir(renameRoot, { recursive: true })
  await writeFile(join(galleryRoot, "image-a.jpg"), "jpg", "utf8")
  await writeFile(join(galleryRoot, "readme.txt"), "txt", "utf8")
  await writeFile(join(renameRoot, "a.jpg"), "jpg", "utf8")
  cases.add(root)
  return { root, galleryRoot, renameRoot, scanOutput, undoPath }
}

async function expectEntries(root: string, present: string[], absent: string[]): Promise<void> {
  const entries = await readdir(root)
  for (const name of present) expect(entries).toContain(name)
  for (const name of absent) expect(entries).not.toContain(name)
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
