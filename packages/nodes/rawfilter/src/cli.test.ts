import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Readable } from "node:stream"
import type { CliHost } from "@xiranite/cli-runtime"
import { createRawfilterHostDefinition, runProgram } from "./cli.js"
import type { RawfilterData, RawfilterPlanItem, RawfilterResult } from "./core.js"

const HOST_TOKEN = "attach-token"
/** A config path that cannot exist, so no machine's `xiranite.config.toml` can move these expectations. */
const MISSING_CONFIG = resolve("artifacts/test-runs/rawfilter-cli-missing-config.toml")

interface RecordedStart {
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
  path: string
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of these
 * tests is that the face holds no node engine of its own — the URL, the bearer header and the streamed frames
 * are what a mocked client would hide. `crates/xiranite-api` is still being wired, so the bodies follow
 * `crates/xiranite-core/src/operation/dto.rs` and `core.ts`'s own `data()` mirror; nothing here proves the host
 * is correct.
 */
async function startFakeHost(options: {
  results: Record<string, RawfilterResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  const pending = new Map<string, Record<string, unknown>>()
  let sequence = 0

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route the real host serves without the bearer token, and the face probes it
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
        starts.push({ input, rawBody: body, path })
        pending.set(operationId, input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const input = pending.get(stream[1])
        const result = options.results[String(input?.action ?? "")] ?? { success: false, message: "no scripted result", data: data() }
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

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { operationId, nodeId: "rawfilter", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `data()` defaults, so the face renders a complete document. */
function data(partial: Partial<RawfilterData> = {}): RawfilterData {
  return {
    archiveCount: 0,
    totalGroups: 0,
    duplicateGroups: 0,
    skippedFiles: 0,
    movedToTrash: 0,
    movedToMulti: 0,
    createdShortcuts: 0,
    keptCount: 0,
    errorCount: 0,
    plan: [],
    groups: [],
    errors: [],
    ...partial,
  }
}

function planItem(partial: Partial<RawfilterPlanItem> = {}): RawfilterPlanItem {
  return {
    groupKey: "game",
    groupLabel: "Game",
    fileName: "Game RAW.rar",
    sourcePath: "D:/归档/示例/Game RAW.rar",
    targetPath: "D:/归档/示例/trash/Game RAW.rar",
    destination: "trash",
    status: "pending",
    variant: "raw",
    reason: "duplicate raw version",
    ...partial,
  }
}

const hosts: { close(): Promise<void> }[] = []
const cleanup: string[] = []

/**
 * A stand-in for the child ADR-0074 §6 has the face spawn: it prints one `XIRANITE_CHANNEL` line and stays
 * alive. What is under test is the transport — spawn, read the line, build the client from it — so the line
 * points back at the fake host running inside this test process.
 */
async function fakeHostScript(baseUrl: string, token: string): Promise<{ binary: string; pidFile: string }> {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-rawfilter-fake-host-"))
  cleanup.push(dir)
  const binary = join(dir, "fake-host.sh")
  const pidFile = join(dir, "child.pid")
  // Double-quoted so the shell expands `$$`, which puts the child's own pid in `instanceId`; `exec` means that
  // pid is still the live process after the shell is gone.
  const document = JSON.stringify({ baseUrl, token, instanceId: "pid-$$" }).replace(/"/g, '\\"')
  await writeFile(binary, `#!/bin/sh\necho $$ > "$XIRANITE_FAKE_HOST_PID_FILE"\necho "XIRANITE_CHANNEL ${document}"\nexec sleep 30\n`, "utf8")
  await chmod(binary, 0o755)
  return { binary, pidFile }
}

/** A fixture archive folder: the face must leave these bytes exactly where they are. */
async function createArchiveFixture(name: string): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), "xiranite-rawfilter-")), "中文 rawfilter")
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "Game [Chinese].zip"), new Uint8Array([1, 2, 3]))
  await writeFile(join(dir, "Game RAW.rar"), new Uint8Array([4, 5, 6]))
  cleanup.push(join(dir, ".."))
  return dir
}

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true })
  process.exitCode = 0
})

