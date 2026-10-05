import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { CliHost } from "@xiranite/cli-runtime"
import { createTimeuHostDefinition, runProgram, type TimeuCliDependencies } from "./cli.js"
import type { TimeuData, TimeuResult } from "./core.js"

const HOST_TOKEN = "attach-token"

/** Built at runtime so this file carries no escape literal for a bundler to reinterpret. */
const ANSI_ESCAPE = `${String.fromCharCode(27)}[`

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. `crates/xiranite-api` is still being
 * wired, so the bodies below follow `nodeOperationSchema`/`nodeRunResultSchema` — the shapes
 * `packages/api/src/operationsClient.ts` mirrors — plus this file's own `data()` mirror of `core.ts`.
 * Nothing here proves the host is correct, and nothing here needs a host binary installed.
 */
interface RecordedStart {
  /** The node id the face addressed, read off the route rather than off the body. */
  nodeId: string
  /** The timeu input document exactly as the face serialised it. */
  input: Record<string, unknown>
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  /** `POST …/{cancel,pause,resume}` paths, in the order they arrived. */
  controlPaths: string[]
  /** Resolves once a `hang` host has been asked for its operation stream. */
  streamOpened: Promise<void>
  /** Closes a hanging stream with this result document; a no-op when nothing is hanging. */
  finish(result: TimeuResult): void
  close(): Promise<void>
}

