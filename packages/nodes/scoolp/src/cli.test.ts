import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { ScoolpResult } from "./core.js"

// @xiranite-real-run scoolp

const RUN_ROOT = resolve("artifacts/test-runs/scoolp-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("scoolp CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("status --help")
  })

  test("prints pure JSON package list and info from a real local bucket", async () => {
    const fixture = await createFixture("bucket")
    const host = createHost()

    await runProgram(["list", "--bucketPath", fixture.bucketRoot, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const list = JSON.parse(host.stdoutText()) as ScoolpResult
    expect(list.success).toBe(true)
    expect(list.data?.availablePackages).toEqual([expect.objectContaining({
      name: "demo",
      version: "1.0.0",
      description: "Demo package",
    })])

    const infoHost = createHost()
    await runProgram(["info", "--bucketPath", fixture.bucketRoot, "--package", "demo", "--json"], infoHost)

    const info = JSON.parse(infoHost.stdoutText()) as ScoolpResult
    expect(info.success).toBe(true)
    expect(info.data?.packageInfo).toEqual(expect.objectContaining({
      name: "demo",
      version: "1.0.0",
      homepage: "https://example.test/demo",
    }))
  })

  test("dry-runs sync from a real TOML config without progress pollution", async () => {
    const fixture = await createFixture("sync")
    const host = createHost()

    await runProgram(["sync", "--config", fixture.configPath, "--dryRun", "--json"], host)

    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as ScoolpResult
    expect(result.success).toBe(true)
    expect(result.data?.syncConfig?.root).toBe(fixture.scoopRoot.replace(/\\/g, "/"))
    expect(result.data?.syncPlan.some((item) => item.label === "add bucket main")).toBe(true)
  })

  test("moves obsolete cache files into a real backup folder", async () => {
    const fixture = await createFixture("cache")
    const host = createHost()

    await runProgram(["cache-backup", "--path", fixture.cachePath, "--json"], host)

    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as ScoolpResult
    expect(result.success).toBe(true)
    expect(result.data?.cleanedCount).toBe(1)
    expect(result.data?.cache?.obsoleteCount).toBe(1)
    expect(existsSync(join(fixture.cachePath, "demo#1.0#old"))).toBe(false)
    const backupPath = result.data?.cache?.backupPath
    expect(backupPath).toBeTruthy()
    expect(existsSync(join(backupPath!, "demo#1.0#old"))).toBe(true)
  })
})

async function createFixture(name: string): Promise<{ root: string; bucketRoot: string; cachePath: string; configPath: string; scoopRoot: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const bucketRoot = join(root, "bucket-fixture")
  const bucketDir = join(bucketRoot, "bucket")
  const cachePath = join(root, "cache")
  const scoopRoot = join(root, "scoop").replace(/\\/g, "/")
  const configPath = join(root, "scoop.toml")
  await mkdir(bucketDir, { recursive: true })
  await mkdir(cachePath, { recursive: true })
  await writeFile(join(bucketDir, "demo.json"), JSON.stringify({
    version: "1.0.0",
    description: "Demo package",
    homepage: "https://example.test/demo",
    license: "MIT",
    bin: "demo.exe",
  }), "utf8")
  await writeFile(join(cachePath, "demo#1.0#old"), "old", "utf8")
  await writeFile(join(cachePath, "demo#2.0#new"), "new", "utf8")
  await writeFile(join(cachePath, "other#1.0#new"), "other", "utf8")
  await writeFile(configPath, [
    "[scoop]",
    `root = "${scoopRoot}"`,
    "",
    "[options]",
    "remove_all_before_add = false",
    "reset_core_repo = false",
    "run_update = false",
    "try_fix_ownership = false",
    "dry_run = true",
    "",
    "[[bucket]]",
    'name = "main"',
    "",
  ].join("\n"), "utf8")
  cases.add(root)
  return { root, bucketRoot, cachePath, configPath, scoopRoot }
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
