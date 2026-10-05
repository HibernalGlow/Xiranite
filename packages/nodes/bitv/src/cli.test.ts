import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import type { TerminalInteractionDefinition, TerminalRenderer } from "@xiranite/cli-runtime/interaction"

import { createBitvHostDefinition, runProgram, type BitvCliDependencies } from "./cli.js"
import type { BitvData, BitvInput, BitvResult } from "./core.js"
import { bitvInputFromInteractionValues } from "./interaction.js"

const HOST_TOKEN = "attach-token"

interface RecordedStart {
  /** The node id the face addressed, read off the route rather than off the body. */
  nodeId: string
  /** The bitv input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  /** `POST …/{cancel,pause,resume}` paths, in the order they arrived. */
  controlPaths: string[]
  /** Resolves once a hanging host has been asked for its operation stream. */
  streamOpened: Promise<void>
  /** Closes a hanging stream with this result document; a no-op when nothing is hanging. */
  finish(result: BitvResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of these
 * tests is that the face holds no node engine of its own — it used to import `runBitv` and hand it a
 * `BitvRuntime` built in this process. `crates/xiranite-api` is still being wired for bitv (wave B), so the
 * bodies below follow `nodeOperationSchema`/`nodeRunResultSchema`, the shapes
 * `packages/api/src/operationsClient.ts` mirrors, plus this file's own `data()` mirror of `core.ts`. Nothing
 * here proves the host is correct, and nothing here needs ffprobe installed.
 */
async function startFakeHost(options: {
  /** Keyed by the `action` of the input document, the way the face's own pipe router keys it. */
  results?: Record<string, BitvResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** Keeps the stream open until `finish()`, so mid-run control calls are observable. */
  hang?: boolean
} = {}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const controlPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  const operationId = "op-bitv-1"
  const results = options.results ?? {}
  let pending: Record<string, unknown> | undefined
  let streamResponse: ServerResponse | undefined
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })

  const record = (phase: string, extra: Record<string, unknown> = {}) => ({
    operationId,
    nodeId: "bitv",
    phase,
    createdAt: 1,
    updatedAt: 2,
    eventCount: (options.events ?? []).length,
    ...extra,
  })

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route `crates/xiranite-api` serves without the bearer token, and the face probes
      // it before it draws a terminal screen, so a fake that did not answer it would look dead.
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== expectedToken) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        const input = JSON.parse(body).input as Record<string, unknown>
        pending = input
        starts.push({ nodeId: decodeURIComponent(path.split("/")[2] ?? ""), input, rawBody: body })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("queued") }))
        return
      }

      const control = /^\/node-operations\/([^/]+)\/(cancel|pause|resume)$/.exec(path)
      if (control?.[1] && control[2]) {
        controlPaths.push(`/node-operations/${control[1]}/${control[2]}`)
        const phase = control[2] === "cancel" ? "cancelled" : control[2] === "pause" ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(phase) }))
        return
      }

      if (/^\/node-operations\/[^/]+\/stream$/.test(path)) {
        // A hanging host still answers the control calls above and only closes the stream on `finish()`.
        if (options.hang) {
          response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
          response.write(`${JSON.stringify({ type: "operation", operation: record("running", { startedAt: 2 }) })}\n`)
          response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "Scanning video paths." } })}\n`)
          streamResponse = response
          resolveOpened()
          return
        }
        const result = results[String(pending?.action ?? "")] ?? { success: false, message: "no scripted result", data: data() }
        const frames = [
          { type: "operation", operation: record("running", { startedAt: 2 }) },
          ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
          { type: "result", operation: record("completed", { finishedAt: 4, result }), result },
        ]
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`)
        return
      }

      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    starts,
    controlPaths,
    streamOpened,
    finish: (result) => {
      if (!streamResponse) return
      const response = streamResponse
      streamResponse = undefined
      // The headers went out when the stream hung, so this writes the frame only.
      response.write(`${JSON.stringify({ type: "result", operation: record("completed", { finishedAt: 6, result }), result })}\n`)
      response.end()
    },
    close: async () => {
      // A stream still held open by a failed assertion would otherwise keep this socket from closing.
      streamResponse?.end()
      streamResponse = undefined
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

/** `core.ts`'s `emptyData()` plus one analysed video, so the face renders a complete document. */
function data(partial: Partial<BitvData> = {}): BitvData {
  return {
    action: "analyze",
    requestedPaths: [],
    videos: [],
    stats: { totalVideos: 0, totalSizeBytes: 0, totalDurationSeconds: 0, averageBitrateMbps: 0, bitrateDistribution: {} },
    operations: [],
    dryRun: true,
    errors: [],
    ...partial,
  }
}

const analyzedVideo: BitvData["videos"][number] = {
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
}

const hosts: FakeHost[] = []
const tempDirs: string[] = []

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  process.exitCode = 0
})

