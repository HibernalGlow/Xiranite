import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { CliHost } from "@xiranite/cli-runtime"
import type { TerminalInteractionDefinition, TerminalRenderer } from "@xiranite/cli-runtime/interaction"
import { createGifuHostDefinition, normalizeMultiplePaths, runProgram, type GifuCliDependencies } from "./cli.js"
import type { GifuArchivePlan, GifuData, GifuInput, GifuResult } from "./core.js"
import { gifuInputFromInteractionValues } from "./interaction.js"

const HOST_TOKEN = "attach-token"
/** A path that is never written: node config must not leak in from the machine running the test. */
const MISSING_CONFIG = join(tmpdir(), "xiranite-gifu-cli-missing.toml")

interface RecordedStart {
  /** The route the face chose, i.e. the operation name the host keys the bundle under. */
  route: string
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of these
 * tests is that the face holds no node engine of its own. `gifu` is wave B in
 * `docs/migration/face-execution-ledger.md` (not in the Rust registry yet), and its ffmpeg/7-Zip probes belong
 * to the host, so a test that ran the conversion in-process would assert a shape the product no longer has.
 * Bodies follow `crates/xiranite-core/src/operation/dto.rs`; `core.test.ts` stays where gifu's logic is proven.
 */
async function startFakeHost(options: {
  results: Record<string, GifuResult>
  token?: string
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  let sequence = 0
  const pending = new Map<string, Record<string, unknown>>()

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route the host serves without the bearer token, and the face probes it before it
      // asks the operator anything, so a fake that did not answer it would look dead.
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
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ route: path, input })
        pending.set(operationId, input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const result = options.results[String(pending.get(stream[1])?.action ?? "")] ?? { success: false, message: "no scripted result" }
        const frames = [
          { type: "operation", operation: record(stream[1], "running", { startedAt: 2 }) },
          { type: "result", operation: record(stream[1], "completed", { finishedAt: 4, result }), result },
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
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "gifu", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** One ready archive, in the shape `core.ts` hands back for a planned conversion. */
function archive(partial: Partial<GifuArchivePlan> = {}): GifuArchivePlan {
  return {
    archivePath: "D:/packs/a.zip",
    outputPath: "D:/packs/a.gif",
    imageCount: 2,
    format: "gif",
    status: "ready",
    ...partial,
  }
}

function data(partial: Partial<GifuData> = {}): GifuData {
  return { archives: [archive()], errors: [], ...partial }
}

const hosts: FakeHost[] = []

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("gifu CLI interaction contract", () => {
  test("keeps pipe JSON parseable and free from ANSI, with the run on the host", async () => {
    const fake = await attach({ plan: { success: true, message: "Planned 1 archive(s).", data: data() } })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "D:/packs/a.zip", "--format", "gif", "--json"], host, createDependencies())

    expect(process.exitCode ?? 0).toBe(0)
    expect(host.stdoutText()).not.toContain(String.fromCharCode(27))
    const result = JSON.parse(host.stdoutText()) as GifuResult
    expect(result.success).toBe(true)
    expect(result.data?.archives[0]).toMatchObject({ imageCount: 2, format: "gif", status: "ready" })

    // The face owns the argv → input mapping; the conversion itself is the host's.
    expect(fake.starts.map((start) => [start.route, start.input.action])).toEqual([["/nodes/gifu/operations", "plan"]])
    expect(fake.starts[0]?.input).toMatchObject({ paths: ["D:/packs/a.zip"], format: "gif", dryRun: true })
  })

  test("accepts multiple positional paths without treating option values as paths", () => {
    expect(normalizeMultiplePaths(["plan", "D:/a.zip", "D:/b.cbz", "--format", "webp", "--out-dir=D:/out"])).toEqual([
      "plan", "D:/a.zip;D:/b.cbz", "--format", "webp", "--out-dir=D:/out",
    ])
  })

  test("splits a path list into the input array, dropping comments and blank entries", async () => {
    const fake = await attach({ inspect: { success: true, message: "Inspected 2 archive(s).", data: data({ archives: [] }) } })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["inspect", '"D:/packs/a.zip";D:/packs/b.cbz;# note;', "--json"], host, createDependencies())

    expect(fake.starts[0]?.input).toMatchObject({ action: "inspect", paths: ["D:/packs/a.zip", "D:/packs/b.cbz"] })
  })

  test("make stays a dry run until --live is explicit", async () => {
    const fake = await attach({
      make: { success: true, message: "Converted 1 archive(s).", data: data({ archives: [archive({ status: "converted", decodedFrames: 2 })] }) },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["make", "D:/packs/a.zip", "--json"], host, createDependencies())
    // Nothing was left to say, so the field is absent and `core.ts`'s safe default (dry run) answers on the host.
    expect(fake.starts[0]?.input).toMatchObject({ action: "make" })
    expect(fake.starts[0]?.input).not.toHaveProperty("dryRun")

    await runProgram(["make", "D:/packs/a.zip", "--live", "--json"], host, createDependencies())
    expect(fake.starts[1]?.input).toMatchObject({ action: "make", dryRun: false })
  })

  test("starts OpenTUI with the package-owned schema and a host-backed run", async () => {
    const fake = await attach({ plan: { success: true, message: "Planned 1 archive(s).", data: data() } })
    const renderers: TerminalRenderer[] = []
    let captured: TerminalInteractionDefinition<GifuInput, GifuResult> | undefined
    const dependencies = createDependencies({
      async runUi(definition, options) {
        renderers.push(options.renderer)
        captured = definition as TerminalInteractionDefinition<GifuInput, GifuResult>
      },
    })
    await runProgram(["ui", "--renderer=opentui", "--lang", "zh", "--theme", "high-contrast"], createHost({ tty: true, XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }), dependencies)

    expect(renderers).toEqual(["opentui"])
    expect(captured).toBeDefined()
    const values = { ...captured!.schema.initialValues, pathsText: "D:/packs/a.zip", action: "plan" }
    expect(captured!.schema.toInput(values)).toEqual(gifuInputFromInteractionValues(values))
    const result = await captured!.run(captured!.schema.toInput(values), () => undefined)
    expect(result.success).toBe(true)
    expect(fake.starts.map((start) => start.input.action)).toEqual(["plan"])
  })

  test("cancel addresses the operation this face started", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createGifuHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "make", paths: ["D:/a.zip"], dryRun: true }, () => undefined)
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createGifuHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "make", paths: ["D:/a.zip"], dryRun: true }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Converted 1 archive(s).", data: data() })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("routes gd and guided to the same compact guide", async () => {
    const fake = await attach({ plan: { success: true, message: "Planned", data: data() } })
    const runGuide = vi.fn(async () => undefined)
    const dependencies = createDependencies({ runGuide })
    const env = { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }
    await runProgram(["gd"], createHost({ tty: true, ...env }), dependencies)
    await runProgram(["guided"], createHost({ tty: true, ...env }), dependencies)
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
    const fake = await attach({ plan: { success: true, message: "Planned", data: data() } })
    const runUi = vi.fn(async () => undefined) as GifuCliDependencies["runUi"]
    const dependencies = createDependencies({ runUi })
    await runProgram([], createHost({ tty: true, XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }), dependencies)
    expect(runUi).toHaveBeenCalledTimes(1)

