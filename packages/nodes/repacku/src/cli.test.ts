import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createRepackuHostDefinition, runProgram } from "./cli.js"
import type { RepackuData, RepackuOperation, RepackuResult } from "./core.js"

const HOST_TOKEN = "attach-token"
const NODE_ID = "repacku"

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
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. `repacku` is still wave B (not in the Rust
 * registry), so the bodies below follow `crates/xiranite-core/src/operation/dto.rs` and this file's own
 * mirror of `core.ts`'s `RepackuData`; nothing here proves the host is correct.
 */
async function startFakeHost(options: {
  results: Record<string, RepackuResult>
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

      if (request.method === "POST" && path.startsWith(`/nodes/${NODE_ID}/`) && path.endsWith("/operations")) {
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
  return { operationId, nodeId: NODE_ID, phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `RepackuData` shape, so the face renders a complete document. */
function data(partial: Partial<RepackuData> = {}): RepackuData {
  return {
    configPath: "",
    totalFolders: 0,
    entireCount: 0,
    selectiveCount: 0,
    skipCount: 0,
    plannedCount: 0,
    compressedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    totalOperations: 0,
    galleryCount: 0,
    folderTree: null,
    operations: [],
    errors: [],
    ...partial,
  }
}

function operation(partial: Partial<RepackuOperation> = {}): RepackuOperation {
  return {
    mode: "entire",
    sourcePath: "D:/漫画/书",
    targetPath: "D:/漫画/书.zip",
    extensions: [".jpg", ".png"],
    fileCount: 2,
    status: "planned",
    originalSize: 2048,
    compressedSize: 0,
    ...partial,
  }
}

const hosts: { close(): Promise<void> }[] = []
const scriptDirs: string[] = []

/**
 * A stand-in for the child ADR-0074 §6 has the face spawn: it prints one `XIRANITE_CHANNEL` line and stays
 * alive. What is under test is the transport — spawn, read the line, build the client from it — so the line
 * points back at the fake host running inside this test process.
 */
async function fakeHostScript(baseUrl: string, token: string): Promise<{ binary: string; pidFile: string }> {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-repacku-fake-host-"))
  scriptDirs.push(dir)
  const binary = join(dir, "fake-host.sh")
  const pidFile = join(dir, "child.pid")
  // Double-quoted so the shell expands `$$`, which puts the child's own pid in `instanceId`; `exec` means
  // that pid is still the live process after the shell is gone.
  const document = JSON.stringify({ baseUrl, token, instanceId: "pid-$$" }).replace(/"/g, '\\"')
  await writeFile(
    binary,
    `#!/bin/sh\necho $$ > "$XIRANITE_FAKE_HOST_PID_FILE"\necho "XIRANITE_CHANNEL ${document}"\nexec sleep 30\n`,
    "utf8",
  )
  await chmod(binary, 0o755)
  return { binary, pidFile }
}

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  await Promise.all(scriptDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  process.exitCode = 0
})

describe("repacku CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("repacku ui")
  })

  test("compresses as a host operation and prints the result document", async () => {
    const fake = await startFakeHost({
      results: {
        compress: { success: true, message: "Compression plan complete: 1 operation(s).", data: data({ totalFolders: 1, plannedCount: 1, totalOperations: 1, operations: [operation()] }) },
      },
    })
    hosts.push(fake)
    const runHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["compress", "--path", "D:/漫画/书", "--types", "image", "--min-count", "1", "--dry-run", "--json"], runHost)

    expect(process.exitCode).toBe(0)
    expect(runHost.stderrText()).toBe("")
    expect(runHost.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(runHost.stdoutText()) as RepackuResult
    expect(result.success).toBe(true)
    expect(result.data?.plannedCount).toBe(1)
    expect(result.data?.operations[0]?.status).toBe("planned")

    // One start call, carrying the node input verbatim: absolute paths and CJK included. The face neither
    // walks the tree nor builds the archive list any more — that is core's job inside the host.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["compress"])
    expect(fake.starts[0]?.input).toMatchObject({ paths: ["D:/漫画/书"], types: "image", minCount: 1, dryRun: true })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"D:/漫画/书"`)
  })

  test("two actions in one command are two host operations, printed as one JSON array", async () => {
    const fake = await startFakeHost({
      results: {
        "gallery-pack": { success: true, message: "Gallery pack plan: 1 operation(s).", data: data({ galleryCount: 1, plannedCount: 1, totalOperations: 1, operations: [operation({ mode: "selective" })] }) },
        "single-pack": { success: true, message: "Single pack plan: 1 operation(s).", data: data({ plannedCount: 1, totalOperations: 1 }) },
      },
    })
    hosts.push(fake)
    const runHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["compress", "--path", "D:/漫画", "--gallery", "--single", "--dry-run", "--json"], runHost)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.map((start) => start.input.action)).toEqual(["gallery-pack", "single-pack"])
    const documents = JSON.parse(runHost.stdoutText()) as RepackuResult[]
    expect(documents.map((document) => document.message)).toEqual([
      "Gallery pack plan: 1 operation(s).",
      "Single pack plan: 1 operation(s).",
    ])
  })

  test("renders host events and the summary panel without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 50, message: "packing D:/漫画/书" },
        { type: "log", message: "wrote D:/漫画/书.zip" },
      ],
      results: {
        compress: { success: true, message: "Compression complete: 1 operation(s).", data: data({ totalFolders: 1, compressedCount: 1, totalOperations: 1, operations: [operation({ status: "success", targetPath: "D:/漫画/书.zip" })] }) },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["compress", "--path", "D:/漫画"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Compression complete: 1 operation(s).")
    expect(stdout).toContain("Summary")
    expect(stdout).toContain("wrote D:/漫画/书.zip")
    expect(stdout).toContain("success")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { analyze: { success: true, message: "Analysis complete", data: data({ configPath: "D:/out/repacku.json" }) } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["analyze", "--path", "D:/books", "--output", "D:/out/repacku.json", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "analyze", outputPath: "D:/out/repacku.json" })
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path used to walk and
    // pack from this process, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["compress", "--path", "D:/漫画", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  // The child-pipe fixture is a POSIX shell script; on Windows the same code path spawns a real
  // `xiranite-dev-host.exe`, which a test cannot synthesise. `packages/cli-runtime/src/backend.test.ts`
  // covers the transport on every platform with the portable half.
  const posix = process.platform !== "win32"
  test.skipIf(!posix)("starts its own host when the operator configured nothing, and stops it again", async () => {
    const fake = await startFakeHost({ results: { full: { success: true, message: "Full run complete", data: data({ totalOperations: 1 }) } } })
    hosts.push(fake)
    const { binary, pidFile } = await fakeHostScript(fake.baseUrl, HOST_TOKEN)

    // One bare command line: no `--backend`, no `XIRANITE_BACKEND_URL`, no channel file.
    const host = createHost({ XIRANITE_HOST_BIN: binary, XIRANITE_FAKE_HOST_PID_FILE: pidFile })
    await runProgram(["full", "--path", "D:/漫画", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect((JSON.parse(host.stdoutText()) as RepackuResult).message).toBe("Full run complete")
    expect(fake.starts.map((start) => start.input.action)).toEqual(["full"])

    const pid = Number((await readFile(pidFile, "utf8")).trim())
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    expect(() => process.kill(process.pid, 0)).not.toThrow()
    // ADR-0074 §5: the host this face started belongs to this invocation, so `runProgram` stopped it.
    expect(() => process.kill(pid, 0)).toThrow(/no such process|ESRCH/)
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

  test("reports a host failure as a non-zero exit instead of a partial success", async () => {
    const fake = await startFakeHost({
      results: { compress: { success: false, message: "7-Zip is not on the host's program allow-list", data: data({ failedCount: 1, errors: ["7z not allowed"] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["compress", "--path", "D:/漫画"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toContain("allow-list")
    expect(host.stdoutText()).toContain("7z not allowed")
  })

  test("a failed run under --json is still one clean document, exactly as the in-process face printed it", async () => {
    const fake = await startFakeHost({
      results: { compress: { success: false, message: "7-Zip is not on the host's program allow-list", data: data({ failedCount: 1 }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["compress", "--path", "D:/漫画", "--json"], host)

    const result = JSON.parse(host.stdoutText()) as RepackuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("allow-list")
    // Deliberately not asserted: this CLI's single-document `--json` branch has never set `process.exitCode`
    // for a `success: false` result (only the multi-action branch and the human path do). That asymmetry
    // predates the transport migration and changing it is a separate decision, so the test pins the print
    // and leaves the code alone.
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { compress: { success: true, message: "Compression complete" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["compress", "--path", "D:/漫画", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).not.toBe(0)
  })
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui`/`gd` definition
 * makes during a run can be observed. This node's workbench binds `q` to cancel, so that call is the one
 * that matters most.
 */
interface HangingHost {
  baseUrl: string
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: RepackuResult): void
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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "packing D:/漫画" } })}\n`)
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
      const operationRecord = { ...record("op-hang", "cancelled"), result }
      streamResponse.write(`${JSON.stringify({ type: "result", operation: operationRecord, result })}\n`)
      streamResponse.end()
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

describe("repacku terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createRepackuHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "compress", paths: ["D:/漫画"] }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(messages).toEqual(["packing D:/漫画"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createRepackuHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "single-pack", paths: ["D:/漫画"] }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Single pack complete", data: data({ totalOperations: 1 }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createRepackuHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
  })
})

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
