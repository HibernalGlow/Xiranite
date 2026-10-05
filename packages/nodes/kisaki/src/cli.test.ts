import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createKisakiHostDefinition, formatKisakiPipeResult, runProgram } from "./cli.js"
import type { KisakiData, KisakiResult } from "./core.js"

// @xiranite-real-run kisaki — scripts/smoke-cli.mjs executes duplicate, basic, and media scans through the built pipe CLI, which now attaches to (or starts) a host and runs the node's one core bundle there instead of in its own process.

const HOST_TOKEN = "attach-token"

interface RecordedStart {
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  /** Control calls observed on the operation this face started, in order. */
  controlPaths: string[]
  /** Only a `hold` host has one: the stream stays open until the test ends it. */
  streamOpened: Promise<void>
  finish(result: KisakiResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. `crates/xiranite-api` is still being wired,
 * so the bodies below follow the `{ operation }` / NDJSON envelope documented in
 * `crates/xiranite-api/src/lib.rs:143-159`; nothing here proves the host is correct.
 */
async function startFakeHost(options: {
  /** Result document per `input.action`, so one server can answer a scan and a delete differently. */
  results: Record<string, KisakiResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** Keeps `/stream` open: what the cancel/pause/resume tests need a run to still be inside. */
  hold?: boolean
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const controlPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  let sequence = 0
  const pending = new Map<string, { action?: string; operationId: string }>()
  let resolveOpened: () => void = () => {}
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  let streamResponse: ServerResponse | undefined

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route `crates/xiranite-api` serves without the bearer token, and the face
      // probes it before it asks the operator anything, so a fake that did not answer it would look dead.
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ ok: true }))
        return
      }
      if (headers["x-xiranite-token"] !== expectedToken) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && path.startsWith("/nodes/") && path.endsWith("/operations")) {
        const operationId = options.hold ? "op-hang" : `op-${(sequence += 1)}`
        const input = (JSON.parse(body || "{}") as { input?: Record<string, unknown> }).input ?? {}
        starts.push({ input, rawBody: body })
        pending.set(operationId, { action: String(input.action ?? "scan"), operationId })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      if (/^\/node-operations\/([^/]+)\/(cancel|pause|resume)$/.test(path)) {
        controlPaths.push(path)
        const phase = path.endsWith("/cancel") ? "cancelled" : path.endsWith("/pause") ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(path.split("/")[2] ?? "", phase) }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      const operationId = stream?.[1] ?? ""
      if (operationId) {
        const result = options.results[pending.get(operationId)?.action ?? ""] ?? { success: false, message: "no scripted result" }
        if (options.hold) {
          streamResponse = response
          response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
          response.write(`${JSON.stringify({ type: "operation", operation: record(operationId, "running", { startedAt: 2 }) })}\n`)
          response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "scanning D:/a" } })}\n`)
          resolveOpened()
          return
        }
        const frames = [
          { type: "operation", operation: record(operationId, "running", { startedAt: 2 }) },
          ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
          { type: "result", operation: record(operationId, "completed", { finishedAt: 4, result }), result },
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

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "kisaki", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s scan document, defaulted, so the face renders a complete result. */
function data(partial: Partial<KisakiData> = {}): KisakiData {
  return {
    action: "scan",
    tool: "duplicate-files",
    groups: [],
    entries: [],
    messages: "",
    stopped: false,
    groupCount: 0,
    fileCount: 0,
    totalBytes: 0,
    reclaimableBytes: 0,
    affectedCount: 0,
    errorCount: 0,
    ...partial,
  }
}

function scanResult(partial: Partial<KisakiData> = {}): KisakiResult {
  return { success: true, message: "Scan completed", data: data(partial) }
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

describe("kisaki CLI", () => {
  test("prints usage without loading the native binding", async () => {
    let output = ""
    const sink = { write: (chunk: unknown) => { output += String(chunk); return true } }
    const host = { cwd: process.cwd(), env: {}, stdin: { isTTY: true }, stdout: sink, stderr: sink } as unknown as CliHost
    await runProgram([], host)
    expect(output).toContain("kisaki")
    expect(output).toContain("--help")
  })

  test("rejects an invalid operation tool instead of dropping safety semantics", async () => {
    const host = createHost()
    await expect(runProgram(["delete", "D:/empty", "--tool", "empty-folder", "--json"], host)).rejects.toThrow("Unsupported Kisaki tool")
    // Refused before any host work: the vocabulary check is the face's own argument parsing.
    expect(host.stderrText()).toBe("")
  })

  test("rejects GUI-only scanners instead of silently falling back to duplicate files", async () => {
    const host = createHost()
    await expect(runProgram(["scan", "exif-remover", "D:/photos", "--json"], host)).rejects.toThrow("Unsupported Kisaki tool: exif-remover")
  })

  test("formats pipe scan results in the requested language", () => {
    const result: KisakiResult = {
      success: true,
      message: "raw core message",
      data: data({ tool: "similar-images", similarFolders: [] }),
    }
    expect(formatKisakiPipeResult(result, "zh")).toEqual(["找到 0 项，共 0 组。", "格式: 无", "相似文件夹: 无"])
    expect(formatKisakiPipeResult(result, "en")).toEqual(["Found 0 item(s) in 0 group(s).", "Formats: none", "Similar folders: none"])
  })

  test("runs a scan as a host operation and prints the host's result document", async () => {
    const fake = await startFakeHost({
      results: {
        scan: scanResult({
          groupCount: 1,
          fileCount: 2,
          totalBytes: 24,
          reclaimableBytes: 12,
          groups: [{ id: 0, entries: [entry("D:/media 示例/a.txt"), entry("D:/media 示例/b.txt")], totalBytes: 24, reclaimableBytes: 12 }],
          entries: [entry("D:/media 示例/a.txt"), entry("D:/media 示例/b.txt")],
        }),
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "duplicate-files", "D:/media 示例", "--no-cache", "--threads", "2", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as KisakiResult
    expect(result.success).toBe(true)
    expect(result.data?.fileCount).toBe(2)

    // One start call, carrying the node input verbatim: absolute paths, CJK and the CLI's flag semantics.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["scan"])
    expect(fake.starts[0]?.input).toMatchObject({
      tool: "duplicate-files",
      includedDirectories: ["D:/media 示例"],
      useCache: false,
      threadCount: 2,
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"D:/media 示例"`)
    // The attach flags are the face's, never the node's: they left argv before the parser ran.
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
  })

  test("a delete travels as a host operation, and --live is the only thing that drops the preview", async () => {
    const fake = await startFakeHost({
      results: { delete: { success: true, message: "Delete completed", data: data({ action: "delete", tool: "empty-folders", affectedCount: 1, errorCount: 0 }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["delete", "D:/empty", "--tool", "empty-folders", "--live", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "delete", tool: "empty-folders", selectedPaths: ["D:/empty"], deleteMode: "trash", dryRun: false })
  })

  test("without --live the same delete stays a preview", async () => {
    const fake = await startFakeHost({
      results: { delete: { success: true, message: "Delete planned", data: data({ action: "delete", affectedCount: 1 }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["delete", "D:/empty", "--tool", "empty-folders", "--json"], host)

    expect(fake.starts[0]?.input).toMatchObject({ action: "delete", deleteMode: "trash", dryRun: true })
    // The document the host returned is what the face prints; the face never re-ran the operation locally.
    expect((JSON.parse(host.stdoutText()) as KisakiResult).message).toBe("Delete planned")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { scan: scanResult({ groupCount: 1, fileCount: 2, entries: [entry("E:/books/a.txt")] }) } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["scan", "big-files", "E:/books", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).toMatchObject({ action: "scan", tool: "big-files", includedDirectories: ["E:/books"] })
  })

  test("renders host events and the scan summary without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 50, message: "hashing D:/a" },
        { type: "log", message: "grouping candidates" },
      ],
      results: { scan: scanResult({ groupCount: 1, fileCount: 3, groups: [{ id: 0, entries: [entry("D:/a.bin"), entry("D:/b.bin"), entry("D:/c.bin")], totalBytes: 3, reclaimableBytes: 2 }], entries: [entry("D:/a.bin"), entry("D:/b.bin"), entry("D:/c.bin")] }) },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "duplicate-files", "D:/a", "--lang", "en"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("hashing D:/a")
    expect(stdout).toContain("grouping candidates")
    expect(stdout).toContain("Found 3 item(s) in 1 group(s).")
    expect(stdout).toContain("D:/b.bin")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face now owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there. The removed compat path ran the node
    // in-process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["scan", "duplicate-files", "D:/media", "--json"], host)

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
      results: { scan: { success: false, message: "no plugin runtime is attached to this host, so kisaki cannot run yet", data: data({ stopped: false }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "duplicate-files", "D:/media", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as KisakiResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("no plugin runtime")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { scan: scanResult() }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "duplicate-files", "D:/media", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
  })

  test("an unknown command still answers with exit code 2 before any host work", async () => {
    const fake = await startFakeHost({ results: { scan: scanResult() } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["frobnicate", "D:/media"], host)

    expect(process.exitCode).toBe(2)
    expect(host.stdoutText()).toContain("Unknown command: frobnicate")
    expect(fake.starts.length).toBe(0)
  })

  test.each([["gd"], ["ui"]])("%s refuses before the workbench is drawn when no host can be reached", async (command) => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
    // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
    ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram([command], host)

    expect(process.exitCode).toBe(1)
    // Nothing was asked and no frame was drawn: the host is resolved before the first prompt or renderer.
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })
})

describe("kisaki terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startFakeHost({ results: {}, hold: true })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createKisakiHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "scan", tool: "duplicate-files", includedDirectories: ["D:/a"] }, (event) => messages.push(event.message))
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
    const fake = await startFakeHost({ results: {}, hold: true })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createKisakiHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "scan", tool: "duplicate-files", includedDirectories: ["D:/a"] }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Scan completed", data: data({}) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startFakeHost({ results: {}, hold: true })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createKisakiHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  test("publishes the node's schema and the face's own reveal helper", async () => {
    const fake = await startFakeHost({ results: {} })
    hosts.push(fake)
    const definition = createKisakiHostDefinition(createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }), { tool: "similar-images" }, "zh")
    // The scanner palette and the guided prompts read the same vocabulary the node publishes.
    const toolField = definition.schema.fields.find((field) => field.id === "tool")
    expect(toolField?.options?.map((option) => option.value)).toContain("similar-images")
    expect(definition.openPath).toBeTypeOf("function")
  })
})

function entry(path: string): KisakiData["entries"][number] {
  const name = path.split("/").pop() ?? path
  return { id: path, groupId: 0, path, name, size: 12, modifiedDate: 1 }
}

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine
  // running it.
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
