import { afterEach, beforeEach, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createSameaHostDefinition, runProgram } from "./cli.js"
import type { SameaInput, SameaData, SameaResult } from "./core.js"

const HOST_TOKEN = "attach-token"

interface RecordedStart {
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that this face holds no node engine of its own — nothing here runs `core.ts` and nothing
 * here opens a file. The bodies mirror the operation DTOs `crates/xiranite-api` answers with, so they
 * prove the face's side of the wire and make no claim about the host.
 */
interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  close(): Promise<void>
}

async function startFakeHost(options: {
  result: SameaResult
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  let sequence = 0

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route the host serves without the bearer token, and the face probes it before
      // it asks the operator anything, so a fake that did not answer it would look dead.
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

      const start = /^\/nodes\/([^/]+)\/operations$/.exec(path)
      if (request.method === "POST" && start?.[1]) {
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ input, rawBody: body })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued", { nodeId: decodeURIComponent(start[1]) }) }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const frames = [
          { type: "operation", operation: record(stream[1], "running", { startedAt: 2 }) },
          ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
          { type: "result", operation: record(stream[1], "completed", { finishedAt: 4, result: options.result }), result: options.result },
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
  return { operationId, nodeId: "samea", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** A complete `SameaData` document, so the face renders a real result instead of a partial one. */
function sameaData(partial: Partial<SameaData> = {}): SameaData {
  return {
    action: "plan", centralize: false, minOccurrences: 1,
    items: [{ rootPath: "D:/archives", sourcePath: "D:/archives/[Alice] set.zip", targetPath: "D:/archives/Alice/[Alice] set.zip", sourceName: "[Alice] set.zip", artistKey: "alice", artistName: "Alice", status: "ready" }],
    groups: [{ key: "alice", name: "Alice", targetDir: "D:/archives/Alice", count: 1, status: "ready" }],
    scannedCount: 1, detectedCount: 1, readyCount: 1, movedCount: 0, ignoredCount: 0, skippedCount: 0, conflictCount: 0, errorCount: 0, errors: [],
    ...partial,
  }
}

const hosts: { close(): Promise<void> }[] = []

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

/** A finished host run, with the attach already in the face's environment. */
async function attachableHost(result: SameaResult, options: { token?: string } = {}) {
  const host = await startFakeHost({ result, ...options })
  hosts.push(host)
  return { host, face: createHost({ XIRANITE_BACKEND_URL: host.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }) }
}

test("refuses UI without terminal", async () => {
  const h = createHost()
  await runProgram([], h)
  expect(process.exitCode).toBe(2)
  expect(h.stderrText()).toContain("samea ui")
})

test("plans as a host operation and prints the result document", async () => {
  const { host, face } = await attachableHost({ success: true, message: "SameA planned 1 archive transfer(s).", data: sameaData() })

  await runProgram(["plan", "D:/archives/示例", "--min", "3", "--centralize", "--json"], face)

  expect(process.exitCode).toBe(0)
  expect(face.stderrText()).toBe("")
  expect(face.stdoutText().trim().startsWith("{")).toBe(true)
  const result = JSON.parse(face.stdoutText()) as SameaResult
  expect(result.success).toBe(true)
  expect(result.data?.readyCount).toBe(1)
  // One start call on the same node id, carrying the node input verbatim: absolute paths and CJK included.
  expect(host.starts.map((start) => start.input.action)).toEqual(["plan"])
  expect(host.starts[0]?.input).toMatchObject({ paths: ["D:/archives/示例"], minOccurrences: 3, centralize: true, dryRun: true })
  expect(host.starts[0]?.rawBody).toContain(String.raw`"D:/archives/示例"`)
})

test("classify keeps the safe default: dry run stays on unless it is explicitly turned off", async () => {
  const { host, face } = await attachableHost({ success: true, message: "SameA planned 1 archive transfer(s).", data: sameaData({ action: "classify" }) })

  await runProgram(["classify", "D:/archives", "--json"], face)

  expect(process.exitCode).toBe(0)
  // Naming the write action on a command line is not enough to move files: `dryRun` still travels true, so
  // the live classification decision stays where the schema puts it — behind an explicit opt-out.
  expect(host.starts.map((start) => start.input)).toEqual([expect.objectContaining({ action: "classify", dryRun: true })])
})

test("renders host results as tab rows without --json", async () => {
  const { host, face } = await attachableHost({ success: true, message: "SameA planned 1 archive transfer(s).", data: sameaData() })

  await runProgram(["plan", "D:/archives"], face)

  expect(process.exitCode).toBe(0)
  const stdout = face.stdoutText()
  expect(stdout).toContain("SameA planned 1 archive transfer(s).")
  expect(stdout).toContain("ready\tAlice\tD:/archives/[Alice] set.zip\t->\tD:/archives/Alice/[Alice] set.zip")
  expect(host.starts.length).toBe(1)
})

test("takes the attach from its own flags, which never reach the node input", async () => {
  const host = await startFakeHost({ result: { success: true, message: "SameA planned 0 archive transfer(s).", data: sameaData({ items: [], readyCount: 0 }) } })
  hosts.push(host)
  // No backend variables in the environment: only the flags can attach this run.
  const face = createHost()

  await runProgram(["plan", "D:/archives", "--backend", host.baseUrl, "--token", HOST_TOKEN, "--json"], face)

  expect(process.exitCode).toBe(0)
  expect(host.starts.length).toBe(1)
  const input = host.starts[0]?.input ?? {}
  expect(input).not.toHaveProperty("backend")
  expect(input).not.toHaveProperty("token")
  // The attach url is not mistaken for an archive root either.
  expect(input).toMatchObject({ paths: ["D:/archives"] })
})

test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
  // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
  // way this run can fail is a host binary that is not there. The removed compat path ran `core.ts` in this
  // process here, which is exactly what must not happen any more.
  const face = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

  await runProgram(["plan", "D:/archives", "--json"], face)

  expect(process.exitCode).toBe(1)
  expect(face.stdoutText()).toBe("")
  expect(face.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  // The hint still travels, because attach remains the way to point at a host that is already running.
  expect(face.stderrText()).toContain("--backend <url> --token <token>")
  expect(face.stderrText()).toContain("XIRANITE_BACKEND_URL")
  expect(face.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
})

test("a wrong token is the host's 401, not a silent local run", async () => {
  const { host, face } = await attachableHost({ success: true, message: "planned" }, { token: "other-token" })

  await runProgram(["plan", "D:/archives", "--json"], face)

  expect(host.starts.length).toBe(0)
  expect(process.exitCode).toBe(1)
  expect(face.stdoutText()).toBe("")
})

test("a host that reports failure answers with its own document and exit code 1", async () => {
  const { face } = await attachableHost({ success: false, message: "At least one archive root directory is required.", data: sameaData({ errorCount: 1, readyCount: 0 }) })

  await runProgram(["plan", "D:/archives", "--json"], face)

  expect(process.exitCode).toBe(1)
  expect((JSON.parse(face.stdoutText()) as SameaResult).success).toBe(false)
})

test("guided mode refuses before the first prompt when no host can be reached", async () => {
  const face = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
  // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
  ;(face.stdin as unknown as { isTTY: boolean }).isTTY = true
  ;(face.stdout as unknown as { isTTY: boolean }).isTTY = true

  await runProgram(["gd"], face)

  expect(process.exitCode).toBe(1)
  // Nothing was asked: the guide's first prompt comes after the host is resolved.
  expect(face.stdoutText()).toBe("")
  expect(face.stderrText()).toContain("XIRANITE_HOST_BIN points at")
})

test("the definition keeps the schema's danger gate that the session confirms against", () => {
  const { schema } = createSameaHostDefinition(createHost({ XIRANITE_BACKEND_URL: "http://127.0.0.1:1", XIRANITE_BACKEND_TOKEN: HOST_TOKEN }), {}, "zh")
  const live: SameaInput = { action: "classify", paths: ["D:/archives"], dryRun: false }
  // Moving archives is still dangerous after the transport change, with the same prompt the terminal showed
  // before: the confirmation lives in the schema the session reads, not in the runner.
  expect(schema.isDangerous(live)).toBe(true)
  expect(schema.dangerPrompt?.(live)).toMatchObject({ title: "确认实时分类", body: "SameA 将移动就绪的归档文件。", confirmLabel: "确认移动" })
  expect(schema.isDangerous({ ...live, dryRun: true })).toBe(false)
  expect(schema.isDangerous({ action: "plan", paths: ["D:/archives"], dryRun: false })).toBe(false)
})

test("the definition runs on the host and keeps the started operation addressable", async () => {
  const hanging = await startHangingHost()
  hosts.push(hanging)
  const definition = createSameaHostDefinition(createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }), {}, "zh")
  const messages: string[] = []

  const running = definition.run({ action: "plan", paths: ["D:/archives"] }, (event) => messages.push(event.message))
  await hanging.streamOpened
  await definition.cancel?.()
  const result = await running

  expect(messages).toEqual(["Scanning SameA archive roots."])
  expect(result.success).toBe(false)
  expect(result.message).toContain("cancelled")
  // The control call went to the operation this face started, not to some other run.
  expect(hanging.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
})

test("pause and resume use the same operation id", async () => {
  const hanging = await startHangingHost()
  hosts.push(hanging)
  const definition = createSameaHostDefinition(createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }), {}, "zh")

  const running = definition.run({ action: "classify", paths: ["D:/archives"], dryRun: true }, () => undefined)
  await hanging.streamOpened
  await definition.pause?.()
  await definition.resume?.()
  hanging.finish({ success: true, message: "SameA planned 1 archive transfer(s).", data: sameaData() })
  const result = await running

  expect(result.success).toBe(true)
  expect(hanging.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
})

