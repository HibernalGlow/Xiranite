import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createSmartZipHostDefinition, runProgram } from "./cli.js"
import type { SmartZipData, SmartZipResult } from "./core.js"

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
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. Smartzip is wave B in
 * `docs/migration/face-execution-ledger.md` — its bundle is not in the Rust registry yet — so nothing here
 * proves the host is correct; the bodies follow `crates/xiranite-core/src/operation/dto.rs` and mirror the
 * `SmartZipData` shape `core.ts` returns.
 */
async function startFakeHost(options: {
  results: Record<string, SmartZipResult>
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
      const target = request.url ?? ""
      const path = target.split("?")[0] ?? target
      // `/health` is the one route the host serves without the bearer token, and the face probes it before
      // it opens a workbench, so a fake that did not answer it would look dead.
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
        pending.set(operationId, { nodeId: path.split("/")[2] ?? "smartzip", input })
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
  return { operationId, nodeId: "smartzip", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `SmartZipData` defaults, so the face renders a complete document. */
function data(partial: Partial<SmartZipData> = {}): SmartZipData {
  return {
    config: {
      sevenZipDir: "",
      passwords: [],
      archiveExtensions: [],
      archiveExtensionPatterns: [],
      openArchiveExtensions: [],
      codePages: [],
      targetDir: "",
      skipMultipart: false,
      nestedExtraction: false,
      nestedExtractionForMultiple: false,
      deleteSource: false,
      deleteSourceWhenPassword: false,
      addDirectoryAsPassword: false,
      excludeExtensions: [],
      excludeNames: [],
      renameExtensions: [],
      renameNames: [],
      renamePatterns: [],
      deletePatterns: [],
      archiveArgs: "",
      openArchiveArgs: "",
      contextMenu: true,
      sendTo: true,
    },
    selectedPaths: [],
    archiveCount: 0,
    errors: [],
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
  const dir = await mkdtemp(join(tmpdir(), "xiranite-smartzip-fake-host-"))
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

describe("smartzip CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("smartzip")
  })

  test("runs an extract as a host operation and prints the result document", async () => {
    const fake = await startFakeHost({
      results: {
        extract: {
          success: true,
          message: "SmartZip extract completed",
          data: data({ selectedPaths: ["D:\\归档\\漫画\\volume01.zip"], archiveCount: 1 }),
        },
      },
    })
    hosts.push(fake)
    const runHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["x", "D:\\归档\\漫画\\volume01.zip", "--code-page", "936", "--json"], runHost)

    expect(process.exitCode).toBe(0)
    expect(runHost.stderrText()).toBe("")
    expect(runHost.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(runHost.stdoutText()) as SmartZipResult
    expect(result.success).toBe(true)
    expect(result.data?.selectedPaths).toEqual(["D:\\归档\\漫画\\volume01.zip"])

    // One start call, carrying the node input verbatim: absolute paths, CJK and the code page included.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["extract"])
    expect(fake.starts[0]?.input).toMatchObject({
      paths: ["D:\\归档\\漫画\\volume01.zip"],
      codePage: 936,
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"paths":["D:\\归档\\漫画\\volume01.zip"]`)
  })

  test("status is a host operation too, and keeps the configured defaults in the input", async () => {
    const fake = await startFakeHost({
      results: { status: { success: true, message: "SmartZip status ready", data: data({ archiveCount: 3 }) } },
    })
    hosts.push(fake)
    const statusHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["status", "--json"], statusHost)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(statusHost.stdoutText()) as SmartZipResult
    expect(result.success).toBe(true)
    expect(result.data?.archiveCount).toBe(3)
    expect(fake.starts[0]?.input).toMatchObject({ action: "status", paths: [] })
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { archive: { success: true, message: "Planned", data: data() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["a", "E:/books", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "archive", paths: ["E:/books"] })
  })

  test("renders host events and the result line without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 50, message: "extracting D:/a/comic.cbz" },
        { type: "log", message: "detected 7z at /usr/local/bin/7zz" },
      ],
      results: {
        extract_codepage: {
          success: true,
          message: "SmartZip extract completed",
          data: data({ selectedPaths: ["D:/a/comic.cbz"], archiveCount: 1, errors: ["member CRC mismatch"] }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["xc", "D:/a/comic.cbz"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("extracting D:/a/comic.cbz")
    expect(stdout).toContain("detected 7z at /usr/local/bin/7zz")
    expect(stdout).toContain("SmartZip extract completed")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face now owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there. The removed compat path used to run
    // `runSmartZip()` in-process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["x", "D:/a/comic.cbz", "--json"], host)

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
  // covers the transport on every platform with the portable half (a spawn that exits before publishing).
  const posix = process.platform !== "win32"
  test.skipIf(!posix)("starts its own host when the operator configured nothing, and stops it again", async () => {
    const fake = await startFakeHost({
      results: { extract: { success: true, message: "SmartZip extract completed", data: data({ archiveCount: 1 }) } },
    })
    hosts.push(fake)
    const { binary, pidFile } = await fakeHostScript(fake.baseUrl, HOST_TOKEN)

    // One bare command line: no `--backend`, no `XIRANITE_BACKEND_URL`, no channel file.
    const host = createHost({ XIRANITE_HOST_BIN: binary, XIRANITE_FAKE_HOST_PID_FILE: pidFile })
    await runProgram(["x", "D:/a/comic.cbz", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect((JSON.parse(host.stdoutText()) as SmartZipResult).message).toBe("SmartZip extract completed")
    // The operation really went over HTTP to the host this face started, with the token that host printed.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["extract"])

    const pid = Number((await readFile(pidFile, "utf8")).trim())
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    // Control for the liveness gauge: this process is obviously alive, so `no such process` below is a
    // claim about the child and not about `process.kill` being broken in this environment.
    expect(() => process.kill(process.pid, 0)).not.toThrow()
    // ADR-0074 §5: the host this face started belongs to this invocation, so `runProgram` stopped it.
    expect(() => process.kill(pid, 0)).toThrow(/no such process|ESRCH/)
  })

  test("workbench modes refuse before the first frame when no host can be reached", async () => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
    // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
    ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram(["ui"], host)

    expect(process.exitCode).toBe(1)
    // Nothing was drawn: the OpenTUI screen only loads once the host is resolved.
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("guided mode refuses before the first prompt when no host can be reached", async () => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
    ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram(["gd"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("reports a host failure as a non-zero exit instead of a partial success", async () => {
    const fake = await startFakeHost({
      results: { extract: { success: false, message: "no plugin runtime is attached to this host", data: data({ errors: ["no runtime"] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["x", "D:/a/comic.cbz", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as SmartZipResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("no plugin runtime")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { status: { success: true, message: "SmartZip status ready" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["status", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).not.toBe(0)
    expect(host.stdoutText()).toBe("")
  })

  test("an unknown subcommand stays a usage error and never reaches the host", async () => {
    const fake = await startFakeHost({ results: {} })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["nope", "D:/a.zip", "--json"], host)

    expect(process.exitCode).toBe(2)
    expect(fake.starts.length).toBe(0)
    expect(host.stderrText()).toContain("Unknown SmartZip command")
  })
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui` definition makes
 * during a run can be observed.
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
      const requestedPath = (request.url ?? "").split("?")[0] ?? ""
      // Token-free on the real host, and the face probes it before it starts an operation.
      if (requestedPath === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const path = requestedPath

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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "extracting D:/a/comic.cbz" } })}\n`)
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

describe("smartzip terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createSmartZipHostDefinition(face, defaults(), "zh")
    const messages: string[] = []

    const running = definition.run({ action: "extract", paths: ["D:/a/comic.cbz"] }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(messages).toEqual(["extracting D:/a/comic.cbz"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createSmartZipHostDefinition(face, defaults(), "zh")

    const running = definition.run({ action: "archive", paths: ["D:/a"] }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "SmartZip archive planned", data: data() })
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
    const definition = createSmartZipHostDefinition(face, defaults(), "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
  })
})

function defaults() {
  return {
    iniPath: "",
    passwordsText: "",
    codePage: "0",
    databasePath: "",
    recordRun: false,
    dryRun: true,
  }
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
