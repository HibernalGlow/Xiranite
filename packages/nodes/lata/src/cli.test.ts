import { afterEach, describe, expect, test } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { LataResult } from "./core.js"

const RUN_ROOT = resolve("artifacts/test-runs/lata-cli")
const cases = new Set<string>()

afterEach(async () => {
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("lata CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("Guided mode requires an interactive terminal")
    expect(host.stderrText()).toContain("list --path Taskfile.yml --json")
  })

  test("lists tasks from a real Taskfile discovered by cwd", async () => {
    const fixture = await createFixture("json-list")
    const host = createHost()

    await runProgram(["list", "--cwd", fixture.root, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as LataResult
    expect(result.success).toBe(true)
    expect(result.data?.taskfilePath).toBe(fixture.taskfile)
    expect(result.data?.tasks.map((task) => task.name)).toEqual(["default", "hello"])
  })

  test("executes a real Taskfile command and returns pure JSON", async () => {
    const fixture = await createFixture("json-execute")
    const host = createHost()

    await runProgram(["execute", "--path", fixture.taskfile, "--task", "hello", "--args", "world", "--json"], host)

    const result = JSON.parse(host.stdoutText()) as LataResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Task 'hello' completed.")
    expect(result.data?.commandPlan[0]?.command).toBe("echo hello world")
    expect(result.data?.commandResults[0]?.stdout.toLowerCase()).toContain("hello world")
  })
})

async function createFixture(name: string): Promise<{ root: string; taskfile: string }> {
  const root = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  const taskfile = join(root, "Taskfile.yml")
  await mkdir(root, { recursive: true })
  await writeFile(taskfile, [
    "version: '3'",
    "tasks:",
    "  default:",
    "    desc: Show tasks",
    "    cmds:",
    "      - echo list",
    "  hello:",
    "    desc: Say hello",
    "    cmds:",
    "      - echo hello {{.CLI_ARGS}}",
    "",
  ].join("\n"), "utf8")
  cases.add(root)
  return { root, taskfile }
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
