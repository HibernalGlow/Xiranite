import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CliHost } from "@xiranite/cli-runtime"
import { containsAnsi, explicitInteractionModes } from "@xiranite/cli-runtime/testing"
import type { TerminalPreferenceController } from "@xiranite/cli-runtime/terminal"

import type { RecycleuData, RecycleuInput, RecycleuResult } from "./core.js"
import { RECYCLEU_CYCLES_HELP, createRecycleuHostDefinition, runProgram, type RecycleuCliDependencies } from "./cli.js"

const HOST_TOKEN = "attach-token"

interface RecordedStart {
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
  nodeId: string
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  controlPaths: string[]
  /** Only meaningful with `hang`: end the open stream with a terminal result frame. */
  finish(result: RecycleuResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the
 * point of these tests is that the face holds no node engine of its own. The bodies follow
 * `crates/xiranite-core/src/operation/dto.rs` and the client's `packages/api/src/operationsClient.ts`
 * mirror; nothing here proves the host is correct. `/health` is answered token-free because that
 * is the one route the host serves without the bearer token, and the face probes it before it
 * renders anything.
 */
async function startFakeHost(options: {
  results?: Partial<Record<string, RecycleuResult>>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** Hold the stream open until `finish()`, so the control calls can be observed. */
  hang?: boolean
} = {}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const controlPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  const pending = new Map<string, { nodeId: string; input: Record<string, unknown> }>()
  let streamResponse: ServerResponse | undefined
  let sequence = 0

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
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
        const operationId = options.hang ? "op-hang" : `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ input, rawBody: body, nodeId: path.split("/")[2] ?? "" })
        pending.set(operationId, { nodeId: "recycleu", input })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const control = /^\/node-operations\/([^/]+)\/(cancel|pause|resume)$/.exec(path)
      if (request.method === "POST" && control) {
        controlPaths.push(path)
        const phase = control[2] === "cancel" ? "cancelled" : control[2] === "pause" ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(control[1]!, phase) }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        if (options.hang) {
          streamResponse = response
          response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
          response.write(`${JSON.stringify({ type: "operation", operation: record(stream[1], "running", { startedAt: 2 }) })}\n`)
          response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "cleaned 1 time(s), next clean in 9s" } })}\n`)
          return
        }
        const entry = pending.get(stream[1])
        const result = options.results?.[String(entry?.input?.action ?? "")] ?? { success: false, message: "no scripted result" }
        const frames = [
          { type: "operation", operation: record(stream[1], "running", { startedAt: 2 }) },
          ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
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
    controlPaths,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
    finish: (result: RecycleuResult) => {
      if (!streamResponse) return
      const operation = { ...record("op-hang", "cancelled"), result }
      streamResponse.write(`${JSON.stringify({ type: "result", operation, result })}\n`)
      streamResponse.end()
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "recycleu", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s result data shape, so the face renders a complete document. */
function data(partial: Partial<RecycleuData> = {}): RecycleuData {
  return { timerStatus: "idle", cleanCount: 0, lastCleanTime: null, remainingSeconds: 0, ...partial }
}

const hosts: FakeHost[] = []
const tmpDirs: string[] = []
let emptyConfigPath = ""

beforeAll(async () => {
  // Hermetic config: `loadNodeConfigWithHints` reads `$XIRANITE_CONFIG_PATH`; without this every
  // test would depend on the machine running it having (or not having) a real `[nodes.recycleu]`.
  const dir = await mkdtemp(join(tmpdir(), "recycleu-cli-test-"))
  tmpDirs.push(dir)
  emptyConfigPath = join(dir, "xiranite.config.toml")
  await writeFile(emptyConfigPath, "", "utf8")
})

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

afterAll(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("recycleu CLI pipe face", () => {
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

  test("runs status as a host operation with the input document verbatim", async () => {
    const fake = await startFakeHost({
      results: { status: { success: true, message: "Recycle cleaner is idle.", data: data() } },
    })
    hosts.push(fake)
    const host = createHost({ env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } })

    await runProgram(["status", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(containsAnsi(host.stdoutText())).toBe(false)
    const result = JSON.parse(host.stdoutText()) as RecycleuResult
    expect(result.success).toBe(true)
    expect(result.data?.timerStatus).toBe("idle")
    // One start call on this node's route with exactly the defaults the old pipe built.
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.nodeId).toBe("recycleu")
    expect(fake.starts[0]?.input).toEqual({ action: "status", driveLetter: "", interval: 10, maxCycles: 360 })
  })

  test("clean sends the drive letter verbatim, Chinese included, and renders host events without --json", async () => {
    const fake = await startFakeHost({
      results: { clean_now: { success: true, message: "Recycle bin is already empty.", data: data() } },
    })
    hosts.push(fake)
    const jsonHost = createHost({ env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } })

    await runProgram(["clean", "--drive", "盘", "--json"], jsonHost)

    expect(process.exitCode).toBe(0)
    expect(jsonHost.stdoutText().trim().startsWith("{")).toBe(true)
    expect(fake.starts[0]?.input.driveLetter).toBe("盘")
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"driveLetter":"盘"`)

    const eventFake = await startFakeHost({
      events: [{ type: "log", message: "cleaned C: recycle bin" }],
      results: { clean_now: { success: true, message: "Recycle bin emptied.", data: data({ cleanCount: 1, lastCleanTime: "10:00:00" }) } },
    })
    hosts.push(eventFake)
    const plainHost = createHost({ env: { XIRANITE_BACKEND_URL: eventFake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } })

    await runProgram(["clean", "--drive", "C"], plainHost)

    expect(process.exitCode).toBe(0)
    expect(plainHost.stdoutText()).toContain("cleaned C: recycle bin")
    expect(plainHost.stdoutText()).toContain("Recycle bin emptied.")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({
      results: { start: { success: true, message: "Auto-clean completed, cleaned 1 time(s).", data: data({ timerStatus: "completed", cleanCount: 1 }) } },
    })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["start", "--drive", "D", "--interval", "5", "--cycles", "1", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).toEqual({ action: "start", driveLetter: "D", interval: 5, maxCycles: 1 })
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file and no host binary: the face now owns the host
    // lifecycle (ADR-0074 §6), so this is the refusal path. The removed compat path ran the node
    // in-process here, which is exactly what must not happen any more — stdout staying empty is
    // that claim, because a local run would have printed a JSON result document.
    const host = createHost({ env: { XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") } })

    await runProgram(["status", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ token: "other-token" })
    hosts.push(fake)
    const host = createHost({ env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } })

    await runProgram(["clean", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    // No fallback document was printed either.
    expect(host.stdoutText()).toBe("")
  })

  test("reports a host result with success:false as exit 1, not as a throw", async () => {
    const fake = await startFakeHost({
      results: { start: { success: false, message: "Clean interval cannot be less than 5 seconds.", data: data({ timerStatus: "error" }) } },
    })
    hosts.push(fake)
    const host = createHost({ env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } })

    await runProgram(["start", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as RecycleuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("cannot be less than 5 seconds")
  })

  test("keeps usage errors at exit 2 and prints the usage line for --help", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const env = { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }
    const host = createHost({ env })

    await runProgram(["nope", "--json"], host)
    expect(process.exitCode).toBe(2)
    expect(host.stderrText()).toContain("Unknown RecycleU command")

    process.exitCode = 0
    await runProgram(["clean", "--interval", "2", "--json"], createHost({ env }))
    expect(process.exitCode).toBe(2)

    process.exitCode = 0
    const helpHost = createHost({ env })
    await runProgram(["--help"], helpHost)
    expect(process.exitCode).toBe(0)
    // `--help` answers from the node's own help dictionary (the shared card), never from the host.
    expect(helpHost.stdoutText()).toContain("xiranite recycleu")
    // Only the refused runs reached the host.
    expect(fake.starts.length).toBe(0)
  })

  test("refuses gd and ui before rendering anything when no host is present", async () => {
    // A terminal is present, so the refusal under test is the host one and not the TTY guard.
    const dependencies = createDependencies()
    const gdHost = createHost({ tty: true, env: { XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") } })
    await runProgram(["gd"], gdHost, dependencies)
    expect(process.exitCode).toBe(1)
    expect(gdHost.stdoutText()).toBe("")
    expect(gdHost.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    expect(dependencies.runGuide).not.toHaveBeenCalled()

    process.exitCode = 0
    const uiHost = createHost({ tty: true, env: { XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") } })
    await runProgram(["ui"], uiHost, dependencies)
    expect(process.exitCode).toBe(1)
    expect(uiHost.stdoutText()).toBe("")
    expect(dependencies.runUi).not.toHaveBeenCalled()
  })

  test("uses nodes.recycleu.cli defaults and starts in Chinese against the host", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recycleu-mode-"))
    tmpDirs.push(dir)
    const configPath = join(dir, "xiranite.config.toml")
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
    const fake = await startFakeHost()
    hosts.push(fake)
    let language: string | undefined
    let initialValues: Record<string, unknown> | undefined
    const runGuide: RecycleuCliDependencies["runGuide"] = async (definition, options) => {
      language = options.language
      initialValues = definition.schema.initialValues as unknown as Record<string, unknown>
    }
    await runProgram([], createHost({ tty: true, configPath, env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } }), createDependencies({ runGuide }))
    expect(process.exitCode).toBe(0)
    expect(language).toBe("zh")
    expect(initialValues).toMatchObject({ interval: 30, maxCycles: 0, driveLetter: "C" })
    // The guide renderer only sees the host definition; nothing ran because no one confirmed.
    expect(fake.starts.length).toBe(0)
  })

  test("saves only nodes.recycleu.cli preferences through the shared settings controller", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recycleu-preferences-"))
    tmpDirs.push(dir)
    const configPath = join(dir, "xiranite.config.toml")
    await writeFile(configPath, "", "utf8")
    const fake = await startFakeHost()
    hosts.push(fake)
    let controller: TerminalPreferenceController | undefined
    const dependencies = createDependencies()
    dependencies.runUi = vi.fn(async (_definition, options) => { controller = options.preferences })
    await runProgram(["ui"], createHost({ tty: true, configPath, env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } }), dependencies)
    await controller?.save({ theme: "dracula", defaultMode: "pipe", language: "zh" })
    const content = await readFile(configPath, "utf8")
    expect(content).toContain("[nodes.recycleu.cli]")
    expect(content).toContain('default_mode = "pipe"')
    expect(content).not.toContain("interaction_mode")
  })

  test("documents zero cycles as unlimited", () => {
    expect(RECYCLEU_CYCLES_HELP).toContain("use 0 for unlimited")
  })
})

describe("recycleu host-backed terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startFakeHost({ hang: true })
    hosts.push(fake)
    const face = createHost({ env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } })
    const definition = createRecycleuHostDefinition({}, "zh", face)
    const messages: string[] = []

    const running = definition.run({ action: "start", driveLetter: "C", interval: 5, maxCycles: 0 }, (event) => messages.push(event.message))
    await waitUntil(() => fake.starts.length === 1)
    // The stream is what the face opened; cancel addresses the operation it just started.
    await waitUntilOpenStream(fake)
    await definition.cancel?.()
    fake.finish({ success: false, message: "Auto-clean cancelled after 1 clean(s).", data: data({ timerStatus: "cancelled", cleanCount: 1, remainingSeconds: 4 }) })
    const result = await running

    expect(messages).toContain("cleaned 1 time(s), next clean in 9s")
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
    expect(fake.starts[0]?.input).toEqual({ action: "start", driveLetter: "C", interval: 5, maxCycles: 0 })
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startFakeHost({ hang: true })
    hosts.push(fake)
    const face = createHost({ env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } })
    const definition = createRecycleuHostDefinition({}, "zh", face)

    const running = definition.run({ action: "start", driveLetter: "", interval: 10, maxCycles: 360 }, () => undefined)
    await waitUntil(() => fake.starts.length === 1)
    await waitUntilOpenStream(fake)
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Auto-clean completed, cleaned 1 time(s).", data: data({ timerStatus: "completed", cleanCount: 1 }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual([
      "/node-operations/op-hang/pause",
      "/node-operations/op-hang/resume",
    ])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startFakeHost({ hang: true })
    hosts.push(fake)
    const face = createHost({ env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } })
    const definition = createRecycleuHostDefinition({}, "zh", face)

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  test("the shared schema keeps the danger gate for clean_now and start", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const definition = createRecycleuHostDefinition({}, "zh", createHost({ env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } }))
    // The gate the guided/TUI faces consult before calling `run` — data, not a reimplementation.
    expect(definition.schema.isDangerous?.({ action: "clean_now" } as RecycleuInput)).toBe(true)
    expect(definition.schema.isDangerous?.({ action: "start" } as RecycleuInput)).toBe(true)
    expect(definition.schema.isDangerous?.({ action: "status" } as RecycleuInput)).toBe(false)
    const prompt = definition.schema.dangerPrompt?.({ action: "clean_now" } as RecycleuInput)
    expect(prompt?.title).toBeTruthy()
    expect(prompt?.body).toBeTruthy()
    expect(prompt?.confirmLabel).toBeTruthy()
  })
})

/**
 * The hanging fake answers `startOperation` immediately but keeps the stream open; the client
 * opens it right after, so seeing the second request means the run is really mid-flight.
 */
async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("fake host condition never happened")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitUntilOpenStream(fake: FakeHost): Promise<void> {
  // The stream GET is not recorded in `starts`; the client always opens it right after the start
  // was answered, so a short settle is enough for the control call to have something to address.
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(fake.starts.length).toBeGreaterThan(0)
}

function createDependencies(overrides: { runGuide?: RecycleuCliDependencies["runGuide"] } = {}): RecycleuCliDependencies & { runGuide: Mock; runUi: Mock } {
  // `vi.fn` cannot synthesise the renderers' generic call signature, so the mock is cast back to
  // the declared dependency type; the seam only swaps the *renderer*, never the operations client.
  return {
    runGuide: vi.fn(overrides.runGuide ?? (async () => undefined)) as unknown as RecycleuCliDependencies["runGuide"] & Mock,
    runUi: vi.fn(async () => undefined) as unknown as RecycleuCliDependencies["runUi"] & Mock,
  }
}

function createHost(options: { tty?: boolean; env?: Record<string, string>; configPath?: string } = {}): TestHost {
  let stdout = ""
  let stderr = ""
  const tty = options.tty ?? false
  // Deliberately not spreading process.env: an attach must come from this test, not from the
  // machine running it, and a real user config must never leak into a node-config assertion.
  return {
    cwd: process.cwd(),
    env: { ...options.env, XIRANITE_CONFIG_PATH: options.configPath ?? emptyConfigPath, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
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

type TestHost = CliHost & { stdoutText: () => string; stderrText: () => string }
