import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"

import type { CliHost } from "@xiranite/cli-runtime"
import type { TerminalInteractionDefinition, TerminalRenderer } from "@xiranite/cli-runtime/interaction"

import { runProgram, type BitvCliDependencies } from "./cli.js"
import type { BitvInput, BitvResult, BitvRuntime } from "./core.js"
import { bitvInputFromInteractionValues } from "./interaction.js"

afterEach(() => {
  process.exitCode = 0
})

describe("BitV CLI interaction contract", () => {
  test("keeps pipe JSON parseable and free from ANSI", async () => {
    const host = createHost()

    await runProgram(["analyze", "D:/videos/demo.mp4", "--json"], host, createDependencies())

    expect(process.exitCode ?? 0).toBe(0)
    expect(host.stdoutText()).not.toContain("\u001b[")
    const result = JSON.parse(host.stdoutText()) as BitvResult
    expect(result.success).toBe(true)
    expect(result.data?.videos[0]).toMatchObject({ filename: "demo.mp4", bitrateMbps: 1 })
    expect(host.stderrText()).not.toContain("Analyzing")
  })

  test("starts OpenTUI with the same package-owned mapping used outside the renderer", async () => {
    const renderers: TerminalRenderer[] = []
    let captured: TerminalInteractionDefinition<BitvInput, BitvResult> | undefined
    const dependencies = createDependencies({
      async runUi(definition, options) {
        renderers.push(options.renderer)
        captured = definition as TerminalInteractionDefinition<BitvInput, BitvResult>
      },
    })

    await runProgram(["ui", "--renderer=opentui", "--lang", "zh", "--theme", "high-contrast"], createHost({ tty: true }), dependencies)

    expect(renderers).toEqual(["opentui"])
    expect(captured).toBeDefined()
    const values = {
      ...captured!.schema.initialValues,
      action: "classify",
      paths: "D:/videos/demo.mp4\nD:/videos/two.mkv",
      targetPath: "D:/sorted",
    }
    expect(captured!.schema.toInput(values)).toEqual(bitvInputFromInteractionValues(values))
    expect(captured!.schema.isDangerous({ ...captured!.schema.toInput(values), dryRun: false })).toBe(true)
  })

  test("routes gd and legacy guided through the same compact guide", async () => {
    const runGuide = vi.fn(async () => undefined)
    const dependencies = createDependencies({ runGuide })

    await runProgram(["gd"], createHost({ tty: true }), dependencies)
    await runProgram(["guided"], createHost({ tty: true }), dependencies)

    expect(runGuide).toHaveBeenCalledTimes(2)
  })

  test.each(["ui", "gd", "guided"])('rejects explicit %s mode without a TTY', async (mode) => {
    const host = createHost()
    const dependencies = createDependencies()

    await runProgram([mode], host, dependencies)

    expect(process.exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("requires an interactive terminal")
    expect(dependencies.runGuide).not.toHaveBeenCalled()
    expect(dependencies.runUi).not.toHaveBeenCalled()
  })

  test("uses configured default mode only for no-argument TTY invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "bitv-mode-"))
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.bitv.cli]",
      'default_mode = "gd"',
      'renderer = "opentui"',
      'language = "zh"',
      'theme = "dracula"',
    ].join("\n"), "utf8")
    const runGuide = vi.fn(async () => undefined)
    const dependencies = createDependencies({ runGuide })

    await runProgram([], createHost({ tty: true, configPath }), dependencies)
    expect(runGuide).toHaveBeenCalledTimes(1)

    const pipeHost = createHost({ configPath })
    await runProgram([], pipeHost, dependencies)
    expect(process.exitCode).toBe(2)
    expect(pipeHost.stdoutText()).toBe("")
    expect(pipeHost.stderrText()).toContain("No interactive terminal detected")
  })

  test("defaults classify to preview and requires --apply before invoking file transfer", async () => {
    const transferFile = vi.fn(async (_source: string, target: string) => target)
    const resolveAvailablePath = vi.fn(async (target: string) => target)
    const dependencies = createDependencies({
      createRuntime: () => createRuntime({ transferFile, resolveAvailablePath }),
    })

    const previewHost = createHost()
    await runProgram(["classify", "D:/videos/demo.mp4", "--target", "D:/sorted", "--json"], previewHost, dependencies)
    expect((JSON.parse(previewHost.stdoutText()) as BitvResult).data?.dryRun).toBe(true)
    expect(resolveAvailablePath).toHaveBeenCalledTimes(1)
    expect(transferFile).not.toHaveBeenCalled()

    const applyHost = createHost()
    await runProgram(["classify", "D:/videos/demo.mp4", "--target", "D:/sorted", "--apply", "--json"], applyHost, dependencies)
    expect((JSON.parse(applyHost.stdoutText()) as BitvResult).data?.dryRun).toBe(false)
    expect(transferFile).toHaveBeenCalledTimes(1)
  })

  test("uses Chinese when no flag, config, or locale selects another language", async () => {
    let title = ""
    const runUi: BitvCliDependencies["runUi"] = async (definition) => {
      title = definition.schema.title
      expect(definition.schema.fields.find((field) => field.id === "paths")?.label).toBe("视频文件或目录")
    }

    await runProgram(["ui"], createHost({ tty: true }), createDependencies({ runUi }))

    expect(title).toBe("BitV")
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
      XIRANITE_CONFIG_PATH: options.configPath ?? join(process.cwd(), "artifacts", "test-runs", "bitv-missing.toml"),
      XIRANITE_CLI_COLUMNS: "120",
      LANG: "",
      LC_ALL: "",
      LC_MESSAGES: "",
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

function createDependencies(overrides: Partial<BitvCliDependencies> = {}): BitvCliDependencies {
  return {
    createRuntime: () => createRuntime(),
    runGuide: vi.fn(async () => undefined),
    runUi: vi.fn(async () => undefined) as BitvCliDependencies["runUi"],
    ...overrides,
  }
}

function createRuntime(overrides: Partial<BitvRuntime> = {}): BitvRuntime {
  return {
    findFfprobe: vi.fn(async () => "C:/ffmpeg/bin/ffprobe.exe"),
    discoverVideos: vi.fn(async (paths) => ({
      files: paths.map((path) => ({ path, basePath: "D:/videos", relativePath: path.split(/[\\/]/).at(-1) ?? path })),
      errors: [],
    })),
    statFile: vi.fn(async () => ({ sizeBytes: 12_500_000 })),
    runFfprobeJson: vi.fn(async () => ({
      format: { duration: "100" },
      streams: [{ codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30/1" }],
    })),
    readJson: vi.fn(async () => ({
      schemaVersion: 1,
      createdAt: "2026-07-11T00:00:00.000Z",
      requestedPaths: ["D:/videos"],
      recursive: true,
      bitrateStepMbps: 5,
      maxLevels: 10,
      videos: [{
        path: "D:/videos/demo.mp4",
        relativePath: "demo.mp4",
        filename: "demo.mp4",
        durationSeconds: 100,
        bitrateBps: 1_000_000,
        bitrateMbps: 1,
        width: 1920,
        height: 1080,
        fps: 30,
        sizeBytes: 12_500_000,
        resolution: "1920x1080",
        bitrateLevel: "5Mbps",
      }],
      stats: {},
    })),
    writeJson: vi.fn(async (path) => path),
    resolveAvailablePath: vi.fn(async (path) => path),
    transferFile: vi.fn(async (_source, path) => path),
    now: () => new Date("2026-07-11T00:00:00.000Z"),
    dirname: (path) => path.replace(/[\\/][^\\/]+$/, ""),
    ...overrides,
  }
}