    const pipeHost = createHost()
    await runProgram([], pipeHost, dependencies)
    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(pipeHost.stdoutText()).toBe("")
    expect(pipeHost.stderrText()).toContain("No interactive terminal detected")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path ran 7-Zip and ffmpeg
    // from this process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["plan", "D:/packs/a.zip", "--json"], host, createDependencies())

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("reports a host failure as a non-zero exit instead of a partial success", async () => {
    const fake = await attach({
      make: { success: false, message: "ffmpeg was not found on this host", data: data({ archives: [archive({ status: "failed", error: "ffmpeg missing" })], errors: ["ffmpeg missing"] }) },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["make", "D:/packs/a.zip", "--live", "--json"], host, createDependencies())

    expect(process.exitCode).toBe(1)
    expect(JSON.parse(host.stdoutText()) as GifuResult).toMatchObject({ success: false })
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Planned" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "D:/packs/a.zip", "--json"], host, createDependencies())

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).not.toBe(0)
  })
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui`/`gd` definition makes
 * during a run can be observed.
 */
interface HangingHost extends FakeHost {
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: GifuResult): void
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  const controlPaths: string[] = []
  let streamResponse: ServerResponse | undefined

  const server = createServer((request, response) => {
    // The body has to be drained before `end` fires, or a GET without one never reaches this handler at all
    // and the face's `/health` probe times out instead of attaching.
    request.on("data", () => undefined)
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("op-hang", "queued") }))
        return
      }
      if (/^\/node-operations\/op-hang\/(cancel|pause|resume)$/.test(path)) {
        controlPaths.push(path)
        const phase = path.endsWith("/cancel") ? "cancelled" : path.endsWith("/pause") ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("op-hang", phase) }))
        return
      }
      if (path.endsWith("/stream")) {
        streamResponse = response
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.write(`${JSON.stringify({ type: "operation", operation: record("op-hang", "running", { startedAt: 2 }) })}\n`)
        resolveOpened()
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
    starts: [],
    controlPaths,
    streamOpened,
    finish: (result) => {
      if (!streamResponse) return
      const operation = { ...record("op-hang", "cancelled"), result }
      streamResponse.write(`${JSON.stringify({ type: "result", operation, result })}\n`)
      streamResponse.end()
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

/** A scripted host plus the handle to it, registered for teardown. */
async function attach(results: Record<string, GifuResult>): Promise<FakeHost> {
  const fake = await startFakeHost({ results })
  hosts.push(fake)
  return fake
}

function createDependencies(overrides: Partial<GifuCliDependencies> = {}): GifuCliDependencies {
  return {
    runGuide: vi.fn(async () => undefined),
    runUi: vi.fn(async () => undefined) as GifuCliDependencies["runUi"],
    ...overrides,
  }
}

interface TestHost extends CliHost {
  stdoutText: () => string
  stderrText: () => string
}

function createHost(options: { tty?: boolean } & Record<string, string> = {}): TestHost {
  const { tty = false, ...extraEnv } = options
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine running
  // it, and neither may a real node config decide the defaults.
  return {
    cwd: process.cwd(),
    env: { ...extraEnv, XIRANITE_CONFIG_PATH: MISSING_CONFIG, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
    stdin: { isTTY: tty } as CliHost["stdin"],
    stdout: { isTTY: tty, columns: 120, write(chunk: string) { stdout += chunk; return true } },
    stderr: { isTTY: tty, columns: 120, write(chunk: string) { stderr += chunk; return true } },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}
