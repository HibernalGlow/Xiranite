import { describe, expect, test } from "bun:test"
import type { LataRuntime } from "./core.js"
import { buildLataCommandPlan, parseTaskfile, runLata } from "./core.js"

const TASKFILE = `
version: '3'
vars:
  TOOL: xdemo
tasks:
  default:
    desc: Show all tasks
    cmds:
      - task --list
  prep:
    desc: Prepare workspace
    cmds:
      - "{{.TOOL}} prep"
  build:
    desc: Build project
    deps:
      - prep
    vars:
      TARGET: app
    cmds:
      - echo build {{.TARGET}} {{.CLI_ARGS}}
`

describe("lata core", () => {
  test("parses Taskfile tasks", () => {
    const tasks = parseTaskfile(TASKFILE)
    expect(tasks.map((task) => task.name)).toEqual(["default", "prep", "build"])
    expect(tasks.find((task) => task.name === "build")?.deps).toEqual(["prep"])
  })

  test("plans dependencies before selected task", () => {
    const tasks = parseTaskfile(TASKFILE)
    const plan = buildLataCommandPlan(tasks, "build", "--prod")
    expect(plan.map((item) => item.command)).toEqual(["xdemo prep", "echo build app --prod"])
  })

  test("executes commands through injected runtime", async () => {
    const calls: string[] = []
    const runtime = memoryRuntime(calls)
    const result = await runLata({ action: "execute", taskfilePath: "Taskfile.yml", taskName: "build", taskArgs: "--prod" }, runtime)
    expect(result.success).toBe(true)
    expect(calls).toEqual(["xdemo prep", "echo build app --prod"])
    expect(result.data?.commandResults.length).toBe(2)
  })
})

function memoryRuntime(calls: string[]): LataRuntime {
  return {
    cwd: () => "/repo",
    exists: async (path) => path.endsWith("Taskfile.yml"),
    readText: async () => TASKFILE,
    runCommand: async (command) => {
      calls.push(command)
      return { exitCode: 0, stdout: `${command}\n`, stderr: "" }
    },
    join: (...parts) => parts.join("/"),
    dirname: (path) => path.split("/").slice(0, -1).join("/") || ".",
    basename: (path) => path.split("/").at(-1) ?? path,
    resolve: (...parts) => parts.join("/"),
  }
}
