import { join, win32 } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import type { TerminalInteractionDefinition, TerminalRenderer } from "@xiranite/cli-runtime/interaction"
import { normalizeMultiplePaths, runProgram, type GifuCliDependencies } from "./cli.js"
import type { GifuInput, GifuResult, GifuRuntime } from "./core.js"
import { isGifuArchive } from "./core.js"
import { gifuInputFromInteractionValues } from "./interaction.js"

afterEach(() => {
  process.exitCode = 0
})

describe("gifu CLI interaction contract", () => {
  test("keeps pipe JSON parseable and free from ANSI", async () => {
    const host = createHost()
    await runProgram(["plan", "D:/packs/a.zip", "--format", "gif", "--json"], host, createDependencies())
    expect(process.exitCode ?? 0).toBe(0)
    expect(host.stdoutText()).not.toContain(String.fromCharCode(27))
    const result = JSON.parse(host.stdoutText()) as GifuResult
    expect(result.success).toBe(true)
    expect(result.data?.archives[0]).toMatchObject({ imageCount: 2, format: "gif", status: "ready" })
    expect(result.data?.command?.command).toBe("gifu-native")
  })

  test("accepts multiple positional paths without treating option values as paths", () => {
    expect(normalizeMultiplePaths(["plan", "D:/a.zip", "D:/b.cbz", "--format", "webp", "--out-dir=D:/out"])).toEqual([
      "plan", "D:/a.zip;D:/b.cbz", "--format", "webp", "--out-dir=D:/out",
    ])
  })

  test("starts OpenTUI with the package-owned schema and native core mapping", async () => {
    const renderers: TerminalRenderer[] = []
    let captured: TerminalInteractionDefinition<GifuInput, GifuResult> | undefined
    const dependencies = createDependencies({
      async runUi(definition, options) {
        renderers.push(options.renderer)
        captured = definition as TerminalInteractionDefinition<GifuInput, GifuResult>
      },
    })
    await runProgram(["ui", "--renderer=opentui", "--lang", "zh", "--theme", "high-contrast"], createHost({ tty: true }), dependencies)
    expect(renderers).toEqual(["opentui"])
    expect(captured).toBeDefined()
    const values = { ...captured!.schema.initialValues, pathsText: "D:/packs/a.zip", action: "plan" }
    expect(captured!.schema.toInput(values)).toEqual(gifuInputFromInteractionValues(values))
    const result = await captured!.run(captured!.schema.toInput(values), () => undefined)
    expect(result.success).toBe(true)
  })

  test("routes gd and guided to the same compact guide", async () => {
    const runGuide = vi.fn(async () => undefined)
    const dependencies = createDependencies({ runGuide })
    await runProgram(["gd"], createHost({ tty: true }), dependencies)
    await runProgram(["guided"], createHost({ tty: true }), dependencies)
    expect(runGuide).toHaveBeenCalledTimes(2)
  })

  test.each(["ui", "gd", "guided"])("rejects explicit %s mode outside a TTY", async (mode) => {
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

  test("routes no-argument TTY invocation to UI and protects non-TTY output", async () => {
    const runUi = vi.fn(async () => undefined) as GifuCliDependencies["runUi"]
    const dependencies = createDependencies({ runUi })
    await runProgram([], createHost({ tty: true }), dependencies)
    expect(runUi).toHaveBeenCalledTimes(1)

    const pipeHost = createHost()
    await runProgram([], pipeHost, dependencies)
    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(pipeHost.stdoutText()).toBe("")
    expect(pipeHost.stderrText()).toContain("No interactive terminal detected")
  })

  test("make remains a dry run until --live is explicit", async () => {
    const convertArchive = vi.fn<GifuRuntime["convertArchive"]>()
    const dependencies = createDependencies({ createRuntime: () => createRuntime({ convertArchive }) })
    await runProgram(["make", "D:/packs/a.zip", "--json"], createHost(), dependencies)
    expect(convertArchive).not.toHaveBeenCalled()

    await runProgram(["make", "D:/packs/a.zip", "--live", "--json"], createHost(), dependencies)
    expect(convertArchive).toHaveBeenCalledTimes(1)
  })
})

interface TestHost extends CliHost {
  stdoutText: () => string
  stderrText: () => string
}

function createHost(options: { tty?: boolean } = {}): TestHost {
  let stdout = ""
  let stderr = ""
  const tty = options.tty ?? false
  return {
    cwd: process.cwd(),
    env: {
      ...process.env,
      XIRANITE_CONFIG_PATH: join(process.cwd(), "artifacts", "test-runs", "gifu-missing.toml"),
      XIRANITE_CLI_COLUMNS: "120",
    },
    stdin: { isTTY: tty } as CliHost["stdin"],
    stdout: { isTTY: tty, columns: 120, write(chunk: string) { stdout += chunk; return true } },
    stderr: { isTTY: tty, columns: 120, write(chunk: string) { stderr += chunk; return true } },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}

function createDependencies(overrides: Partial<GifuCliDependencies> = {}): GifuCliDependencies {
  return {
    createRuntime,
    runGuide: vi.fn(async () => undefined),
    runUi: vi.fn(async () => undefined) as GifuCliDependencies["runUi"],
    ...overrides,
  }
}

function createRuntime(overrides: Partial<GifuRuntime> = {}): GifuRuntime {
  return {
    readText: async () => "",
    appendRecord: async () => undefined,
    pathInfo: async (path) => ({ path, exists: true, isFile: isGifuArchive(path), isDirectory: !isGifuArchive(path) }),
    listDir: async () => [],
    listArchiveImages: async () => [{ path: "1.png", extension: ".png" }, { path: "2.png", extension: ".png" }],
    convertArchive: async (task) => ({ status: "converted", outputPath: task.outputPath, decodedFrames: 2, skippedFrames: 0, encoder: "test" }),
    join: win32.join,
    dirname: win32.dirname,
    basename: win32.basename,
    extname: win32.extname,
    relative: win32.relative,
    ...overrides,
  }
}
