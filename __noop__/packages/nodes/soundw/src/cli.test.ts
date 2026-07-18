import { describe, expect, test, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram, type SoundwCliDependencies } from "./cli.js"

function host(tty = false): CliHost & { output: string[]; errors: string[] } {
  const output: string[] = []; const errors: string[] = []
  return { cwd: process.cwd(), env: { ...process.env, XIRANITE_CONFIG_PATH: `${process.cwd()}/artifacts/test-runs/soundw-missing.toml` }, stdin: { isTTY: tty } as CliHost["stdin"], stdout: { isTTY: tty, columns: 120, write: (value: string) => (output.push(value), true) }, stderr: { isTTY: tty, columns: 120, write: (value: string) => (errors.push(value), true) }, output, errors }
}
function dependencies(): SoundwCliDependencies { return { createRuntime: () => ({ resolve: async () => ({ found: true, path: "SoundSwitch.CLI.exe" }), run: async () => ({ code: 0, stdout: "ok", stderr: "" }) }), runGuide: vi.fn(async () => undefined), runUi: vi.fn(async () => undefined) } }

describe("SoundW CLI interaction contract", () => {
  test("keeps pipe JSON parseable and free of terminal escapes", async () => {
    const h = host(); await runProgram(["mute", "--json"], h, dependencies())
    expect(h.output.join("")).not.toMatch(/\u001b\[/)
    expect(JSON.parse(h.output.join(""))).toMatchObject({ success: true, data: { command: ["mute", "--state", "true"] } })
  })
  test("routes ui and guided modes through the shared dispatcher", async () => {
    const d = dependencies(); await runProgram(["ui"], host(true), d); await runProgram(["gd"], host(true), d); await runProgram(["guided"], host(true), d)
    expect(d.runUi).toHaveBeenCalledTimes(1); expect(d.runGuide).toHaveBeenCalledTimes(2)
  })
  test("rejects explicit interactive modes on non-TTY streams", async () => {
    const h = host(); await runProgram(["ui"], h, dependencies()); expect(process.exitCode).toBe(2); expect(h.output).toEqual([]); expect(h.errors.join("")).toContain("requires an interactive terminal")
  })
})
