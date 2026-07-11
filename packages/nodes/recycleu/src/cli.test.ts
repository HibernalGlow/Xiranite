import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

import { containsAnsi, createMemoryCliHost as createHost, explicitInteractionModes } from "@xiranite/cli-runtime/testing"
import type { TerminalPreferenceController } from "@xiranite/cli-runtime/terminal"
import type { RecycleuRuntime } from "./core.js"
import { RECYCLEU_CYCLES_HELP, runProgram, type RecycleuCliDependencies } from "./cli.js"

afterEach(() => { process.exitCode = 0 })

describe("recycleu CLI interaction modes", () => {
  test.each(explicitInteractionModes)("rejects explicit %s outside a TTY", async (mode) => {
    const host = createHost()
    const dependencies = createDependencies()
    await runProgram([mode], host, dependencies)
    expect(process.exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("requires an interactive terminal")
    expect(dependencies.runUi).not.toHaveBeenCalled()
    expect(dependencies.runGuide).not.toHaveBeenCalled()
  })

  test("keeps no-argument non-TTY invocation pipe-safe", async () => {
    const host = createHost()
    await runProgram([], host, createDependencies())
    expect(process.exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("No interactive terminal detected")
  })

  test("uses nodes.recycleu.cli defaults and starts in Chinese", async () => {
    const root = await mkdtemp(join(tmpdir(), "recycleu-mode-"))
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.recycleu]",
      "interval = 30",
      "max_cycles = 0",
      'drive_letter = "C"',
      "",
      "[nodes.recycleu.cli]",
      'default_mode = "gd"',
      'language = "zh"',
      'theme = "dracula"',
    ].join("\n"), "utf8")
    let language: string | undefined
    let initial: Record<string, unknown> | undefined
    const runGuide: RecycleuCliDependencies["runGuide"] = async (definition, options) => {
      language = options.language
      initial = definition.schema.initialValues
    }
    await runProgram([], createHost({ tty: true, configPath }), createDependencies({ runGuide }))
    expect(language).toBe("zh")
    expect(initial).toMatchObject({ interval: 30, maxCycles: 0, driveLetter: "C" })
  })

  test("routes ui and guided alias to their shared adapters", async () => {
    const dependencies = createDependencies()
    await runProgram(["ui"], createHost({ tty: true }), dependencies)
    await runProgram(["guided"], createHost({ tty: true }), dependencies)
    expect(dependencies.runUi).toHaveBeenCalledTimes(1)
    expect(dependencies.runGuide).toHaveBeenCalledTimes(1)
  })

  test("saves only nodes.recycleu.cli preferences through the shared settings controller", async () => {
    const root = await mkdtemp(join(tmpdir(), "recycleu-preferences-"))
    const configPath = join(root, "xiranite.config.toml")
    let controller: TerminalPreferenceController | undefined
    const dependencies = createDependencies()
    dependencies.runUi = vi.fn(async (_definition, options) => { controller = options.preferences })
    await runProgram(["ui"], createHost({ tty: true, configPath }), dependencies)
    await controller?.save({ theme: "dracula", defaultMode: "pipe", language: "zh" })
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[nodes.recycleu.cli]")
    expect(content).toContain('default_mode = "pipe"')
    expect(content).not.toContain("interaction_mode")
  })

  test("prints ANSI-free JSON status without touching the recycle bin", async () => {
    const emptyRecycleBin = vi.fn(async () => ({ status: "empty" as const, message: "empty" }))
    const host = createHost()
    await runProgram(["status", "--json"], host, createDependencies({ runtime: createRuntime(emptyRecycleBin) }))
    expect(process.exitCode).toBe(0)
    expect(containsAnsi(host.stdoutText())).toBe(false)
    expect(JSON.parse(host.stdoutText())).toMatchObject({ success: true, data: { timerStatus: "idle" } })
    expect(emptyRecycleBin).not.toHaveBeenCalled()
  })

  test("executes clean only through the injected runtime", async () => {
    const emptyRecycleBin = vi.fn(async () => ({ status: "cleaned" as const, message: "cleaned fake bin" }))
    const host = createHost()
    await runProgram(["clean", "--drive", "C", "--json"], host, createDependencies({ runtime: createRuntime(emptyRecycleBin) }))
    expect(emptyRecycleBin).toHaveBeenCalledWith("C")
    expect(JSON.parse(host.stdoutText()).success).toBe(true)
  })

  test("documents zero cycles as unlimited", () => {
    expect(RECYCLEU_CYCLES_HELP).toContain("use 0 for unlimited")
  })
})

function createDependencies(overrides: { runGuide?: RecycleuCliDependencies["runGuide"]; runtime?: RecycleuRuntime } = {}): RecycleuCliDependencies {
  return {
    createRuntime: () => overrides.runtime ?? createRuntime(vi.fn(async () => ({ status: "empty" as const, message: "empty" }))),
    runGuide: vi.fn(overrides.runGuide ?? (async () => undefined)),
    runUi: vi.fn(async () => undefined),
  }
}

function createRuntime(emptyRecycleBin: RecycleuRuntime["emptyRecycleBin"]): RecycleuRuntime {
  return { now: () => new Date("2026-07-12T00:00:00Z"), sleep: async () => undefined, emptyRecycleBin }
}
