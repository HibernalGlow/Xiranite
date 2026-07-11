import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import type { TerminalInteractionDefinition, TerminalRenderer } from "@xiranite/cli-runtime/interaction"
import { runProgram, SLEEPT_MAX_WAIT_HELP, type SleeptCliDependencies } from "./cli.js"
import type { SleeptInput, SleeptResult } from "./core.js"
import { sleeptInputFromInteractionValues } from "./interaction.js"

afterEach(() => {
  process.exitCode = 0
})

describe("sleept CLI interaction contract", () => {
  test("keeps pipe JSON parseable and free from ANSI", async () => {
    const host = createHost()

    await runProgram(["status", "--json"], host)

    expect(process.exitCode ?? 0).toBe(0)
    expect(host.stdoutText()).not.toMatch(/\u001b\[/)
    const result = JSON.parse(host.stdoutText()) as SleeptResult
    expect(result.success).toBe(true)
    expect(result.message).toContain("CPU:")
    expect(result.data?.timerStatus).toBe("idle")
  }, 20_000)

  test("starts both UI renderers with the package schema used by the GUI mapping", async () => {
    const renderers: TerminalRenderer[] = []
    let captured: TerminalInteractionDefinition<SleeptInput, SleeptResult> | undefined
    const dependencies = createDependencies({
      async runUi(definition, options) {
        renderers.push(options.renderer)
        captured = definition as TerminalInteractionDefinition<SleeptInput, SleeptResult>
      },
    })

    await runProgram(["ui", "--renderer", "ink", "--lang", "en", "--theme", "dracula"], createHost({ tty: true }), dependencies)
    await runProgram(["ui", "--renderer=opentui", "--lang", "zh", "--theme", "high-contrast"], createHost({ tty: true }), dependencies)

    expect(renderers).toEqual(["ink", "opentui"])
    expect(captured).toBeDefined()
    const values = { ...captured!.schema.initialValues, action: "get_stats" }
    const uiInput = captured!.schema.toInput(values)
    const guiInput = sleeptInputFromInteractionValues(values)
    expect(uiInput).toEqual(guiInput)
    const result = await captured!.run(uiInput, () => undefined)
    expect(result.success).toBe(true)
    expect(result.data?.timerStatus).toBe("idle")
  }, 20_000)

  test("routes gd and legacy guided to the same compact guide", async () => {
    const runGuide = vi.fn(async () => undefined)
    const dependencies = createDependencies({ runGuide })

    await runProgram(["gd"], createHost({ tty: true }), dependencies)
    await runProgram(["guided"], createHost({ tty: true }), dependencies)

    expect(runGuide).toHaveBeenCalledTimes(2)
  })

  test.each(["ui", "gd", "guided"])("rejects explicit %s mode without a TTY", async (mode) => {
    const host = createHost()
    const dependencies = createDependencies()

    await runProgram([mode], host, dependencies)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("requires an interactive terminal")
    expect(dependencies.runGuide).not.toHaveBeenCalled()
    expect(dependencies.runUi).not.toHaveBeenCalled()
  })

  test("uses configured default only for no-argument TTY invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "sleept-mode-"))
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.sleept]",
      'interaction_mode = "gd"',
      'interaction_renderer = "opentui"',
      'interaction_language = "zh"',
      'interaction_theme = "dracula"',
    ].join("\n"), "utf8")
    const runGuide = vi.fn(async () => undefined)
    const dependencies = createDependencies({ runGuide })

    await runProgram([], createHost({ tty: true, configPath }), dependencies)
    expect(runGuide).toHaveBeenCalledTimes(1)

    const pipeHost = createHost({ configPath })
    await runProgram([], pipeHost, dependencies)
    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(pipeHost.stdoutText()).toBe("")
    expect(pipeHost.stderrText()).toContain("No interactive terminal detected")
    expect(runGuide).toHaveBeenCalledTimes(1)
  })

  test("uses configured English as an override to the Chinese UI default", async () => {
    const root = await mkdtemp(join(tmpdir(), "sleept-language-"))
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.sleept]",
      'interaction_language = "en"',
    ].join("\n"), "utf8")
    let language: string | undefined
    const runUi: SleeptCliDependencies["runUi"] = async (_definition, options) => {
      language = options.language
    }

    await runProgram(["ui"], createHost({ tty: true, configPath }), createDependencies({ runUi }))

    expect(language).toBe("en")
  })

  test("runs a short countdown dry-run as JSON", async () => {
    const host = createHost()

    await runProgram(["countdown", "--hours", "0", "--minutes", "0", "--seconds", "1", "--dryrun", "--json"], host)

    expect(process.exitCode ?? 0).toBe(0)
    const result = JSON.parse(host.stdoutText()) as SleeptResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("[dryrun] Countdown completed; simulated sleep.")
    expect(result.data?.timerStatus).toBe("completed")
  })

  test("documents zero maximum wait as indefinite monitoring", () => {
    expect(SLEEPT_MAX_WAIT_HELP).toContain("use 0 to monitor indefinitely")
  })
})

interface TestHost extends CliHost {
  stdoutText: () => string
  stderrText: () => string
}

function createHost(options: { tty?: boolean; configPath?: string } = {}): TestHost {
  let stdout = ""
  let stderr = ""
  const tty = options.tty ?? false
  return {
    cwd: process.cwd(),
    env: {
      ...process.env,
      XIRANITE_CONFIG_PATH: options.configPath ?? join(process.cwd(), "artifacts", "test-runs", "sleept-missing.toml"),
      XIRANITE_CLI_COLUMNS: "120",
    },
    stdin: { isTTY: tty } as CliHost["stdin"],
    stdout: {
      isTTY: tty,
      columns: 120,
      write(chunk: string) {
        stdout += chunk
        return true
      },
    },
    stderr: {
      isTTY: tty,
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

function createDependencies(overrides: Partial<SleeptCliDependencies> = {}): SleeptCliDependencies {
  return {
    createRuntime: () => ({
      now: () => new Date("2026-01-01T00:00:00"),
      sleep: async () => undefined,
      getCpuPercent: () => 0,
      getNetCounters: () => ({ bytesSent: 0, bytesReceived: 0 }),
      executePowerAction: () => undefined,
    }),
    runGuide: vi.fn(async () => undefined),
    runUi: vi.fn(async () => undefined) as SleeptCliDependencies["runUi"],
    ...overrides,
  }
}