describe("rawfilter CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("rawfilter")
  })

  test("plans a duplicate group as a host operation and prints the host document", async () => {
    const fixture = await createArchiveFixture("json-plan")
    const fake = await startFakeHost({
      results: {
        plan: {
          success: true,
          message: "Plan generated: 1 operation(s).",
          data: data({
            archiveCount: 2,
            totalGroups: 1,
            duplicateGroups: 1,
            keptCount: 1,
            plan: [planItem({ fileName: "Game [Chinese].zip", destination: "keep", status: "kept", targetPath: "", reason: "best translated version" }), planItem({})],
          }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "--path", fixture, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as RawfilterResult
    expect(result.message).toBe("Plan generated: 1 operation(s).")
    expect(result.data?.duplicateGroups).toBe(1)

    // One start call, on rawfilter's own route, carrying the folder verbatim: CJK and spaces included.
    expect(fake.starts.map((start) => start.path)).toEqual(["/nodes/rawfilter/operations"])
    expect(fake.starts.map((start) => start.input.action)).toEqual(["plan"])
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", path: fixture })
    expect(fake.starts[0]?.rawBody).toContain(`"path":"${fixture}"`)
    // The face has no grouping engine and no move arms: the archives stay exactly where they were, whatever the
    // host document claims.
    expect((await readFile(join(fixture, "Game RAW.rar"))).length).toBe(3)
    expect((await readFile(join(fixture, "Game [Chinese].zip"))).length).toBe(3)
  })

  test("renders the plan summary and the host's progress line without --json", async () => {
    const fake = await startFakeHost({
      events: [{ type: "progress", progress: 40, message: "scanning 中文 rawfilter" }],
      results: {
        scan: {
          success: true,
          message: "Scan completed: 2 archive(s), 1 group(s).",
          data: data({
            archiveCount: 2,
            totalGroups: 1,
            duplicateGroups: 1,
            keptCount: 1,
            groups: [{ key: "game", label: "Game", files: [
              { name: "Game [Chinese].zip", path: "D:/归档/Game [Chinese].zip", normalizedName: "game", groupKey: "game", variant: "translated", score: 5 },
              { name: "Game RAW.rar", path: "D:/归档/Game RAW.rar", normalizedName: "game", groupKey: "game", variant: "raw", score: 1 },
            ] }],
            plan: [planItem({})],
          }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "--path", "D:/归档/示例"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Scan completed: 2 archive(s), 1 group(s).")
    expect(stdout).toContain("scanning 中文 rawfilter")
    expect(stdout).toContain("archives: 2  groups: 1  duplicate: 1")
    // Plan rows are the host's, quoted verbatim: the face sorts nothing and decides nothing.
    expect(stdout).toContain("pending trash Game RAW.rar -> D:/归档/示例/trash/Game RAW.rar")
  })

  test("execute carries its flags into the input document", async () => {
    const fake = await startFakeHost({
      results: {
        execute: { success: true, message: "Execute completed: 1 moved, 0 skipped.", data: data({ movedToTrash: 1, plan: [planItem({ status: "success" })] }) },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["execute", "--path", "D:/归档/示例", "--nameOnly", "--minSimilarity", "0.7", "--trashOnly", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({
      action: "execute",
      path: "D:/归档/示例",
      nameOnlyMode: true,
      trashOnly: true,
      minSimilarity: 0.7,
    })
  })

  test("reads the folder from a bare pipe", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated: 0 operation(s).", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    host.stdin = Readable.from(["D:/归档/来自管道\n"]) as unknown as CliHost["stdin"]

    await runProgram(["plan", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", path: "D:/归档/来自管道" })
  })

  test("reads the folder from an explicit dash, and the dash never reaches the host", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated: 0 operation(s).", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    host.stdin = Readable.from(["E:/another 目录\n"]) as unknown as CliHost["stdin"]

    // `--path=-` is the spelling that arrives at the node intact (`--path -` is parsed by citty as an empty
    // value, which then falls into the piped-input branch), so this is the case that proves the explicit-dash
    // branch itself asks stdin. A dash on a real terminal still yields nothing, because the shared line reader
    // refuses to block an interactive session — that is today's behaviour and this face does not change it.
    await runProgram(["plan", "--path=-", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ path: "E:/another 目录" })
    expect(fake.starts[0]?.rawBody).not.toContain('"path":"-"')
  })

  test("the loose dash spelling still pipes: citty reads it as an empty value", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated: 0 operation(s).", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    host.stdin = Readable.from(["D:/归档/松散破折号\n"]) as unknown as CliHost["stdin"]

    await runProgram(["plan", "--path", "-", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ path: "D:/归档/松散破折号" })
  })

  test("takes its defaults from [nodes.rawfilter] and still lets flags win", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xiranite-rawfilter-config-"))
    cleanup.push(dir)
    const configPath = join(dir, "xiranite.config.toml")
    await writeFile(configPath, "[nodes.rawfilter]\nname_only_mode = true\ncreate_shortcuts = true\nmin_similarity = 0.5\ndry_run = true\n", "utf8")
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated: 0 operation(s).", data: data() } } })
    hosts.push(fake)
    const configured = createHost({ XIRANITE_CONFIG_PATH: configPath, XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "--path", "D:/归档/示例", "--json"], configured)
    expect(fake.starts[0]?.input).toMatchObject({ nameOnlyMode: true, createShortcuts: true, minSimilarity: 0.5, dryRun: true })

    // An explicit flag outranks the file, exactly as before the host.
    const overridden = createHost({ XIRANITE_CONFIG_PATH: configPath, XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    await runProgram(["plan", "--path", "D:/归档/示例", "--minSimilarity", "0.9", "--json"], overridden)
    expect(fake.starts[1]?.input).toMatchObject({ minSimilarity: 0.9, nameOnlyMode: true })
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated: 0 operation(s).", data: data() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["plan", "--path", "D:/归档", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.rawBody).not.toContain("attach-token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", path: "D:/归档" })
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face now owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there. The removed compat path used to group and
    // move the archives in-process here, which is exactly what must not happen any more.
    const fixture = await createArchiveFixture("no-host")
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["execute", "--path", fixture, "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
    // Nothing was grouped, moved or shortcut by the face.
    expect((await readFile(join(fixture, "Game RAW.rar"))).length).toBe(3)
  })

  // The child-pipe fixture is a POSIX shell script; on Windows the same code path spawns a real
  // `xiranite-dev-host.exe`, which a test cannot synthesise. `packages/cli-runtime/src/backend.test.ts`
  // covers the transport on every platform with the portable half.
  const posix = process.platform !== "win32"
  test.skipIf(!posix)("starts its own host when the operator configured nothing, and stops it again", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated: 0 operation(s).", data: data({ archiveCount: 3 }) } } })
    hosts.push(fake)
    const { binary, pidFile } = await fakeHostScript(fake.baseUrl, HOST_TOKEN)

    // One bare command line: no `--backend`, no `XIRANITE_BACKEND_URL`, no channel file.
    const host = createHost({ XIRANITE_HOST_BIN: binary, XIRANITE_FAKE_HOST_PID_FILE: pidFile })
    await runProgram(["plan", "--path", "D:/归档/示例", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect((JSON.parse(host.stdoutText()) as RawfilterResult).data?.archiveCount).toBe(3)
    expect(fake.starts.map((start) => start.input.action)).toEqual(["plan"])

    const pid = Number(readFileSync(pidFile, "utf8").trim())
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    // Control for the liveness gauge: this process is obviously alive, so the `no such process` below is a
    // claim about the child and not about `process.kill` being broken here.
    expect(() => process.kill(process.pid, 0)).not.toThrow()
    // ADR-0074 §5: the host this face started belongs to this invocation, so `runProgram` stopped it.
    expect(() => process.kill(pid, 0)).toThrow(/no such process|ESRCH/)
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fixture = await createArchiveFixture("bad-token")
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated: 0 operation(s)." } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "--path", fixture, "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(host.stdoutText()).toBe("")
    expect(process.exitCode).toBe(1)
    expect(host.stderrText()).toContain("401")
    // The archives are untouched: a rejected attach cannot turn into a local grouping run.
    expect((await readFile(join(fixture, "Game [Chinese].zip"))).length).toBe(3)
  })

  test("reports a host failure as a non-zero exit instead of a crash", async () => {
    const fake = await startFakeHost({
      results: { execute: { success: false, message: "Access denied: D:/归档/示例/trash", data: data({ errorCount: 1, errors: ["Game RAW.rar: Access denied: D:/归档/示例/trash"] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["execute", "--path", "D:/归档/示例", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as RawfilterResult
    expect(result.success).toBe(false)
    expect(result.message).toBe("Access denied: D:/归档/示例/trash")
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
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui`/`gd` definition makes
 * during a run can be observed.
 */
interface HangingHost {
  baseUrl: string
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: RawfilterResult): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolvePromise) => { resolveOpened = resolvePromise })
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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "moving Game RAW.rar" } })}\n`)
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

describe("rawfilter terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createRawfilterHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "execute", path: "D:/归档/示例" }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled.", data: data() })
    const result = await running

    expect(messages).toEqual(["moving Game RAW.rar"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createRawfilterHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "execute", path: "D:/归档/示例" }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Execute completed: 1 moved, 0 skipped.", data: data({ movedToTrash: 1 }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createRawfilterHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
  })

  test("the definition defaults come from the node config, not from a second list", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createRawfilterHostDefinition(face, { name_only_mode: true, create_shortcuts: true, trash_only: false, min_similarity: 0.5, dry_run: false }, "zh")

    expect(definition.schema.initialValues).toMatchObject({ nameOnlyMode: true, createShortcuts: true, trashOnly: false, minSimilarity: 0.5, dryRun: false })
  })
})

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine running
  // it. The config path defaults to a file that cannot exist, so no user `[nodes.rawfilter]` block can move a
  // default — a test that wants a config supplies its own `XIRANITE_CONFIG_PATH`.
  return {
    cwd: process.cwd(),
    env: { XIRANITE_CONFIG_PATH: MISSING_CONFIG, ...extraEnv, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
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
