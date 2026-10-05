import { beforeEach, afterEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { CliHost } from "@xiranite/cli-runtime"
import { createLogEnvelope, createLogSession, type LogEnvelope } from "@xiranite/logging"
import { createLogxHostDefinition, runProgram } from "./cli.js"
import type { LogxData, LogxResult } from "./core.js"

const HOST_TOKEN = "attach-token"
const NODE_ID = "logx"

/** One `POST /nodes/{id}/operations` as the host saw it. */
interface RecordedStart {
  nodeId: string
  input: Record<string, unknown>
  rawBody: string
}

interface ScriptedHostOptions {
  /** The result document answered per action, standing in for what the QuickJS realm produced. */
  results: Record<string, LogxResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /**
   * Keep the stream open instead of finishing it, so the control calls a `ui`/`gd` run makes during the
   * operation can be observed before the result frame arrives.
   */
  hold?: boolean
}

interface ScriptedHost {
  baseUrl: string
  starts: RecordedStart[]
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: LogxResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. Nothing here proves the host is correct;
 * the bodies follow `crates/xiranite-core/src/operation/dto.rs` the same way `packages/api`'s client does.
 */
async function startScriptedHost(options: ScriptedHostOptions): Promise<ScriptedHost> {
  const starts: RecordedStart[] = []
  const controlPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  let sequence = 0
  let lastOperationId = "op-1"
  let resolveOpened: () => void = () => {}
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  const pending = new Map<string, { nodeId: string; input: Record<string, unknown> }>()
  let held: ServerResponse | undefined

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route the host serves without the bearer token, and the face probes it
      // before it asks the operator anything, so a fake that did not answer it would look dead.
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if (headers["x-xiranite-token"] !== expectedToken) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && path.startsWith("/nodes/") && path.endsWith("/operations")) {
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ nodeId: path.split("/")[2] ?? "", input, rawBody: body })
        pending.set(operationId, { nodeId: path.split("/")[2] ?? NODE_ID, input })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      if (/^\/node-operations\/([^/]+)\/(cancel|pause|resume)$/.exec(path)) {
        controlPaths.push(path)
        const phase = path.endsWith("/cancel") ? "cancelled" : path.endsWith("/pause") ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(path.split("/")[2] ?? "", phase) }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const operationId = stream[1]
        lastOperationId = operationId
        const entry = pending.get(operationId)
        const frames = (options.events ?? []).map((event, index) => ({ type: "event" as const, index, event }))
        if (options.hold) {
          held = response
          response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
          response.write(`${JSON.stringify({ type: "operation", operation: record(operationId, "running", { startedAt: 2 }) })}\n`)
          for (const frame of frames) response.write(`${JSON.stringify(frame)}\n`)
          resolveOpened()
          return
        }
        const result = options.results[String(entry?.input?.action ?? "")] ?? { success: false, message: "no scripted result" }
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.end([
          JSON.stringify({ type: "operation", operation: record(operationId, "running", { startedAt: 2 }) }),
          ...frames.map((frame) => JSON.stringify(frame)),
          JSON.stringify({ type: "result", operation: record(operationId, "completed", { finishedAt: 4, result }), result }),
        ].join("\n") + "\n")
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
      if (!held) return
      const operation = { ...record(lastOperationId, "cancelled"), result }
      held.write(`${JSON.stringify({ type: "result", operation, result })}\n`)
      held.end()
      held = undefined
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: NODE_ID, phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

const session = createLogSession("2026-07-23T00:00:00.000Z")
const failure: LogEnvelope = createLogEnvelope({
  id: "one",
  timestamp: "2026-07-23T00:00:01.000Z",
  severityText: "error",
  eventName: "reader.failed",
  body: "decode failed",
  resource: { serviceName: "xiranite", processType: "frontend" },
  scope: { name: "neoview.reader" },
  session,
  error: { name: "DecodeError", message: "decode failed" },
})

/** The document `core.ts`'s `runLogx` produces, so the face renders a complete one. */
function data(partial: Partial<LogxData> = {}): LogxData {
  return {
    action: "query",
    directory: "D:/日志",
    files: ["D:/日志/current.jsonl"],
    issues: [],
    matchedCount: 0,
    returnedCount: 0,
    events: [],
    aggregate: { total: 0, bySeverity: {}, byScope: {}, byEvent: {}, bySession: {}, errors: [] },
    sessions: [],
    telemetry: { durationMs: 0, eventsPerSecond: 0, stormIntensity: 0, anomalyCells: [] },
    ...partial,
  }
}

function ok(partial: Partial<LogxData> = {}, action = "query"): LogxResult {
  return { success: true, message: `Matched ${partial.matchedCount ?? 0} log event(s).`, data: data({ action: action as LogxData["action"], ...partial }) }
}

const hosts: ScriptedHost[] = []

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

function tracked(options: ScriptedHostOptions): Promise<ScriptedHost> {
  return startScriptedHost(options).then((host) => {
    hosts.push(host)
    return host
  })
}

describe("logx CLI pipe surface", () => {
  test("runs a query as a host operation and prints the envelopes the host returned", async () => {
    const fake = await tracked({ results: { query: ok({ matchedCount: 1, returnedCount: 1, events: [failure] }) } })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram([
      "query", "--dir", "D:/日志/嵌套", "--level", "warn", "--scope", "neoview.reader",
      "--event", "reader.failed", "--search", "decode", "--limit", "2", "--order", "asc", "--json",
    ], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    // `--json` in pipe mode prints the selected output document (the events), not the result wrapper.
    const printed = JSON.parse(host.stdoutText()) as LogEnvelope[]
    expect(printed.map((event) => event.id)).toEqual(["one"])
    // One start call against the node's own route, carrying the input document verbatim.
    expect(fake.starts.map((start) => start.nodeId)).toEqual([NODE_ID])
    expect(fake.starts[0]?.input).toEqual({
      action: "query",
      directory: "D:/日志/嵌套",
      minimumSeverity: "warn",
      scope: "neoview.reader",
      eventName: "reader.failed",
      search: "decode",
      limit: 2,
      order: "asc",
    })
    // Unset filters stay absent instead of travelling as nulls the host would have to invent a meaning for.
    expect(fake.starts[0]?.rawBody).not.toContain("sessionId")
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"directory":"D:/日志/嵌套"`)
  })

  test("sessions, stats, errors and doctor are the same operation with a different output slice", async () => {
    const fake = await tracked({
      results: {
        sessions: ok({ sessions: [{ id: "sess-1", startedAt: "2026-07-23T00:00:00.000Z", eventCount: 12, errorCount: 3, processTypes: ["frontend"], scopes: ["app"] }], matchedCount: 12 }, "sessions"),
        stats: ok({ matchedCount: 42, telemetry: { durationMs: 1_000, eventsPerSecond: 42, stormIntensity: 0.5, anomalyCells: [] } }, "stats"),
        errors: ok({ aggregate: { total: 1, bySeverity: { error: 1 }, byScope: {}, byEvent: {}, bySession: {}, errors: [{ fingerprint: "fp-1", count: 7, sample: failure }] } }, "errors"),
        doctor: ok({ matchedCount: 9, issues: [{ file: "D:/日志/current.jsonl", lineNumber: 4, code: "invalid_json", message: "not JSON" }] }, "doctor"),
      },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["sessions"], host)
    await runProgram(["stats"], host)
    await runProgram(["errors"], host)
    await runProgram(["doctor"], host)

    const stdout = host.stdoutText()
    // `sessions` and `errors` are row output; `stats` and `doctor` are JSON even without the flag, as before.
    expect(stdout).toContain("2026-07-23T00:00:00.000Z      12     3 errors  sess-1")
    expect(stdout).toContain('"telemetry"')
    expect(stdout).toContain('"stormIntensity": 0.5')
    // `stats` is the aggregate + telemetry slice only, never the whole result document.
    expect(stdout).not.toContain('"matchedCount"')
    expect(stdout).toContain("     7  fp-1")
    expect(stdout).toContain('"invalid_json"')
    expect(fake.starts.map((start) => start.input.action)).toEqual(["sessions", "stats", "errors", "doctor"])
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await tracked({ results: { query: ok({ matchedCount: 0, events: [] }) } })
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["query", "--dir", "E:/logs", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "query", directory: "E:/logs" })
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there. The removed compat path ran the
    // core in-process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["query", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await tracked({ results: { query: ok({ events: [] }) }, token: "other-token" })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["query", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
  })

  test("keeps a host run that reported parse issues a failure with its output intact", async () => {
    const fake = await tracked({
      results: {
        query: {
          success: false,
          message: "Matched 1 event(s) with 1 parse issue(s).",
          data: data({ matchedCount: 1, returnedCount: 1, events: [failure], issues: [{ file: "D:/日志/current.jsonl", lineNumber: 4, code: "invalid_json", message: "not JSON" }] }),
        },
      },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["query"], host)

    expect(process.exitCode).toBe(1)
    // The rows still come from the host's envelopes; a `false` success only moves the exit code.
    expect(host.stdoutText()).toContain("2026-07-23T00:00:01.000Z  ERROR  neoview.reader  reader.failed  decode failed")
    expect(fake.starts.length).toBe(1)
  })

  test("a host operation that answered with no result document is an error, not a partial success", async () => {
    const fake = await tracked({ results: { query: { success: false, message: "no plugin runtime is attached to this host" } } })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    // The pipe surface has always answered a resultless run by throwing, which the entry guard turns
    // into one error line plus exit code 1; the host path keeps that shape.
    await expect(runProgram(["query", "--json"], host)).rejects.toThrow("no plugin runtime")
    expect(host.stdoutText()).toBe("")
    expect(fake.starts.length).toBe(1)
  })

  test("guided and ui refuse before the first prompt when no host can be reached", async () => {
    for (const mode of ["gd", "ui"] as const) {
      const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
      // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
      ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
      ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

      await runProgram([mode], host)

      expect(process.exitCode).toBe(1)
      // Nothing was drawn or asked: both surfaces resolve the host before the renderer or the prompts.
      expect(host.stdoutText()).toBe("")
      expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    }
  })

  test("leaves the command and flag vocabulary untouched", async () => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
    // Usage errors are still raised by the face's own parser, before any host call.
    await expect(runProgram(["nope", "--json"], host)).rejects.toThrow("Unknown LogX command: nope")
    await expect(runProgram(["query", "--level", "verbose"], host)).rejects.toThrow("Invalid --level: verbose")
    await expect(runProgram(["query", "--order", "sideways"], host)).rejects.toThrow("Invalid --order: sideways")
    await expect(runProgram(["query", "--limit", "0"], host)).rejects.toThrow("Invalid --limit: 0")
    await expect(runProgram(["query", "--not-a-flag"], host)).rejects.toThrow()
  })
})

describe("logx terminal definition", () => {
  test("runs on the host, forwards its events and keeps the started operation addressable", async () => {
    const fake = await tracked({
      hold: true,
      results: {},
      events: [{ type: "progress", progress: 60, message: "Applying structured log query." }],
    })
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLogxHostDefinition(face, { directory: "D:/日志", minimum_severity: "warn", limit: 1_200 }, "en")
    const messages: string[] = []

    const running = definition.run({ action: "query", directory: "D:/日志", minimumSeverity: "warn", limit: 1_200, order: "desc" }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(messages).toEqual(["Applying structured log query."])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-1/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await tracked({ hold: true, results: {} })
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLogxHostDefinition(face, {}, "en")

    const running = definition.run({ action: "stats" }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Matched 0 log event(s).", data: data({ action: "stats" }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-1/pause", "/node-operations/op-1/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await tracked({ hold: true, results: {} })
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLogxHostDefinition(face, {}, "en")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  test("the node's own defaults still reach the shared schema, in the same vocabulary", async () => {
    const face = createHost({ XIRANITE_BACKEND_URL: "http://127.0.0.1:1", XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLogxHostDefinition(face, { directory: "D:/日志", minimum_severity: "warn", limit: 1_200 }, "en")

    expect(definition.schema.id).toBe("logx")
    expect(definition.schema.initialValues).toMatchObject({ action: "query", directory: "D:/日志", minimumSeverity: "warn", limit: 1_200, order: "desc" })
    expect(definition.schema.fields.map((field) => field.id)).toEqual([
      "action", "directory", "minimumSeverity", "scope", "eventName", "sessionId", "search", "since", "until", "limit", "order",
    ])
    expect(definition.schema.isDangerous(definition.schema.toInput(definition.schema.initialValues))).toBe(false)
  })
})

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine
  // running it — otherwise a real host on the developer's box would answer and prove nothing.
  return {
    cwd: process.cwd(),
    env: { ...extraEnv, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        stdout += chunk
        return true
      },
    },
    stderr: {
      isTTY: false,
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
