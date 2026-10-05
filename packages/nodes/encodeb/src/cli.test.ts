import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createEncodebHostDefinition, runProgram } from "./cli.js"
import type { EncodebData, EncodebInput, EncodebResult } from "./core.js"

const HOST_TOKEN = "attach-token"

interface RecordedStart {
  /** The node id the face posted to, decoded from the route. */
  nodeId: string
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
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of these
 * tests is that this face holds no node engine of its own — nothing here scans a directory tree and nothing
 * here renames a file. The bodies mirror the operation DTOs `crates/xiranite-api` answers with, so they prove
 * the face's side of the wire and make no claim about the host.
 */
async function startFakeHost(options: {
  results: Record<string, EncodebResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const pending = new Map<string, Record<string, unknown>>()
  const expectedToken = options.token ?? HOST_TOKEN
  let sequence = 0

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route the host serves without the bearer token, and the face probes it before it
      // asks the operator anything, so a fake that did not answer it would look dead.
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
        starts.push({ nodeId: decodeURIComponent(start[1]), input, rawBody: body })
        pending.set(operationId, input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued", { nodeId: decodeURIComponent(start[1]) }) }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const result = options.results[String(pending.get(stream[1])?.action ?? "")] ?? { success: false, message: "no scripted result" }
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
  return { operationId, nodeId: "encodeb", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `emptyData()` defaults, so the face renders a complete document. */
function encodebData(partial: Partial<EncodebData> = {}): EncodebData {
  return { mappings: [], matches: [], processed: 0, ...partial }
}

const hosts: { close(): Promise<void> }[] = []
const sandboxDirs: string[] = []

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  await Promise.all(sandboxDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  process.exitCode = 0
})

describe("encodeb CLI", () => {
  test("refuses interactive mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("encodeb")
    expect(host.stderrText()).toContain("--help")
  })

  test("finds as a host operation and prints the result document", async () => {
    const fake = await startFakeHost({
      results: { find: { success: true, message: "Find completed, 1 item(s).", data: encodebData({ matches: ["D:\\archive\\示例\\╘bad.txt"] }) } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["find", "--paths", "D:\\archive\\示例;D:/archive/其他", "--preset", "jp", "--limit", "5", "--json"], face)

    expect(process.exitCode).toBe(0)
    expect(face.stderrText()).toBe("")
    expect(face.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(face.stdoutText()) as EncodebResult
    expect(result.success).toBe(true)
    expect(result.data?.matches).toEqual(["D:\\archive\\示例\\╘bad.txt"])

    // One start call on this node's own route, carrying the node input verbatim: the `;` split, the preset's
    // own encoding pair, and CJK/box-drawing names untouched.
    expect(fake.starts.map((start) => start.nodeId)).toEqual(["encodeb"])
    expect(fake.starts.map((start) => start.input.action)).toEqual(["find"])
    expect(fake.starts[0]?.input).toEqual({
      action: "find",
      paths: ["D:\\archive\\示例", "D:/archive/其他"],
      srcEncoding: "cp437",
      dstEncoding: "cp932",
      transform: "recode",
      strategy: "replace",
      limit: 5,
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"D:\\archive\\示例"`)
  })

  test("custom preset keeps the encodings the operator named", async () => {
    const fake = await startFakeHost({ results: { preview: { success: true, message: "Preview completed, 0 item(s).", data: encodebData() } } })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["preview", "--paths", "D:/archive", "--preset", "custom", "--srcEncoding", "big5", "--dstEncoding", "utf8", "--transform", "decode-hash-u", "--strategy", "copy", "--json"], face)

    expect(fake.starts[0]?.input).toMatchObject({
      action: "preview",
      srcEncoding: "big5",
      dstEncoding: "utf8",
      transform: "decode-hash-u",
      strategy: "copy",
    })
  })

  test("renders host mappings and events without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 40, message: "Scanning D:/archive" },
        { type: "log", message: "scanned 2 entries" },
      ],
      results: { preview: { success: true, message: "Preview completed, 1 item(s).", data: encodebData({ mappings: [{ src: "D:/archive/╘bad.txt", dst: "D:/archive/坏名.txt", type: "file", depth: 1 }] }) } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["preview", "--paths", "D:/archive"], face)

    expect(process.exitCode).toBe(0)
    const stdout = face.stdoutText()
    expect(stdout).toContain("Preview completed, 1 item(s).")
    expect(stdout).toContain("scanned 2 entries")
    expect(stdout).toContain("D:/archive/╘bad.txt")
    expect(stdout).toContain("D:/archive/坏名.txt")
  })

  test("recover names the write action, while the schema keeps the gate the session asks first", async () => {
    const fake = await startFakeHost({
      results: { recover: { success: true, message: "Recovery completed, processed 1 path(s).", data: encodebData({ processed: 1 }) } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["recover", "--paths", "D:/archive", "--strategy", "copy", "--json"], face)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toEqual(expect.objectContaining({ action: "recover", strategy: "copy" }))

    // The gate itself is unchanged by the transport: only `recover` is dangerous, and the terminal session
    // consults `isDangerous`/`dangerPrompt` before it ever calls `definition.run` (`runGuidedInteraction`).
    const { schema } = createEncodebHostDefinition(face, {}, "zh")
    const live: EncodebInput = { action: "recover", paths: ["D:/archive"], strategy: "replace" }
    expect(schema.isDangerous(live)).toBe(true)
    expect(schema.isDangerous({ ...live, action: "preview" })).toBe(false)
    expect(schema.isDangerous({ ...live, action: "find" })).toBe(false)
    expect(schema.dangerPrompt?.(live)).toMatchObject({ title: "确认文件名修复", body: "将按当前编码和策略改动真实文件路径。", confirmLabel: "确认修复" })
    // The preset field's vocabulary still resolves through the node's own contract, not a face-side copy.
    expect(schema.toInput({ ...schema.initialValues, preset: "kr", paths: "D:/archive" })).toMatchObject({ srcEncoding: "cp437", dstEncoding: "cp949" })
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { find: { success: true, message: "Find completed, 0 item(s).", data: encodebData() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const face = createHost()

    await runProgram(["find", "--paths", "D:/archive", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], face)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    const input = fake.starts[0]?.input ?? {}
    expect(input).not.toHaveProperty("backend")
    expect(input).not.toHaveProperty("token")
    // The attach url is not mistaken for a scanned path either.
    expect(input).toMatchObject({ action: "find", paths: ["D:/archive"] })
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path ran `core.ts` in this
    // process here, which is exactly what must not happen any more.
    const face = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["find", "--paths", "D:/archive", "--json"], face)

    expect(process.exitCode).toBe(1)
    expect(face.stdoutText()).toBe("")
    expect(face.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(face.stderrText()).toContain("--backend <url> --token <token>")
    expect(face.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(face.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("a live recover without a host leaves the sandbox on disk exactly as it was", async () => {
    // The write path is the one that must not fall back: this face has no engine, so an unreachable host has
    // to mean "nothing renamed", not a local run of `core.ts`. Only this test's own sandbox is touched.
    const sandbox = await mkdtemp(join(tmpdir(), "xiranite-encodeb-face-"))
    sandboxDirs.push(sandbox)
    const garbled = "╘bad.txt"
    await writeFile(join(sandbox, garbled), "garbled", "utf8")
    const face = createHost({ XIRANITE_HOST_BIN: join(sandbox, "no-host-binary-here") })

    await runProgram(["recover", "--paths", sandbox, "--json"], face)

    expect(process.exitCode).toBe(1)
    expect(face.stdoutText()).toBe("")
    expect(await readdir(sandbox)).toEqual([garbled])
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { find: { success: true, message: "Find completed, 0 item(s).", data: encodebData() } }, token: "other-token" })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["find", "--paths", "D:/archive", "--json"], face)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(face.stdoutText()).toBe("")
  })

  test("a host that reports failure answers with its own document", async () => {
    const fake = await startFakeHost({
      results: { find: { success: false, message: "No valid paths provided.", data: encodebData() } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["find", "--paths", "D:/archive", "--json"], face)

    expect((JSON.parse(face.stdoutText()) as EncodebResult).success).toBe(false)
    expect(face.stdoutText()).toContain("No valid paths provided.")
  })

  test("gd refuses before the first prompt when no host can be reached", async () => {
    const face = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
    // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
    ;(face.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(face.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram(["gd"], face)

    expect(process.exitCode).toBe(1)
    // Nothing was asked: the guide's intro and its first prompt both come after the host is resolved.
    expect(face.stdoutText()).toBe("")
    expect(face.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui`/`gd` definition makes
 * during a run can be observed.
 */
interface HangingHost {
  baseUrl: string
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: EncodebResult): void
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
      // Token-free on the real host, and the face probes it before it starts an operation.
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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "Scanning D:/archive" } })}\n`)
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

describe("encodeb terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const hanging = await startHangingHost()
    hosts.push(hanging)
    const face = createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createEncodebHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "preview", paths: ["D:/archive"] }, (event) => messages.push(event.message))
    await hanging.streamOpened
    await definition.cancel?.()
    hanging.finish({ success: false, message: "Node operation cancelled.", data: encodebData() })
    const result = await running

    expect(messages).toEqual(["Scanning D:/archive"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(hanging.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const hanging = await startHangingHost()
    hosts.push(hanging)
    const face = createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createEncodebHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "recover", paths: ["D:/archive"], strategy: "replace" }, () => undefined)
    await hanging.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    hanging.finish({ success: true, message: "Recovery completed, processed 1 path(s).", data: encodebData({ processed: 1 }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(hanging.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const hanging = await startHangingHost()
    hosts.push(hanging)
    const face = createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createEncodebHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(hanging.controlPaths).toEqual([])
  })

  test("config defaults still reach the schema the terminal renders", () => {
    const face = createHost({ XIRANITE_BACKEND_URL: "http://127.0.0.1:1", XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const { schema } = createEncodebHostDefinition(face, { preset: "latin1_utf8", strategy: "copy", limit: 42 }, "zh")
    expect(schema.initialValues).toMatchObject({ preset: "latin1_utf8", strategy: "copy", limit: 42 })
    // The preset field, not the two encoding boxes, carries the pair: the shared contract resolves it.
    expect(schema.toInput({ ...schema.initialValues, paths: "D:/archive" })).toMatchObject({
      srcEncoding: "windows-1252",
      dstEncoding: "utf8",
      transform: "recode",
      strategy: "copy",
    })
  })
})

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine running
  // it. The data dir points at an empty sandbox so `[nodes.encodeb]` defaults cannot make the input document
  // vary between machines either.
  return {
    cwd: process.cwd(),
    env: { XIRANITE_DATA_DIR: join(tmpdir(), "xiranite-encodeb-face-empty"), ...extraEnv, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
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