test("no control call happens without a running operation", async () => {
  const hanging = await startHangingHost()
  hosts.push(hanging)
  const definition = createSameaHostDefinition(createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }), {}, "zh")

  await definition.cancel?.()
  await definition.pause?.()
  await definition.resume?.()

  expect(hanging.controlPaths).toEqual([])
})

/**
 * A host whose stream stays open until the test releases it, so the control calls a `ui`/`gd` run makes
 * during an operation can be observed.
 */
interface HangingHost {
  baseUrl: string
  controlPaths: string[]
  streamOpened: Promise<void>
  /** Ends the open stream with this terminal result, which is what releases the waiting run. */
  finish(result: SameaResult, phase?: string): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened!: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  const controlPaths: string[] = []
  let openStream: { response: ServerResponse; finish: (result: SameaResult, phase?: string) => void } | undefined

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
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      if (request.method === "POST" && path.endsWith("/operations")) {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("op-hang", "queued") }))
        return
      }
      if (/^\/node-operations\/op-hang\/(cancel|pause|resume)$/.test(path)) {
        controlPaths.push(path)
        const phase = path.endsWith("/cancel") ? "cancelled" : path.endsWith("/pause") ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("op-hang", phase) }))
        // Cancelling is the terminal case: the stream has to close, or the waiting run never returns.
        if (path.endsWith("/cancel")) openStream?.finish({ success: false, message: "Node operation cancelled." }, "cancelled")
        return
      }
      if (path.endsWith("/stream")) {
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.write(`${JSON.stringify({ type: "operation", operation: record("op-hang", "running", { startedAt: 2 }) })}\n`)
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 15, message: "Scanning SameA archive roots." } })}\n`)
        let finished = false
        openStream = {
          response,
          finish: (result, phase = "completed") => {
            if (finished || response.writableEnded) return
            finished = true
            response.write(`${JSON.stringify({ type: "result", operation: { ...record("op-hang", phase), result }, result })}\n`)
            response.end()
          },
        }
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
    controlPaths,
    streamOpened,
    finish: (result, phase) => openStream?.finish(result, phase),
    close: async () => {
      // Release a stream no test finished, so a pending `awaitOperation` cannot hang the run after it.
      openStream?.finish({ success: true, message: "SameA planned 1 archive transfer(s).", data: sameaData() })
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test and not from the machine
  // running it. No archive path named here is ever opened — the face only serialises it to the host.
  return {
    cwd: process.cwd(),
    env: { ...extraEnv, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: { isTTY: false, columns: 120, write(chunk: string) { stdout += chunk; return true } },
    stderr: { isTTY: false, columns: 120, write(chunk: string) { stderr += chunk; return true } },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}
