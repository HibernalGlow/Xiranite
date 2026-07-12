import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { MoveaResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/movea-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("movea CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xmovea")
    expect(host.stderrText()).toContain("xmovea ui")
  })

  test("prints pure JSON scan results for real folders", async () => {
    const fixture = await createFixture("json-scan")
    const host = createHost()

    await runProgram(["scan", "--path", fixture.root, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as MoveaResult
    expect(result.success).toBe(true)
    expect(result.data?.totalFolders).toBe(1)
    expect(result.data?.scanResults.artist?.archives).toEqual(["book.zip"])
    expect(result.data?.scanResults.artist?.movableFolders).toEqual(["loose"])
  })

  test("moves real archive and loose folder according to JSON plan", async () => {
    const fixture = await createFixture("json-move")
    const host = createHost()
    const plan = JSON.stringify({ "book.zip": "1. doujinshi", "folder_loose": "1. doujinshi" })

    await runProgram(["move", "--path", fixture.root, "--level1", "artist", "--plan", plan, "--json"], host)

    const result = JSON.parse(host.stdoutText()) as MoveaResult
    expect(result.success).toBe(true)
    expect(result.data?.moveSuccess).toBe(2)
    expect(existsSync(join(fixture.artist, "book.zip"))).toBe(false)
    expect(existsSync(join(fixture.artist, "1. doujinshi", "book.zip"))).toBe(true)
    expect(existsSync(join(fixture.artist, "1. doujinshi", "loose", "note.txt"))).toBe(true)
  })
})

async function createFixture(name: string): Promise<{ root: string; artist: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const artist = join(root, "artist")
  await mkdir(join(artist, "1. doujinshi"), { recursive: true })
  await mkdir(join(artist, "loose"), { recursive: true })
  await writeFile(join(artist, "book.zip"), "zip", "utf8")
  await writeFile(join(artist, "loose", "note.txt"), "note", "utf8")
  cases.add(root)
  return { root, artist }
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
