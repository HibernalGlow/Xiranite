import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createFindzHostRunner, runProgram } from "./cli.js"
import { FINDZ_GUI_ONLY_HELP } from "./help.js"
import type { FindzData, FindzResult } from "./core.js"

const HOST_TOKEN = "attach-token"

interface RecordedStart {
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
  /** The `/nodes/{id}/operations` route the face asked, so a wrong node id cannot pass silently. */
  route: string
}

interface FakeHost {
  baseUrl: string
  /** Every start this host was asked for, in order. */
  starts: RecordedStart[]
  close(): Promise<void>
}

interface FakeHostOptions {
  results: Record<string, FindzResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** When set, the node route answers this status instead of starting anything — the wave B shape. */
  startStatus?: number
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. Findz is wave B in
 * `docs/migration/face-execution-ledger.md` — its bundle is not in the Rust registry and nothing answers
 * its `findz` service arm yet — so nothing here proves the host is correct. The bodies follow
 * `crates/xiranite-core/src/operation/dto.rs` and mirror the `FindzData` shape `core.ts` returns.
 */
async function startFakeHost(options: FakeHostOptions): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  let sequence = 0
  const pending = new Map<string, Record<string, unknown>>()

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route the host serves without the bearer token, and a face that could not
      // probe it would look dead even when the node route is fine.
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
        if (options.startStatus) {
          response.writeHead(options.startStatus, { "content-type": "application/json" })
          response.end(JSON.stringify({ error: "Node not found." }))
          return
        }
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ input, rawBody: body, route: path })
        pending.set(operationId, input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const input = pending.get(stream[1]) ?? {}
        const result = options.results[String(input.action ?? "")] ?? { success: false, message: "no scripted result" }
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
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "findz", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
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

describe("findz CLI", () => {
  test("keeps the documented GUI-only answer and needs no host for it", async () => {
    // Nothing is configured and no host binary exists: the pointer is the one answer this face may give
    // without a host, because it reports where the work happens rather than doing any.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram([], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText()).toBe(`${FINDZ_GUI_ONLY_HELP}\n`)
    expect(host.stderrText()).toBe("")
  })

  test("flags it does not define still answer the documented pointer, never a node run", async () => {
    const fake = await attach(hosts, {})
    const host = hostWith(fake)

    await runProgram(["--help"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText()).toBe(`${FINDZ_GUI_ONLY_HELP}\n`)
    expect(fake.starts.length).toBe(0)
  })

  test("sends a library query to the host and prints its result document", async () => {
    const fake = await attach(hosts, {
      query_archives: {
        success: true,
        message: "Finished: archive query.",
        data: { action: "query_archives", archives: { items: [{ id: 1, path: "卷01.zip" }], total: 1 } } as unknown as FindzData,
      },
    })
    const host = hostWith(fake)

    await runProgram(["query_archives", "/图书馆/漫画", "cover"], host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as FindzResult
    expect(result.success).toBe(true)
    expect(fake.starts.map((start) => start.input.action)).toEqual(["query_archives"])
    expect(fake.starts[0]?.route).toEqual("/nodes/findz/operations")
    expect(fake.starts[0]?.input).toMatchObject({
      action: "query_archives",
      library: { root: "/图书馆/漫画" },
      text: "cover",
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"root":"/图书馆/漫画"`)
  })

  test("api_info asks the host and carries no library at all", async () => {
    const fake = await attach(hosts, {
      api_info: { success: true, message: "Finished: native capability check.", data: { action: "api_info", apiInfo: { coreVersion: "2.0.0" } } as unknown as FindzData },
    })
    const host = hostWith(fake)

    await runProgram(["api_info"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toEqual({ action: "api_info" })
  })

  test("the node's own task controls travel as actions, not as face-level shortcuts", async () => {
    const fake = await attach(hosts, {
      pause: { success: true, message: "Finished: task pause.", data: { action: "pause", task: { id: "task-9", status: "paused" } } as unknown as FindzData },
    })
    const host = hostWith(fake)

    await runProgram(["pause", "/library", "task-9"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "pause", library: { root: "/library" }, taskId: "task-9" })
  })

  test("archive ids travel as the number the node declares", async () => {
    const fake = await attach(hosts, {
      query_members: { success: true, message: "Finished: member query.", data: { action: "query_members", members: { items: [], total: 0 } } as unknown as FindzData },
    })
    const host = hostWith(fake)

    await runProgram(["query_members", "/library", "42"], host)

    expect(fake.starts[0]?.input).toMatchObject({ action: "query_members", archiveId: 42 })
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await attach(hosts, { scan: { success: true, message: "Finished: ZIP scan.", data: { action: "scan" } as unknown as FindzData } })
    const host = createHost()

    await runProgram(["scan", "/library", "--backend", fake.baseUrl, "--token", HOST_TOKEN], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "scan", library: { root: "/library" } })
  })

  test("progress reaches stderr so stdout stays one clean document", async () => {
    const fake = await startFakeHost({
      events: [{ type: "progress", progress: 40, message: "Findz scan: 40 of 100." }],
      results: { scan: { success: true, message: "Finished: ZIP scan.", data: { action: "scan", task: { id: "t", status: "completed" } } as unknown as FindzData } },
    })
    hosts.push(fake)
    const host = hostWith(fake)

    await runProgram(["scan", "/library"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toContain("Findz scan: 40 of 100.")
    expect(() => JSON.parse(host.stdoutText())).not.toThrow()
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["scan", "/library"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("a host that does not answer this node is one error line, not a local run", async () => {
    // The wave B shape: the host is alive, the route is not. Findz's core cannot fill the gap — it refuses
    // without the injected gateway — so the face must stop here instead of pretending to know the library.
    const fake = await startFakeHost({ results: {}, startStatus: 404 })
    hosts.push(fake)
    const host = hostWith(fake)

    await runProgram(["query_archives", "/library", "cover"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("404")
    expect(fake.starts.length).toBe(0)
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: {}, token: "other-token" })
    hosts.push(fake)
    const host = hostWith(fake)

    await runProgram(["api_info"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
  })

  test("refuses to watch a library, because that is the host's grant and it is still undecided", async () => {
    const fake = await attach(hosts, {})
    const host = hostWith(fake)

    await runProgram(["watch", "/library"], host)

    expect(process.exitCode).toBe(2)
    // No request left the face, and no watcher either: the refusal is the whole behaviour.
    expect(fake.starts.length).toBe(0)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("Unknown Findz action: watch")
    expect(host.stderrText()).toContain("Watching a library is the host's job")
  })

  test("an unknown action is a usage error and names the published vocabulary", async () => {
    const fake = await attach(hosts, {})
    const host = hostWith(fake)

    await runProgram(["frobnicate", "/library"], host)

    expect(process.exitCode).toBe(2)
    expect(fake.starts.length).toBe(0)
    expect(host.stderrText()).toContain("query_archives")
    expect(host.stderrText()).toContain("treemap")
  })

  test("reports a run that did not work as a result document with exit code 1", async () => {
    const fake = await attach(hosts, {
      open_library: { success: false, message: "Findz needs the host runtime: no gateway was injected (service.invoke)", data: { action: "open_library" } as unknown as FindzData },
    })
    const host = hostWith(fake)

    await runProgram(["open_library", "/library"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as FindzResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("no gateway was injected")
  })
})

/**
 * A host whose stream stays open until the test closes it, so the cancel the durable scan registers for
 * Ctrl-C can be observed on the operation this face started.
 */
interface HangingHost {
  baseUrl: string
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: FindzResult): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  const controlPaths: string[] = []
  let streamResponse: ServerResponse | undefined

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
      if (/^\/node-operations\/op-hang\/cancel$/.test(path)) {
        controlPaths.push(path)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("op-hang", "cancelled") }))
        return
      }
      if (path.endsWith("/stream")) {
        streamResponse = response
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.write(`${JSON.stringify({ type: "operation", operation: record("op-hang", "running", { startedAt: 2 }) })}\n`)
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "Findz scan: 20 of 100." } })}\n`)
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

describe("findz host runner", () => {
  test("a durable scan keeps its started operation addressable until it settles", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const runner = createFindzHostRunner(face)

    const running = runner.run({ action: "scan", library: { root: "/library" } })
    await fake.streamOpened
    await runner.cancel()
    fake.finish({ success: false, message: "Node operation cancelled.", data: { action: "scan" } as unknown as FindzData })
    const result = await running

    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("cancel before a run started addresses nothing", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const runner = createFindzHostRunner(face)

    await runner.cancel()

    expect(fake.controlPaths).toEqual([])
  })
})

/** Registers a fake host with the suite teardown and returns it. */
async function attach(registry: { close(): Promise<void> }[], results: Record<string, FindzResult>): Promise<FakeHost> {
  const fake = await startFakeHost({ results })
  registry.push(fake)
  return fake
}

function hostWith(fake: { baseUrl: string }): CliHost & { stdoutText: () => string; stderrText: () => string } {
  return createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
}

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine.
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
