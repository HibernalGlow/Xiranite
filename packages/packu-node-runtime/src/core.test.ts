import { describe, expect, test } from "vitest"
import { buildPackuCommand, normalizePackuToolInput, parseTomlLikeKeys, runPackuTool } from "./core.js"
import type { PackuToolSpec } from "./core.js"

const spec: PackuToolSpec = {
  id: "demo",
  moduleName: "demo",
  sourceRoot: "D:/src",
  defaultArgs: ["run"],
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

  test("plans without running", async () => {
    const result = await runPackuTool(spec, { path: "D:/x", configText: "[a]\nb=1" }, {
      readText: async () => "",
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      appendRecord: async () => {},
    })
    expect(result.success).toBe(true)
    expect(result.data?.config?.tables).toEqual(["a"])
  })
})
