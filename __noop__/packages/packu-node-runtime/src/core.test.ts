import { describe, expect, test } from "vitest"
import {
  buildPackuCommand,
  buildPackuIntegrationProfile,
  defaultPackuDatabasePath,
  normalizePackuToolInput,
  parseTomlLikeKeys,
  runPackuTool,
} from "./core.js"
import type { PackuToolSpec } from "./core.js"

const spec: PackuToolSpec = {
  id: "demo",
  moduleName: "demo",
  sourceRoot: "D:/src",
  defaultArgs: ["run"],
  configFiles: ["demo.toml"],
  databaseLabel: "demo_runs",
}

describe("packu node runtime", () => {
  test("builds python module command", () => {
    const input = normalizePackuToolInput({ path: "D:/x", args: ["--flag"] }, spec)
    const command = buildPackuCommand(spec, input)
    expect(command.args).toEqual(["-m", "demo", "run", "--flag", "D:/x"])
    expect(command.env?.PYTHONPATH).toBe("D:/src")
  })

  test("summarizes TOML-like config", () => {
    expect(parseTomlLikeKeys("[tool]\npath = 'x'\n")).toEqual({ keys: ["path"], tables: ["tool"] })
  })

  test("profiles TOML candidates and default JSONL database path", () => {
    const input = normalizePackuToolInput({}, spec)
    expect(defaultPackuDatabasePath(spec, input)).toBe("D:/src/.xiranite/demo-runs.jsonl")
    expect(buildPackuIntegrationProfile(spec, input)).toMatchObject({
      configCandidates: ["D:/src/demo.toml"],
      databasePath: "D:/src/.xiranite/demo-runs.jsonl",
      databaseLabel: "demo_runs",
      recordFormat: "jsonl",
      recordRun: false,
    })
  })

  test("plans without running", async () => {
    const result = await runPackuTool(spec, { path: "D:/x", configText: "[a]\nb=1" }, {
      readText: async () => "",
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      appendRecord: async () => {},
    })
    expect(result.success).toBe(true)
    expect(result.data?.config?.tables).toEqual(["a"])
    expect(result.data?.integration.configCandidates).toEqual(["D:/src/demo.toml"])
    expect(result.data?.database).toMatchObject({ enabled: false, defaultPath: true, mode: "jsonl" })
  })

  test("writes enhanced run records when recording is enabled", async () => {
    const records: Array<{ path: string; record: unknown }> = []
    const result = await runPackuTool(spec, { action: "run", path: "D:/x", recordRun: true }, {
      readText: async () => "",
      runCommand: async () => ({ code: 0, stdout: "ok", stderr: "" }),
      appendRecord: async (path, record) => {
        records.push({ path, record })
      },
    })
    expect(result.success).toBe(true)
    expect(records).toHaveLength(1)
    expect(records[0]?.path).toBe("D:/src/.xiranite/demo-runs.jsonl")
    expect(records[0]?.record).toMatchObject({
      toolId: "demo",
      databaseLabel: "demo_runs",
      selectedPaths: ["D:/x"],
      success: true,
      code: 0,
      stdoutLength: 2,
      stderrLength: 0,
    })
  })
})
