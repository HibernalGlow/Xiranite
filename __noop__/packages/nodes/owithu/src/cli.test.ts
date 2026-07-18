import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { OwithuResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/owithu-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("owithu CLI", () => {
  test("refuses the configured UI outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xowithu ui")
  })

  test("prints pure JSON preview from a real TOML config", async () => {
    const fixture = await createFixture("json-preview")
    const host = createHost()

    await runProgram(["preview", "--config", fixture.configPath, "--hive", "HKCU", "--key", "Code", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as OwithuResult
    expect(result.success).toBe(true)
    expect(result.data?.entries).toHaveLength(1)
    expect(result.data?.plan).toHaveLength(2)
    expect(result.data?.plan.map((item) => item.scope).sort()).toEqual(["directory", "file"])
  })
})

async function createFixture(name: string): Promise<{ root: string; configPath: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const configPath = join(root, "owithu.toml")
  await mkdir(root, { recursive: true })
  await writeFile(configPath, sampleToml, "utf8")
  cases.add(root)
  return { root, configPath }
}

const sampleToml = `
[defaults]
enabled = true
hives = ["HKCU"]

[vars]
root = "D:/Tools"

[[entries]]
key = "Code"
label = "Open with Code"
exe = "{root}/Code.exe"
scope = ["file", "directory"]
args = ["%1"]
`

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
