import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { KavvkaResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/kavvka-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("kavvka CLI", () => {
  test("refuses default interactive mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xkavvka")
  })

  test.each([["ui"], ["gd"], ["guided"]])("guards %s when no TTY is available", async (...args) => {
    const host = createHost()
    await runProgram(args, host)
    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("mode requires an interactive terminal")
  })

  test("prints pure JSON scan results for real keyword folders", async () => {
    const fixture = await createFixture("json-scan")
    const host = createHost()

    await runProgram(["scan", "--root", fixture.root, "--keywords", "gallery,artbook", "--depth", "2", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as KavvkaResult
    expect(result.success).toBe(true)
    expect(result.data?.matchedPaths.map((path) => path.replace(/\\/g, "/")).sort()).toEqual([
      fixture.gallery.replace(/\\/g, "/"),
      fixture.artbook.replace(/\\/g, "/"),
    ].sort())
  })

  test("processes a real artist folder and moves siblings into compare", async () => {
    const fixture = await createFixture("json-process")
    const host = createHost()

    await runProgram(["process", "--path", fixture.gallery, "--strictArtist", "--json"], host)

    const result = JSON.parse(host.stdoutText()) as KavvkaResult
    expect(result.success).toBe(true)
    expect(result.data?.movedCount).toBe(2)
    expect(existsSync(fixture.oldScan)).toBe(false)
    expect(existsSync(join(fixture.artist, "#compare", "old scan"))).toBe(true)
    expect(existsSync(join(fixture.artist, "#compare", "artbook set"))).toBe(true)
  })
})

async function createFixture(name: string): Promise<{ root: string; artist: string; gallery: string; artbook: string; oldScan: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const artist = join(root, "[artist] bundle")
  const gallery = join(artist, "gallery")
  const artbook = join(artist, "artbook set")
  const oldScan = join(artist, "old scan")
  await mkdir(gallery, { recursive: true })
  await mkdir(artbook, { recursive: true })
  await mkdir(oldScan, { recursive: true })
  await writeFile(join(oldScan, "image.txt"), "x", "utf8")
  cases.add(root)
  return { root, artist, gallery, artbook, oldScan }
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
