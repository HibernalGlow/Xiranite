import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createEngineVHostDefinition, runProgram } from "./cli.js"
import type { EngineVData, EngineVResult } from "./core.js"

const HOST_TOKEN = "attach-token"
const NODE_ID = "enginev"

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
 * these tests is that the face holds no node engine of its own. `enginev` is still wave B (not in the Rust
 * registry), so the bodies below follow `crates/xiranite-core/src/operation/dto.rs` and this file's own
 * mirror of `core.ts`'s `EngineVData`; nothing here proves the host is correct.
 */
async function startFakeHost(options: {
  results: Record<string, EngineVResult>
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

/** `core.ts`'s `EngineVData` shape, so the face renders a complete document. */
function data(partial: Partial<EngineVData> = {}): EngineVData {
  return {
    wallpapers: [],
    filteredWallpapers: [],
    totalCount: 0,
    filteredCount: 0,
    successCount: 0,
    failedCount: 0,
    typeStats: {},
    ratingStats: {},
    renameResults: [],
    deleteResults: [],
    exportPath: "",
    errors: [],
    ...partial,
  }
}

function wallpaper(partial: Partial<EngineVData["wallpapers"][number]> = {}): EngineVData["wallpapers"][number] {
  return {
    path: "E:/workshop/111",
    folderName: "111",
    workshopId: "111",
    title: "Ocean Loop",
    description: "calm motion",
    contentRating: "Everyone",
    ratingSex: "",
    ratingViolence: "",
    tags: ["test"],
    fileName: "project.json",
    preview: "preview.png",
    wallpaperType: "Video",
    createdTime: "2024-01-01",
    modifiedTime: "2024-01-02",
    size: 1024,
    projectData: {},
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
  const dir = await mkdtemp(join(tmpdir(), "xiranite-enginev-fake-host-"))
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

describe("enginev CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("enginev ui")
  })

  test("scans as a host operation and prints the result document", async () => {
    const fake = await startFakeHost({
      results: {
        scan: { success: true, message: "Scan complete: 1 wallpaper(s).", data: data({ totalCount: 1, successCount: 1, wallpapers: [wallpaper()], typeStats: { Video: 1 }, ratingStats: { Everyone: 1 } }) },
      },
    })
    hosts.push(fake)
    const runHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "--path", "E:/SteamLibrary/工坊/workshop", "--json"], runHost)

    expect(process.exitCode).toBe(0)
    expect(runHost.stderrText()).toBe("")
    expect(runHost.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(runHost.stdoutText()) as EngineVResult
    expect(result.success).toBe(true)
    expect(result.data?.wallpapers).toHaveLength(1)
    expect(result.data?.typeStats).toEqual({ Video: 1 })

    // One start call, carrying the node input verbatim: absolute paths and CJK included.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["scan"])
    expect(fake.starts[0]?.input).toMatchObject({ path: "E:/SteamLibrary/工坊/workshop" })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"path":"E:/SteamLibrary/工坊/workshop"`)
  })

  test("rename keeps its template and dry-run default in the input document", async () => {
    const fake = await startFakeHost({
      results: {
        rename: { success: true, message: "Rename plan ready", data: data({ totalCount: 1, renameResults: [{ workshopId: "111", title: "Ocean Loop", oldPath: "E:/w/111", newPath: "E:/w/#111", oldName: "111", newName: "#111", status: "planned" }] }) },
      },
    })
    hosts.push(fake)
    const runHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["rename", "--path", "E:/w", "--template", "[#{id}]{title}", "--json"], runHost)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "rename", template: "[#{id}]{title}", dryRun: true })
    const summary = JSON.parse(runHost.stdoutText()) as EngineVResult
    expect(summary.data?.renameResults[0]?.newName).toBe("#111")

    // `--execute` is the switch that lets the host touch files, and copy mode carries its target along.
    await runProgram(["rename", "--path", "E:/w", "--execute", "--copyMode", "--targetPath", "E:/out", "--json"], runHost)
    expect(fake.starts[1]?.input).toMatchObject({ action: "rename", dryRun: false, copyMode: true, targetPath: "E:/out" })
  })

  test("a wallpapers file is read by the face and travels inside the input document", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xiranite-enginev-wallpapers-"))
    scriptDirs.push(dir)
    const file = join(dir, "scan.json")
    await writeFile(file, JSON.stringify({ wallpapers: [wallpaper({ workshopId: "222", title: "Neon Rain" })] }), "utf8")

    const fake = await startFakeHost({
      results: { filter: { success: true, message: "Filter matched 1 wallpaper(s).", data: data({ totalCount: 1, filteredCount: 1, filteredWallpapers: [wallpaper({ workshopId: "222", title: "Neon Rain" })] }) } },
    })
    hosts.push(fake)
    const runHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["filter", "--wallpapersFile", file, "--type", "Video", "--json"], runHost)

    expect(process.exitCode).toBe(0)
    // The face does not filter anything itself: it hands the parsed list and the filter words to the host.
    const input = fake.starts[0]?.input as { wallpapers?: unknown[]; filters?: Record<string, unknown> }
    expect(input.wallpapers).toHaveLength(1)
    expect(input.filters).toMatchObject({ type: "Video" })
  })

  test("renders host events and the summary panel without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 50, message: "scanning E:/workshop/111" },
        { type: "log", message: "read project.json" },
      ],
      results: {
        scan: { success: true, message: "Scan complete: 1 wallpaper(s).", data: data({ totalCount: 1, successCount: 1, wallpapers: [wallpaper()], filteredWallpapers: [wallpaper()], filteredCount: 1, typeStats: { Video: 1 } }) },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "--path", "E:/workshop"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Scan complete: 1 wallpaper(s).")
    expect(stdout).toContain("执行结果")
    expect(stdout).toContain("类型分布")
    expect(stdout).toContain("read project.json")
    expect(stdout).toContain("Ocean Loop")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { scan: { success: true, message: "Scan complete: 0 wallpaper(s).", data: data() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["scan", "--path", "E:/books", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "scan", path: "E:/books" })
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path used to run the node
    // in-process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["scan", "--path", "E:/workshop", "--json"], host)

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
    const fake = await startFakeHost({ results: { scan: { success: true, message: "Scan complete: 1 wallpaper(s).", data: data({ totalCount: 1 }) } } })
    hosts.push(fake)
    const { binary, pidFile } = await fakeHostScript(fake.baseUrl, HOST_TOKEN)

    // One bare command line: no `--backend`, no `XIRANITE_BACKEND_URL`, no channel file.
    const host = createHost({ XIRANITE_HOST_BIN: binary, XIRANITE_FAKE_HOST_PID_FILE: pidFile })
    await runProgram(["scan", "--path", "E:/workshop", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect((JSON.parse(host.stdoutText()) as EngineVResult).message).toBe("Scan complete: 1 wallpaper(s).")
    expect(fake.starts.map((start) => start.input.action)).toEqual(["scan"])

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
      results: { delete: { success: false, message: "no plugin runtime is attached to this host", data: data({ failedCount: 1, errors: ["no runtime"] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["delete", "--path", "E:/w", "--ids", "111", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as EngineVResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("no plugin runtime")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { scan: { success: true, message: "Scan complete" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "--path", "E:/w", "--json"], host)

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
  finish(result: EngineVResult): void
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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "scanning E:/w" } })}\n`)
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

describe("enginev terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createEngineVHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "scan", workshopPath: "E:/w" }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(messages).toEqual(["scanning E:/w"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createEngineVHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "rename", workshopPath: "E:/w" }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Rename plan ready", data: data({ wallpapers: [wallpaper()] }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("carries the last host scan into the next action instead of re-scanning locally", async () => {
    const fake = await startFakeHost({
      results: {
        scan: { success: true, message: "Scan complete: 1 wallpaper(s).", data: data({ totalCount: 1, wallpapers: [wallpaper({ workshopId: "333" })] }) },
        filter: { success: true, message: "Filter matched 1 wallpaper(s).", data: data({ filteredCount: 1 }) },
      },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createEngineVHostDefinition(face, {}, "zh")

    await definition.run({ action: "scan", workshopPath: "E:/w" }, () => undefined)
    await definition.run({ action: "filter", workshopPath: "E:/w" }, () => undefined)

    expect(fake.starts.map((start) => start.input.action)).toEqual(["scan", "filter"])
    // The second operation carries the list the host returned, not one this face produced.
    const second = fake.starts[1]?.input as { wallpapers?: Array<{ workshopId?: string }> }
    expect(second.wallpapers?.map((item) => item.workshopId)).toEqual(["333"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createEngineVHostDefinition(face, {}, "zh")

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