describe("BitV pipe face", () => {
  test("keeps pipe JSON parseable and free from ANSI", async () => {
    const fake = await startFakeHost({
      results: { analyze: { success: true, message: "Analyzed 1 video file(s).", data: data({ requestedPaths: ["D:/videos/demo.mp4"], videos: [analyzedVideo] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["analyze", "D:/videos/demo.mp4", "--json"], host, deps())

    expect(process.exitCode ?? 0).toBe(0)
    expect(host.stdoutText()).not.toContain("\u001b[")
    const result = JSON.parse(host.stdoutText()) as BitvResult
    expect(result.success).toBe(true)
    expect(result.data?.videos[0]).toMatchObject({ filename: "demo.mp4", bitrateMbps: 1 })
    expect(host.stderrText()).not.toContain("Analyzing")

    // One start call, addressed at this node by id, carrying the pipe document verbatim. Nothing the host
    // defaults is pre-filled here — the face sends only what the operator gave it, and `runBitv()` reads an
    // absent `dryRun` as "not explicitly false", i.e. a preview.
    expect(fake.starts.map((start) => start.nodeId)).toEqual(["bitv"])
    expect(fake.starts[0]?.input).toMatchObject({ action: "analyze", paths: ["D:/videos/demo.mp4"] })
    expect(fake.starts[0]?.input).not.toHaveProperty("dryRun")
    expect(fake.starts[0]?.input).not.toHaveProperty("bitrateStepMbps")
    expect(fake.starts[0]?.input).not.toHaveProperty("maxLevels")
    expect(fake.starts[0]?.input).not.toHaveProperty("transferMode")
  })

  test("forwards host events instead of a local progress feed", async () => {
    const fake = await startFakeHost({
      events: [{ type: "progress", progress: 40, message: "Analyzing demo.mp4." }],
      results: { analyze: { success: true, message: "Analyzed 1 video file(s).", data: data({ videos: [analyzedVideo] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["analyze", "D:/videos/demo.mp4"], host, deps())

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toContain("Analyzing demo.mp4.")
    expect(host.stdoutText()).toContain("Analyzed 1 video file(s).")
    expect(host.stdoutText()).toContain("Videos: 1")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({
      results: { status: { success: true, message: "ffprobe is ready: C:/ffmpeg/bin/ffprobe.exe", data: data({ action: "status", ffprobePath: "C:/ffmpeg/bin/ffprobe.exe" }) } },
    })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["status", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host, deps())

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "status" })
  })

  test("classify stays a preview until --apply, and the flag only changes the input document", async () => {
    const fake = await startFakeHost({
      results: {
        classify: {
          success: true,
          message: "Classification preview completed.",
          data: data({ action: "classify", dryRun: true, requestedPaths: ["D:/videos/demo.mp4"], videos: [analyzedVideo] }),
        },
      },
    })
    hosts.push(fake)
    const previewHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["classify", "D:/videos/demo.mp4", "--target", "D:/sorted", "--json"], previewHost, deps())
    expect((JSON.parse(previewHost.stdoutText()) as BitvResult).data?.dryRun).toBe(true)
    // The preview default itself is not copied into the document: an absent `dryRun` is the host's "preview".
    expect(fake.starts[0]?.input).toMatchObject({ action: "classify", paths: ["D:/videos/demo.mp4"], targetPath: "D:/sorted" })
    expect(fake.starts[0]?.input).not.toHaveProperty("dryRun")

    // `--apply` is the only way the operator tells the host to move real files; the face decides nothing.
    const applyHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    await runProgram(["classify", "D:/videos/demo.mp4", "--target", "D:/sorted", "--apply", "--json"], applyHost, deps())
    expect(fake.starts[1]?.input).toMatchObject({ dryRun: false })
    expect(applyHost.stdoutText()).toContain("success")
  })

  test("reports a host failure as exit code 1 with the host's own result document", async () => {
    const fake = await startFakeHost({
      results: { analyze: { success: false, message: "ffprobe was not found on this system.", data: data({ errors: ["No supported video files were found."] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["analyze", "D:/videos/demo.mp4", "--json"], host, deps())

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as BitvResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("ffprobe was not found")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { status: { success: true, message: "ffprobe is ready", data: data({ action: "status" }) } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["status", "--json"], host, deps())

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("/nodes/bitv/operations")
    expect(host.stderrText()).toContain("401")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path probed ffprobe and
    // read the videos from this process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["analyze", "D:/videos/demo.mp4", "--json"], host, deps())

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("keeps the usage error for an unknown action and never reaches a host", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["transcode", "D:/videos/demo.mp4"], host, deps())

    expect(process.exitCode).toBe(2)
    expect(host.stderrText()).toContain("Unknown BitV command")
    expect(fake.starts.length).toBe(0)
  })
})

describe("BitV CLI interaction contract", () => {
  test("starts OpenTUI with the same package-owned mapping used outside the renderer", async () => {
    const renderers: (TerminalRenderer | undefined)[] = []
    let captured: TerminalInteractionDefinition<BitvInput, BitvResult> | undefined
    const dependencies = deps({
      async runUi(definition, options) {
        renderers.push(options.renderer)
        captured = definition as unknown as TerminalInteractionDefinition<BitvInput, BitvResult>
      },
    })
    // The attach has to resolve before the renderer opens, so this face needs a host even in a stubbed UI run.
    const { host } = await attachToHost({ tty: true })

    await runProgram(["ui", "--renderer=opentui", "--lang", "zh", "--theme", "high-contrast"], host, dependencies)

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
    // The workbench controls address a host operation, which is why cancel/pause/resume exist at all: an
    // in-process run had nothing to cancel over the protocol.
    expect(typeof captured!.cancel).toBe("function")
    expect(typeof captured!.pause).toBe("function")
  })

  test("routes gd and legacy guided through the same compact guide", async () => {
    const runGuide = vi.fn(async () => undefined)
    const dependencies = deps({ runGuide })
    const { host } = await attachToHost({ tty: true })

    await runProgram(["gd"], host, dependencies)
    await runProgram(["guided"], host, dependencies)

    expect(runGuide).toHaveBeenCalledTimes(2)
  })

  test.each(["ui", "gd", "guided"])("rejects explicit %s mode without a TTY", async (mode) => {
    const host = createHost()
    const dependencies = deps()

    await runProgram([mode], host, dependencies)

    expect(process.exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("requires an interactive terminal")
    expect(dependencies.runGuide).not.toHaveBeenCalled()
    expect(dependencies.runUi).not.toHaveBeenCalled()
  })

  test("uses configured default mode only for no-argument TTY invocation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bitv-mode-"))
    tempDirs.push(dir)
    const configPath = join(dir, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.bitv.cli]",
      'default_mode = "gd"',
      'renderer = "opentui"',
      'language = "zh"',
      'theme = "dracula"',
    ].join("\n"), "utf8")
    const runGuide = vi.fn(async () => undefined)
    const dependencies = deps({ runGuide })
    const { host } = await attachToHost({ tty: true, env: { XIRANITE_CONFIG_PATH: configPath } })

    await runProgram([], host, dependencies)
    expect(runGuide).toHaveBeenCalledTimes(1)

    const pipeHost = createHost({ XIRANITE_CONFIG_PATH: configPath })
    await runProgram([], pipeHost, dependencies)
    expect(process.exitCode).toBe(2)
    expect(pipeHost.stdoutText()).toBe("")
    expect(pipeHost.stderrText()).toContain("No interactive terminal detected")
  })

  test("refuses to open a terminal face before the first field when no host can be reached", async () => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-dev-host") }, true)
    const dependencies = deps()

    await runProgram(["ui"], host, dependencies)

    // Nothing was drawn: the screen and its prompts come after the host is resolved.
    expect(process.exitCode).toBe(1)
    expect(dependencies.runUi).not.toHaveBeenCalled()
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("uses Chinese when no flag, config, or locale selects another language", async () => {
    let title = ""
    let pathsLabel = ""
    const runUi: BitvCliDependencies["runUi"] = async (definition) => {
      title = definition.schema.title
      pathsLabel = String(definition.schema.fields.find((field) => field.id === "paths")?.label)
    }
    const { host } = await attachToHost({ tty: true })

    await runProgram(["ui"], host, deps({ runUi }))

    expect(title).toBe("BitV")
    expect(pathsLabel).toBe("视频文件或目录")
  })
})

describe("BitV terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startFakeHost({ hang: true })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createBitvHostDefinition({}, "zh", face)
    const messages: string[] = []

    const running = definition.run({ action: "analyze", paths: ["D:/videos/demo.mp4"] }, (event) => messages.push(event.message))
    await fake.streamOpened
    expect(fake.starts[0]?.input).toMatchObject({ action: "analyze", paths: ["D:/videos/demo.mp4"] })

    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled.", data: data() })
    const result = await running

    expect(messages).toEqual(["Scanning video paths."])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-bitv-1/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startFakeHost({ hang: true })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createBitvHostDefinition({}, "zh", face)

    const running = definition.run({ action: "classify", paths: ["D:/videos/demo.mp4"], targetPath: "D:/sorted" }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Classification completed.", data: data({ action: "classify", dryRun: false }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-bitv-1/pause", "/node-operations/op-bitv-1/resume"])
    // The started record is released with the run, so a late control call cannot hit another operation.
    await definition.cancel?.()
    expect(fake.controlPaths.length).toBe(2)
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createBitvHostDefinition({}, "zh", face)

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })
})

/** Only the renderers are injectable any more: the engine is the host's, so there is no runtime to hand in. */
function deps(overrides: Partial<BitvCliDependencies> = {}): BitvCliDependencies {
  return {
    runGuide: vi.fn(async () => undefined),
    runUi: vi.fn(async () => undefined) as BitvCliDependencies["runUi"],
    ...overrides,
  }
}

interface TestHost extends CliHost {
  stdoutText: () => string
  stderrText: () => string
}

/**
 * A face host whose env attaches to this test's scripted server. `process.env` is deliberately not spread: an
 * attach must come from the test rather than from the machine, and a missing config file keeps the documented
 * BitV defaults (`dryRun: true`) under test.
 */
function createHost(extraEnv: Record<string, string> = {}, tty = false): TestHost {
  let stdout = ""
  let stderr = ""
  return {
    cwd: process.cwd(),
    env: {
      ...extraEnv,
      XIRANITE_CLI_COLUMNS: "120",
      NO_COLOR: "1",
      LANG: "",
      LC_ALL: "",
      LC_MESSAGES: "",
      XIRANITE_CONFIG_PATH: extraEnv.XIRANITE_CONFIG_PATH ?? join(process.cwd(), "artifacts", "test-runs", "bitv-missing.toml"),
    },
    // A closed empty pipe: the pipe router reads a non-TTY stdin when no path was given, so a fixture without
    // an async iterator would throw inside that read rather than in this test.
    stdin: emptyPipe(tty) as CliHost["stdin"],
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

/**
 * The attach env of a face host plus the scripted server behind it, so an interactive test can drive the face
 * and still read back what actually left it.
 */
async function attachToHost(options: { tty?: boolean; env?: Record<string, string> } = {}): Promise<{ host: TestHost; fake: FakeHost }> {
  const fake = await startFakeHost()
  hosts.push(fake)
  return {
    host: createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, ...options.env }, options.tty ?? false),
    fake,
  }
}

/** A stdin that is a finished, empty pipe — what `readStdinLines()` needs to answer `[]` instead of throwing. */
function emptyPipe(tty: boolean): NodeJS.ReadableStream & { isTTY?: boolean } {
  if (tty) return { isTTY: true } as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
  return {
    isTTY: false,
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: true as const, value: undefined }) }
    },
  } as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
}
