import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { LoratResult } from "./core.js"

// @xiranite-real-run lorat

const RUN_ROOT = resolve("artifacts/test-runs/lorat-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("lorat CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xlorat ui")
  })

  test("scans a real LoRA folder into pure JSON", async () => {
    const fixture = await createFixture("scan")
    const host = createHost()

    await runProgram(["scan", "--folder", fixture.loraRoot, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as LoratResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Found 2 LoRA model(s).")
    expect(result.data?.rows.map((row) => row.relativePath)).toEqual(["artist/alice_v1.safetensors", "self/quiet.pt"])
    expect(result.data?.stats).toMatchObject({ total: 2, missing: 1, trigger: 1 })
  })

  test("exports scanned rows to a real TriggerDB JSON file", async () => {
    const fixture = await createFixture("export-db")
    const scanHost = createHost()
    await runProgram(["scan", "--folder", fixture.loraRoot, "--json"], scanHost)
    const scan = JSON.parse(scanHost.stdoutText()) as LoratResult
    const rowsFile = join(fixture.root, "rows.json")
    const output = join(fixture.root, "trigger-db.json")
    await writeFile(rowsFile, JSON.stringify(scan.data?.rows ?? []), "utf8")

    const exportHost = createHost()
    await runProgram(["export-db", "--rowsFile", rowsFile, "--output", output, "--json"], exportHost)

    expect(process.exitCode).toBe(0)
    const exported = JSON.parse(exportHost.stdoutText()) as LoratResult
    expect(exported.success).toBe(true)
    expect(exported.data?.triggerDbJson).toContain("self/quiet")
    const file = await readFile(output, "utf8")
    expect(file).toContain("active_triggers")
    expect(file).toContain("quiet token")
  })
})

async function createFixture(name: string): Promise<{ root: string; loraRoot: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const loraRoot = join(root, "loras")
  const artist = join(loraRoot, "artist")
  const self = join(loraRoot, "self")
  await mkdir(artist, { recursive: true })
  await mkdir(self, { recursive: true })
  await writeFile(join(artist, "alice_v1.safetensors"), "alice", "utf8")
  await writeFile(join(self, "quiet.pt"), "quiet", "utf8")
  await writeFile(join(self, "quiet.trigger.txt"), "quiet token\n", "utf8")
  cases.add(root)
  return { root, loraRoot }
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
