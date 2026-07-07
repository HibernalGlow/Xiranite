import { afterEach, describe, expect, test } from "vitest"
import { mkdir, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { CrashuResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/crashu-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("crashu CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("scan --source")
  })

  test("prints pure JSON plan for real unicode source and target folders", async () => {
    const fixture = await createFixture("json-plan")
    const host = createHost()

    await runProgram([
      "plan",
      "--source",
      fixture.sourceRoot,
      "--targetPath",
      fixture.targetRoot,
      "--destinationPath",
      fixture.destinationRoot,
      "--json",
    ], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as CrashuResult
    expect(result.success).toBe(true)
    expect(result.data?.similarFound).toBe(1)
    expect(result.data?.plan[0]).toEqual(expect.objectContaining({
      sourcePath: join(fixture.sourceRoot, "蜂蜜作品 [Alt Name]"),
      targetName: "Alt Name",
      destinationPath: join(fixture.destinationRoot, "Alt Name", "蜂蜜作品 [Alt Name]"),
      status: "pending",
    }))
  })
})

async function createFixture(name: string): Promise<{ sourceRoot: string; targetRoot: string; destinationRoot: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`, "真实 crashu")
  const sourceRoot = join(root, "source")
  const targetRoot = join(root, "targets")
  const destinationRoot = join(root, "destination")
  await mkdir(join(sourceRoot, "蜂蜜作品 [Alt Name]"), { recursive: true })
  await mkdir(join(targetRoot, "Alt Name"), { recursive: true })
  await mkdir(destinationRoot, { recursive: true })
  cases.add(root)
  return { sourceRoot, targetRoot, destinationRoot }
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
