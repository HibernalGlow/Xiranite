import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import { dumpLinkRecords, type LinkuResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/linku-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("linku CLI", () => {
  test("refuses the configured UI outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xlinku ui")
  })

  test("prints pure JSON info for a real file", async () => {
    const fixture = await createFixture("json-info")
    const host = createHost()

    await runProgram(["info", "--path", fixture.file, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as LinkuResult
    expect(result.success).toBe(true)
    expect(result.data?.pathInfo?.kind).toBe("file")
    expect(result.data?.pathInfo?.exists).toBe(true)
  })

  test("creates a real directory symlink record and lists it as pure JSON", async () => {
    const fixture = await createFixture("json-create")
    const createRunHost = createHost()

    await runProgram(["create", "--path", fixture.source, "--target", fixture.link, "--configPath", fixture.config, "--json"], createRunHost)

    const create = JSON.parse(createRunHost.stdoutText()) as LinkuResult
    expect(create.success).toBe(true)
    expect(create.data?.created).toBe(true)
    expect(existsSync(fixture.link)).toBe(true)
    expect((await lstat(fixture.link)).isSymbolicLink()).toBe(true)

    const listHost = createHost()
    await runProgram(["list", "--configPath", fixture.config, "--json"], listHost)

    const list = JSON.parse(listHost.stdoutText()) as LinkuResult
    expect(list.success).toBe(true)
    expect(list.data?.links).toHaveLength(1)
    expect(list.data?.links[0]?.link).toBe(fixture.link)
    expect(list.data?.links[0]?.target).toBe(fixture.source)
  })

  test("imports only real legacy links by default", async () => {
    const fixture = await createFixture("legacy-import")
    await symlink(fixture.source, fixture.link, process.platform === "win32" ? "junction" : "dir")
    await writeFile(fixture.legacyConfig, dumpLinkRecords([
      { link: fixture.link, target: fixture.source, type: "directory", createdAt: "valid" },
      { link: join(fixture.root, "missing-link"), target: join(fixture.root, "missing-target"), type: "directory", createdAt: "invalid" },
    ]), "utf8")
    const host = createHost()

    await runProgram(["import", "--path", fixture.legacyConfig, "--configPath", fixture.config, "--json"], host)

    const result = JSON.parse(host.stdoutText()) as LinkuResult
    expect(result.success).toBe(true)
    expect(result.data?.importedCount).toBe(1)
    expect(result.data?.skippedCount).toBe(1)

    const listHost = createHost()
    await runProgram(["list", "--configPath", fixture.config, "--json"], listHost)
    const list = JSON.parse(listHost.stdoutText()) as LinkuResult
    expect(list.data?.links).toEqual([
      expect.objectContaining({ link: fixture.link, target: fixture.source }),
    ])
  })

  test("imports invalid legacy records when --includeInvalid is set", async () => {
    const fixture = await createFixture("legacy-import-invalid")
    const missing = { link: join(fixture.root, "missing-link"), target: join(fixture.root, "missing-target"), type: "directory", createdAt: "invalid" }
    await writeFile(fixture.legacyConfig, dumpLinkRecords([missing]), "utf8")
    const host = createHost()

    await runProgram(["import", "--path", fixture.legacyConfig, "--configPath", fixture.config, "--includeInvalid", "--json"], host)

    const result = JSON.parse(host.stdoutText()) as LinkuResult
    expect(result.success).toBe(true)
    expect(result.data?.importedCount).toBe(1)
    expect(result.data?.skippedCount).toBe(0)
  })
})

async function createFixture(name: string): Promise<{ root: string; source: string; link: string; config: string; legacyConfig: string; file: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const source = join(root, "source")
  const link = join(root, "linked")
  const config = join(root, "linku.toml")
  const legacyConfig = join(root, "legacy-linku.toml")
  const file = join(source, "file.txt")
  await mkdir(source, { recursive: true })
  await writeFile(file, "hello", "utf8")
  cases.add(root)
  return { root, source, link, config, legacyConfig, file }
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