async function startFakeHost(options: {
  /** Keyed by the `action` of the input document, the way the face's own pipe router keys it. */
  results: Record<string, TimeuResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** Keeps the stream open until `finish()`, so mid-run control calls are observable. */
  hang?: boolean
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const controlPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  const operationId = "op-timeu-1"
  let pending: Record<string, unknown> | undefined
  let streamResponse: ServerResponse | undefined
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => {
    resolveOpened = resolve
  })

  /** The operation record for this fake's single scripted operation. */
  const record = (phase: string, extra: Record<string, unknown> = {}) => ({
    operationId,
    nodeId: "timeu",
    phase,
    createdAt: 1,
    updatedAt: 2,
    eventCount: (options.events ?? []).length,
    ...extra,
  })
  const ndjson = (response: ServerResponse, frames: unknown[]): void => {
    response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
    response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`)
  }

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route `crates/xiranite-api` serves without the bearer token, and the face
      // probes it before it draws a terminal screen — a fake that did not answer it would look dead.
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
        starts.push({ nodeId: decodeURIComponent(path.split("/")[2] ?? ""), input })
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
          streamResponse = response
          resolveOpened()
          return
        }
        const result = options.results[String(pending?.action ?? "")] ?? { success: false, message: "no scripted result", data: data() }
        ndjson(response, [
          { type: "operation", operation: record("running", { startedAt: 2 }) },
          ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
          { type: "result", operation: record("completed", { finishedAt: 4, result }), result },
        ])
        return
      }

      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
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
      ndjson(response, [{ type: "result", operation: record("completed", { finishedAt: 6, result }), result }])
    },
    close: async () => {
      // A stream still held open by a failed assertion would otherwise keep this socket from closing.
      streamResponse?.end()
      streamResponse = undefined
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

/** `core.ts`'s `data()` defaults, so the face renders a complete result document. */
function data(partial: Partial<TimeuData> = {}): TimeuData {
  return {
    plan: [],
    records: [],
    recordPath: "",
    scannedCount: 0,
    backupCount: 0,
    restoredCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
    ...partial,
  }
}

function planItem(partial: Partial<TimeuData["plan"][number]> = {}): TimeuData["plan"][number] {
  return { path: "C:/demo.txt", operation: "backup", status: "pending", ...partial }
}

/** Only the renderers are injectable any more: the engine is the host's, so there is no runtime to hand in. */
function deps(): TimeuCliDependencies {
  return { runGuide: vi.fn(async () => undefined), runUi: vi.fn(async () => undefined) }
}

type HostSink = CliHost & {
  stdoutText: () => string
  stderrText: () => string
}

/**
 * A face host whose env attaches to this test's scripted server. `process.env` is deliberately not
 * spread: an attach must come from the test rather than from the machine, and a missing config file
 * keeps the documented timeu defaults (`dryRun: true`) under test.
 */
function createHost(extraEnv: Record<string, string> = {}, tty = false): HostSink {
  const out: string[] = []
  const err: string[] = []
  const sink = (buffer: string[]) => ({ isTTY: tty, columns: 120, write: (value: string) => (buffer.push(value), true) })
  return {
    cwd: process.cwd(),
    env: {
      ...extraEnv,
      NO_COLOR: "1",
      XIRANITE_CONFIG_PATH: `${process.cwd()}/artifacts/test-runs/timeu-missing.toml`,
    },
    stdin: { isTTY: tty } as CliHost["stdin"],
    stdout: sink(out),
    stderr: sink(err),
    stdoutText: () => out.join(""),
    stderrText: () => err.join(""),
  }
}

/** The same host, attached to a scripted server started for this test alone. */
async function attachToHost(options: Parameters<typeof startFakeHost>[0], tty = false): Promise<HostSink> {
  const fake = await startFakeHost(options)
  hosts.push(fake)
  return createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }, tty)
}

/** Attach env plus an unreachable host binary: the way to force the §6 lifecycle to fail. */
function withoutAnyHost(): HostSink {
  return createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-dev-host") })
}

const hosts: FakeHost[] = []

// The face reports failure by setting `process.exitCode`, which starts out undefined.
beforeEach(() => {
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("TimeU pipe face", () => {
  test("posts a scan as a host operation and writes pipe JSON without ANSI", async () => {
    const fake = await startFakeHost({
      results: {
        scan: {
          success: true,
          message: "TimeU planned 1 item(s).",
          data: data({ plan: [planItem()], scannedCount: 1, recordPath: "C:/timeu-timestamps.json" }),
        },
      },
    })
    hosts.push(fake)
    const h = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "C:/demo.txt", "--json"], h, deps())

    expect(process.exitCode).toBe(0)
    // `--json` output stays machine-readable: no CSI sequence from the theme layer reaches stdout.
    expect(h.stdoutText()).not.toContain(ANSI_ESCAPE)
    const result = JSON.parse(h.stdoutText()) as TimeuResult
    expect(result.success).toBe(true)
    expect(result.data?.scannedCount).toBe(1)
    // Exactly one start call, addressed at this node by id, with the pipe document as its input.
    expect(fake.starts.map((start) => start.nodeId)).toEqual(["timeu"])
    expect(fake.starts[0]?.input).toMatchObject({
      action: "scan",
      paths: ["C:/demo.txt"],
      recordPath: "",
      recursive: true,
      includeDirectories: false,
      dryRun: true,
    })
  })

  test("maps the pipe flags onto the input document and renders host events", async () => {
    const fake = await startFakeHost({
      results: {
        backup: {
          success: true,
          message: "TimeU backed up 1 timestamp record(s).",
          data: data({ plan: [planItem({ status: "success" })], backupCount: 1, scannedCount: 1 }),
        },
      },
      events: [
        { type: "progress", progress: 15, message: "Collecting timestamp targets." },
        { type: "log", message: "Planning 1 timestamp item(s)." },
      ],
    })
    hosts.push(fake)
    const h = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(
      ["backup", "C:/demo.txt", "--record", "C:/led.json", "--no-recursive", "--include-directories", "--dry-run"],
      h,
      deps(),
    )

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({
      action: "backup",
      paths: ["C:/demo.txt"],
      recordPath: "C:/led.json",
      recursive: false,
      includeDirectories: true,
      dryRun: true,
    })
    // Events come off the host stream, not off a local run, and the final line is the result message.
    expect(h.stdoutText()).toContain("Collecting timestamp targets.")
    expect(h.stdoutText()).toContain("Planning 1 timestamp item(s).")
    expect(h.stdoutText()).toContain("TimeU backed up 1 timestamp record(s).")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({
      results: { restore: { success: true, message: "TimeU restored 1 timestamp(s).", data: data({ plan: [planItem({ operation: "restore", status: "success" })], restoredCount: 1 }) } },
    })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const h = createHost()

    await runProgram(["restore", "C:/demo.txt", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], h, deps())

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "restore", paths: ["C:/demo.txt"] })
  })

  test("reports a host failure as exit code 1 with the host's own result document", async () => {
    const h = await attachToHost({
      results: {
        backup: { success: false, message: "EACCES: permission denied C:/led.json", data: data({ errors: ["C:/led.json: EACCES"], errorCount: 1 }) },
      },
    })

    await runProgram(["backup", "C:/demo.txt", "--json"], h, deps())

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(h.stdoutText()) as TimeuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("permission denied")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { scan: { success: true, message: "planned", data: data() } }, token: "another-token" })
    hosts.push(fake)
    const h = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "C:/demo.txt", "--json"], h, deps())

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(h.stdoutText()).toBe("")
    // The client names the route and the status, which is how a face tells "wrong token" from "no host".
    expect(h.stderrText()).toContain("/nodes/timeu/operations")
    expect(h.stderrText()).toContain("401")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there. Running timeu in-process here is
    // exactly the compat path ADR-0074 §5 removed, so a clean stdout is part of the assertion.
    const h = withoutAnyHost()

    await runProgram(["scan", "C:/demo.txt", "--json"], h, deps())

    expect(process.exitCode).toBe(1)
    expect(h.stdoutText()).toBe("")
    expect(h.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    expect(h.stderrText()).toContain("--backend <url> --token <token>")
  })

  test("keeps the usage error for an unknown action and never reaches a host", async () => {
    const fake = await startFakeHost({ results: { scan: { success: true, message: "planned", data: data() } } })
    hosts.push(fake)
    const h = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["nonsense", "C:/demo.txt"], h, deps())

    expect(process.exitCode).toBe(2)
    expect(h.stderrText()).toContain("Unknown TimeU command")
    expect(fake.starts.length).toBe(0)
  })
})

describe("TimeU interactive faces", () => {
  test("routes ui and gd to the renderers once the host answers", async () => {
    const h = await attachToHost({ results: {} }, true)
    const d = deps()

    await runProgram(["ui"], h, d)
    await runProgram(["gd"], h, d)

    expect(h.stderrText()).toBe("")
    expect(d.runUi).toHaveBeenCalledTimes(1)
    expect(d.runGuide).toHaveBeenCalledTimes(1)
  })

  test("refuses to open a terminal face before the first prompt when no host can be reached", async () => {
    const h = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-dev-host") }, true)
    const d = deps()

    await runProgram(["ui"], h, d)

    // Nothing was drawn: the screen and its prompts come after the host is resolved.
    expect(process.exitCode).toBe(1)
    expect(d.runUi).not.toHaveBeenCalled()
    expect(h.stdoutText()).toBe("")
    expect(h.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("runs on the host and keeps the started operation addressable for cancel", async () => {
    const fake = await startFakeHost({
      hang: true,
      results: { scan: { success: true, message: "TimeU planned 1 item(s).", data: data({ plan: [planItem()], scannedCount: 1 }) } },
    })
    hosts.push(fake)
    const h = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createTimeuHostDefinition(h, { recordPath: "", recursive: true, includeDirectories: false, dryRun: true }, "zh")

    const running = definition.run({ action: "scan", listText: "C:/demo.txt" }, () => undefined)
    await fake.streamOpened
    expect(fake.starts[0]?.input).toMatchObject({ action: "scan", listText: "C:/demo.txt" })

    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled.", data: data() })
    const result = await running

    expect(fake.controlPaths).toEqual(["/node-operations/op-timeu-1/cancel"])
    expect(result.message).toContain("cancelled")
  })

  test("pause and resume address the same operation, and go inert once the run settles", async () => {
    const fake = await startFakeHost({
      hang: true,
      results: { backup: { success: true, message: "TimeU backed up 1 timestamp record(s).", data: data({ backupCount: 1 }) } },
    })
    hosts.push(fake)
    const h = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createTimeuHostDefinition(h, { recordPath: "", recursive: true, includeDirectories: false, dryRun: false }, "zh")

    const running = definition.run({ action: "backup", listText: "C:/demo.txt" }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "TimeU backed up 1 timestamp record(s).", data: data({ backupCount: 1 }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-timeu-1/pause", "/node-operations/op-timeu-1/resume"])
    // The started record is released with the run, so a late control call cannot hit another operation.
    await definition.cancel?.()
    expect(fake.controlPaths.length).toBe(2)
  })

  test("control calls are inert before anything has been started", async () => {
    const fake = await startFakeHost({ results: {} })
    hosts.push(fake)
    const h = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createTimeuHostDefinition(h, { recordPath: "", recursive: true, includeDirectories: false, dryRun: true }, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })
})
