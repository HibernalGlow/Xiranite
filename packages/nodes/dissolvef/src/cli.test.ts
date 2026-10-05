import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { CliHost } from "@xiranite/cli-runtime"
import { createDissolvefHostDefinition, runProgram } from "./cli.js"
import type { DissolvefData, DissolvefResult } from "./core.js"

const HOST_TOKEN = "attach-token"

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
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the
 * point of these tests is that the face holds no node engine of its own. `crates/xiranite-api`
 * is still being wired, so the bodies below follow `crates/xiranite-core/src/operation/dto.rs`
 * and the file's own `data()` mirror of `core.ts`; nothing here proves the host is correct.
 */
async function startFakeHost(options: {
  results: Record<string, DissolvefResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  let sequence = 0
  const pending = new Map<string, { nodeId: string; input: Record<string, unknown> }>()

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      if (headers["x-xiranite-token"] !== expectedToken) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const target = request.url ?? ""
      const path = target.split("?")[0] ?? target
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && path.startsWith("/nodes/") && path.endsWith("/operations")) {
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ input, rawBody: body })
        pending.set(operationId, { nodeId: path.split("/")[2] ?? "dissolvef", input })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const entry = pending.get(stream[1])
        const result = options.results[String(entry?.input?.action ?? "")] ?? { success: false, message: "no scripted result" }
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
  return { operationId, nodeId: "dissolvef", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `data()` defaults, so the face renders a complete document. */
function data(partial: Partial<DissolvefData> = {}): DissolvefData {
  return {
    plan: [],
    history: [],
    archivePaths: [],
    nestedCount: 0,
    mediaCount: 0,
    archiveCount: 0,
    directFiles: 0,
    directDirs: 0,
    skippedCount: 0,
    totalCount: 0,
    successCount: 0,
    failedCount: 0,
    errorCount: 0,
    operationId: "",
    errors: [],
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

describe("dissolvef CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("xdissolvef")
    expect(host.stderrText()).toContain("xdissolvef ui")
  })

  test("runs a nested dissolve as a host operation and prints the result document", async () => {
    const fake = await startFakeHost({
      results: {
        nested: {
          success: true,
          message: "Dissolve completed",
          data: data({ nestedCount: 1, successCount: 2, totalCount: 2, operationId: "undo-1", plan: [planItem({ mode: "nested", operation: "delete_dir", status: "success" })] }),
        },
      },
    })
    hosts.push(fake)
    const runHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram([
      "nested",
      "--path",
      "D:\\Media\\示例\\outer",
      "--historyPath",
      "/tmp/历史/dissolve.json",
      "--similarityThreshold",
      "0",
      "--json",
    ], runHost)

    expect(process.exitCode).toBe(0)
    expect(runHost.stderrText()).toBe("")
    expect(runHost.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(runHost.stdoutText()) as DissolvefResult
    expect(result.success).toBe(true)
    expect(result.data?.nestedCount).toBe(1)
    expect(result.data?.successCount).toBe(2)

    // One start call, carrying the node input verbatim: absolute paths and CJK included.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["nested"])
    expect(fake.starts[0]?.input).toMatchObject({
      path: "D:\\Media\\示例\\outer",
      historyPath: "/tmp/历史/dissolve.json",
      similarityThreshold: 0,
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"path":"D:\\Media\\示例\\outer"`)
  })

  test("undo is a host operation too, with its own action and history path", async () => {
    const fake = await startFakeHost({
      results: {
        undo: { success: true, message: "Undo completed", data: data({ successCount: 2, totalCount: 2 }) },
      },
    })
    hosts.push(fake)
    const undoHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["undo", "--historyPath", "/tmp/历史/dissolve.json", "--json"], undoHost)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(undoHost.stdoutText()) as DissolvefResult
    expect(result.success).toBe(true)
    expect(result.data?.successCount).toBe(2)
    expect(fake.starts[0]?.input).toMatchObject({ action: "undo", historyPath: "/tmp/历史/dissolve.json" })
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated", data: data({ totalCount: 1, plan: [planItem({})] }) } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["plan", "--path", "E:/books", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", path: "E:/books" })
  })

  test("renders host events and the summary panel without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 50, message: "scanning D:/a" },
        { type: "log", message: "dissolving outer/inner" },
      ],
      results: {
        archive: {
          success: true,
          message: "Dissolve completed",
          data: data({ archiveCount: 1, successCount: 1, totalCount: 1, archivePaths: ["D:/a/comic.cbz"], plan: [planItem({ mode: "archive" })] }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["archive", "--path", "D:/a", "--similarityThreshold", "0"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Dissolve completed")
    expect(stdout).toContain("解散操作总结")
    expect(stdout).toContain("dissolving outer/inner")
    expect(stdout).toContain("D:/a/comic.cbz")
  })

  test("stops with the attach hint and exit code 1 when no host answers", async () => {
    // No flags, no environment, no channel file: the removed compat path used to run the node
    // in-process here, which is exactly what must not happen any more.
    const host = createHost()

    await runProgram(["nested", "--path", "D:\\Media\\outer", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("reports a host failure as a non-zero exit instead of a partial success", async () => {
    const fake = await startFakeHost({
      results: { nested: { success: false, message: "no plugin runtime is attached to this host", data: data({ failedCount: 1, errors: ["no runtime"] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["nested", "--path", "D:/a", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as DissolvefResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("no plugin runtime")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "--path", "D:/a", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).not.toBe(0)
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
  finish(result: { success: boolean; message: string; data?: unknown }): void
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
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const target = request.url ?? ""
      const path = target.split("?")[0] ?? target

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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "scanning D:/a" } })}\n`)
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

describe("dissolvef terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createDissolvefHostDefinition(face, undefined, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "nested", path: "D:/a" }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(messages).toEqual(["scanning D:/a"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createDissolvefHostDefinition(face, undefined, "zh")

    const running = definition.run({ action: "nested", path: "D:/a" }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Dissolve completed", data: data({}) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual([
      "/node-operations/op-hang/pause",
      "/node-operations/op-hang/resume",
    ])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createDissolvefHostDefinition(face, undefined, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
  })
})

function planItem(partial: Partial<DissolvefData["plan"][number]> = {}): DissolvefData["plan"][number] {
  return {
    mode: "nested",
    operation: "move",
    sourcePath: "D:/a/outer/inner",
    targetPath: "D:/a/outer",
    itemKind: "directory",
    status: "planned",
    ...partial,
  } as DissolvefData["plan"][number]
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
