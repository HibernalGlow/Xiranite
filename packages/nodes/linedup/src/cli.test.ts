import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import type { CliHost } from "@xiranite/cli-runtime"
import { createLinedupHostDefinition, runProgram } from "./cli.js"
import type { LinedupFilterResult } from "./core.js"
import type { LinedupResult } from "./interaction.js"

const HOST_TOKEN = "attach-token"
const RUN_ROOT = resolve("artifacts/test-runs/linedup-cli")
const cases = new Set<string>()
const hosts: { close(): Promise<void> }[] = []

interface RecordedStart {
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point
 * of these tests is that the face holds no node engine of its own. Nothing here starts or needs a real
 * backend — the listener is created by the test and closed in `afterEach` — and the bodies follow
 * `crates/xiranite-api/src/lib.rs:157-159` plus the `{ success, message, data }` envelope that
 * `pure_envelope` (`crates/quickjs-realm/src/engine.rs`) puts around a pure node's answer.
 */
async function startFakeHost(options: {
  result: LinedupResult
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
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
        starts.push({ input, rawBody: body })
        pending.set(operationId, input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
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

  await new Promise<void>((resolveListen) => { server.listen(0, "127.0.0.1", resolveListen) })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    starts,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolveClose) => { server.close(() => resolveClose()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "linedup", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** What the host's `filterLines` entry answers for `alpha / beta-one / gamma` minus `beta`. */
function filterAnswer(partial: Partial<LinedupFilterResult> = {}): LinedupFilterResult {
  return {
    filteredLines: ["alpha", "gamma"],
    removedLines: ["beta-one"],
    removedCount: 1,
    keptCount: 2,
    ...partial,
  }
}

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const dir of cases) {
    await rm(dir, { recursive: true, force: true })
  }
  cases.clear()
  process.exitCode = 0
})

describe("linedup CLI", () => {
  test("refuses the configured UI outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("linedup ui")
  })

  test("filters inline text as a host operation and prints the host's answer as JSON", async () => {
    const fake = await startFakeHost({ result: { success: true, message: "Filtered lines.", data: filterAnswer() } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["filter", "--source", "alpha\\nbeta-one\\ngamma", "--filter", "beta", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    // The `--json` document is the host's answer, byte for byte what the face printed before:
    // `filterLines`' return value, not the operation envelope.
    expect(JSON.parse(host.stdoutText()) as LinedupFilterResult).toEqual(filterAnswer())

    // One start call, carrying the wire document: the face splits text into lines and leaves
    // normalising, deduping and matching to the host entry.
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).toEqual({
      sourceLines: ["alpha", "beta-one", "gamma"],
      filterLines: ["beta"],
      caseSensitive: true,
      sort: true,
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"sourceLines":["alpha","beta-one","gamma"]`)
  })

  test("reads source/filter files, sends their lines to the host and writes kept lines into an ignored fixture output", async () => {
    // @xiranite-real-run linedup
    const fixture = await createFixture("file-output")
    const fake = await startFakeHost({
      result: {
        success: true,
        message: "Filtered lines.",
        data: filterAnswer({ filteredLines: ["gamma", "alpha"], removedLines: ["beta-one", "beta-two"], removedCount: 2, keptCount: 2 }),
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram([
      "filter",
      "--sourceFile",
      resolve(fixture, "source.txt"),
      "--filterFile",
      resolve(fixture, "filter.txt"),
      "--outputFile",
      resolve(fixture, "kept.txt"),
      "--preserveOrder",
    ], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toEqual({
      sourceLines: ["gamma", "beta-one", "alpha", "beta-two", ""],
      filterLines: ["beta", ""],
      caseSensitive: true,
      sort: false,
    })
    expect(await readFile(resolve(fixture, "kept.txt"), "utf8")).toBe("gamma\nalpha\n")
    expect(host.stdoutText()).toContain("gamma\nalpha")
    expect(host.stdoutText()).toContain("kept=2 removed=2")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ result: { success: true, message: "Filtered lines.", data: filterAnswer() } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["filter", "--source", "alpha\\nbeta-one", "--filter", "beta", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ sourceLines: ["alpha", "beta-one"], filterLines: ["beta"] })
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face now owns the host lifecycle (ADR-0074 §6), so
    // the only way this run can fail is a host binary that is not there. The removed compat path used
    // to run `filterLines` in this process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["filter", "--source", "alpha\\nbeta-one", "--filter", "beta", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("reports a host failure as a non-zero exit instead of a partial success", async () => {
    const fake = await startFakeHost({
      result: { success: false, message: "no node bundle is attached to this host" },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["filter", "--source", "alpha\\nbeta-one", "--filter", "beta", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("no node bundle is attached")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ result: { success: true, message: "Filtered lines.", data: filterAnswer() }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["filter", "--source", "alpha\\nbeta-one", "--filter", "beta", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).not.toBe(0)
  })

  test("guided mode refuses before the first prompt when no host can be reached", async () => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
    // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
    ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram(["gd"], host)

    expect(process.exitCode).toBe(1)
    // Nothing was asked: the guide's intro and its first prompt both come after the host is resolved.
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("forwards host events to the caller that asks for them", async () => {
    const fake = await startFakeHost({
      events: [{ type: "progress", progress: 50, message: "filtering" }],
      result: { success: true, message: "Filtered lines.", data: filterAnswer() },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLinedupHostDefinition(host, {}, "zh")
    const messages: string[] = []

    const result = await definition.run({ sourceText: "alpha\nbeta-one\ngamma", filterText: "beta", caseSensitive: true, sort: true }, (event) => messages.push(event.message))

    expect(result.data).toEqual(filterAnswer())
    // A pure node emits nothing today, so this frame only arrives because the face forwarded the
    // stream instead of discarding it.
    expect(messages).toEqual(["filtering"])
  })
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui`/`gd`
 * definition makes during a run can be observed.
 */
interface HangingHost {
  baseUrl: string
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: LinedupResult): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolveStream) => { resolveOpened = resolveStream })
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

  await new Promise<void>((resolveListen) => { server.listen(0, "127.0.0.1", resolveListen) })
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
      await new Promise<void>((resolveClose) => { server.close(() => resolveClose()) })
    },
  }
}

describe("linedup terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLinedupHostDefinition(face, {}, "zh")

    const running = definition.run({ sourceText: "alpha\nbeta-one", filterText: "beta", caseSensitive: true, sort: true }, () => undefined)
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLinedupHostDefinition(face, {}, "zh")

    const running = definition.run({ sourceText: "alpha", filterText: "beta", caseSensitive: true, sort: true }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Filtered lines.", data: filterAnswer() })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLinedupHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
  })
})

async function createFixture(name: string): Promise<string> {
  const dir = resolve(RUN_ROOT, `${name}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, "source.txt"), "gamma\nbeta-one\nalpha\nbeta-two\n", "utf8")
  await writeFile(resolve(dir, "filter.txt"), "beta\n", "utf8")
  cases.add(dir)
  return dir
}

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the
  // machine running it.
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
