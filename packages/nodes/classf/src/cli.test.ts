import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { CliHost } from "@xiranite/cli-runtime"
import { createClassfHostDefinition, runProgram } from "./cli.js"
import type { ClassfData, ClassfPlanItem, ClassfResult } from "./core.js"

const HOST_TOKEN = "attach-token"
/** `classf-missing.toml` is never written: the tests pin config resolution away from this machine. */
const MISSING_CONFIG = join(tmpdir(), "xiranite-classf-cli-missing.toml")

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
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own — `classf` is wave B in
 * `docs/migration/face-execution-ledger.md`, so the compiled host cannot run it yet and a fake is the only
 * way to assert the wire. Bodies follow `crates/xiranite-core/src/operation/dto.rs`; nothing here proves
 * the host is correct, and `core.test.ts` stays the place where classf's own logic is proven.
 */
async function startFakeHost(options: {
  results: Record<string, ClassfResult>
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
  return { operationId, nodeId: "classf", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** The fields the face reads off a result document, so a scripted run is a complete one. */
function data(partial: Partial<ClassfData> = {}): ClassfData {
  return {
    action: "plan",
    transferMode: "move",
    classifyMode: "auto",
    placementMode: "local",
    items: [],
    selectedCount: 0,
    readyCount: 0,
    movedCount: 0,
    copiedCount: 0,
    delCount: 0,
    waitCount: 0,
    conflictCount: 0,
    errorCount: 0,
    errors: [],
    ...partial,
  }
}

function planItem(partial: Partial<ClassfPlanItem> = {}): ClassfPlanItem {
  return {
    sourcePath: "E:/books/[OgoG] 作品/001.zip",
    targetPath: "E:/books/already/001.zip",
    sourceName: "001.zip",
    targetRelative: "already/001.zip",
    kind: "file",
    stage: "already",
    status: "ready",
    ...partial,
  }
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

describe("classf CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("classf ui")
  })

  test("runs a plan as a host operation and prints the result document", async () => {
    const fake = await attach({
      plan: { success: true, message: "分类计划已生成", data: data({ selectedCount: 1, readyCount: 1, items: [planItem()] }) },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "E:/书籍/示例", "--target", "E:/分流", "--blacklist-keyword", "[ぶたコマ300g], [すいせいむし]", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as ClassfResult
    expect(result.success).toBe(true)
    expect(result.data?.items[0]?.targetRelative).toBe("already/001.zip")

    // One start call on this node's own route, carrying the node input verbatim: CJK paths included.
    expect(fake.starts.map((start) => [start.route, start.input.action])).toEqual([["/nodes/classf/operations", "plan"]])
    expect(fake.starts[0]?.input).toMatchObject({
      paths: ["E:/书籍/示例"],
      targetDir: "E:/分流",
      blacklistKeywords: ["[ぶたコマ300g]", "[すいせいむし]"],
      dryRun: true,
    })
  })

  test("classify is the same operation with a different action and dryRun off", async () => {
    const fake = await attach({
      classify: { success: true, message: "分类传输完成", data: data({ action: "classify", movedCount: 1, readyCount: 1, items: [planItem({ status: "moved" })] }) },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["classify", "E:/a", "--transfer", "move", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "classify", dryRun: false, transferMode: "move" })
    expect(JSON.parse(host.stdoutText()) as ClassfResult).toMatchObject({ success: true })
  })

  test("omits the blacklist when the operator configured none, so the host keeps its own default", async () => {
    const fake = await attach({ plan: { success: true, message: "计划", data: data() } })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "E:/a", "--json"], host)

    // Not `[]`: an empty list means "no blacklist" to `core.ts`, while omission means "use the node's".
    expect(fake.starts[0]?.input).not.toHaveProperty("blacklistKeywords")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "计划", data: data() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["plan", "E:/a", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", paths: ["E:/a"] })
  })

  test("renders host events and plan lines without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 50, message: "scanning E:/books" },
        { type: "log", message: "samea stage done" },
      ],
      results: { plan: { success: true, message: "分类计划已生成", data: data({ selectedCount: 1, items: [planItem()] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "E:/books"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("分类计划已生成")
    expect(stdout).toContain("samea stage done")
    expect(stdout).toContain("ready\talready\t001.zip")
    expect(stdout).toContain("already/001.zip")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there. The removed compat path used to run
    // `runClassf` in-process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["plan", "E:/a", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("guided mode refuses before the first prompt when no host can be reached", async () => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
    // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
    ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram(["gd"], host)

    expect(process.exitCode).toBe(1)
    // Nothing was asked: the guide's prompts only come after the host is resolved.
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("reports a host failure as a non-zero exit instead of a partial success", async () => {
    const fake = await attach({
      plan: { success: false, message: "no node bundle is registered for this host", data: data({ errorCount: 1, errors: ["no bundle"] }) },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "E:/a", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as ClassfResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("no node bundle")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "计划" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "E:/a", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).not.toBe(0)
  })
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui`/`gd` definition
 * makes during a run can be observed.
 */
interface HangingHost {
  baseUrl: string
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: ClassfResult): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  const controlPaths: string[] = []
  let streamResponse: ServerResponse | undefined

  const server = createServer((request, response) => {
    // The body must be drained before `end` fires, or a GET without one never reaches this handler at all
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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "scanning E:/a" } })}\n`)
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

describe("classf terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createClassfHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "plan", paths: ["E:/a"] }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(messages).toEqual(["scanning E:/a"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createClassfHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "plan", paths: ["E:/a"] }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "分类计划已生成", data: data() })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createClassfHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
  })
})

/** A scripted host plus the face env that attaches to it. */
async function attach(
  results: Record<string, ClassfResult>,
  events?: { type: "progress" | "log"; progress?: number; message: string }[],
): Promise<FakeHost> {
  const fake = await startFakeHost({ results, events })
  hosts.push(fake)
  return fake
}

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine
  // running it, and the node config must not leak in either.
  return {
    cwd: process.cwd(),
    env: { ...extraEnv, XIRANITE_CONFIG_PATH: MISSING_CONFIG, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
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
