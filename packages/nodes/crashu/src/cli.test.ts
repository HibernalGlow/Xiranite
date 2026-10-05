import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createCrashuHostDefinition, runProgram } from "./cli.js"
import type { CrashuData, CrashuInput, CrashuResult } from "./core.js"

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
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that this face holds no node engine of its own — nothing here runs `core.ts` and nothing here
 * moves a folder. The bodies mirror the operation DTOs `crates/xiranite-api` answers with, so they prove the
 * face's side of the wire and make no claim about the host.
 */
async function startFakeHost(options: {
  results: Record<string, CrashuResult>
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
  return { operationId, nodeId: "crashu", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `data()` defaults, so the face renders a complete document instead of a partial one. */
function crashuData(partial: Partial<CrashuData> = {}): CrashuData {
  return {
    sourceCount: 0,
    targetCount: 0,
    totalScanned: 0,
    similarFound: 0,
    movedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    pairsFile: "",
    similarFolders: [],
    plan: [],
    errors: [],
    ...partial,
  }
}

function similarFolder(partial: Partial<CrashuData["similarFolders"][number]> = {}): CrashuData["similarFolders"][number] {
  return {
    name: "蜂蜜作品 [Alt Name]",
    path: "D:/Media/示例/source/蜂蜜作品 [Alt Name]",
    target: "Alt Name",
    similarity: 0.91,
    matchDim: "token",
    matchSrc: "蜂蜜作品 alt name",
    matchTgt: "alt name",
    ...partial,
  }
}

function planItem(partial: Partial<CrashuData["plan"][number]> = {}): CrashuData["plan"][number] {
  return {
    sourcePath: "D:/Media/示例/source/蜂蜜作品 [Alt Name]",
    targetName: "Alt Name",
    destinationPath: "D:/Media/示例/destination/Alt Name/蜂蜜作品 [Alt Name]",
    direction: "to_target",
    similarity: 0.91,
    status: "pending",
    reason: "matched",
    ...partial,
  }
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

describe("crashu CLI", () => {
  test("refuses the configured UI outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("crashu ui")
  })

  test("scans as a host operation and prints the result document", async () => {
    const fake = await startFakeHost({
      results: { scan: { success: true, message: "Scan completed: 1 similar folder(s).", data: crashuData({ sourceCount: 1, targetCount: 1, totalScanned: 1, similarFound: 1, similarFolders: [similarFolder()] }) } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram([
      "scan",
      "--source",
      "D:\\Media\\示例\\source",
      "--targetPath",
      "D:/Media/目标",
      "--similarityThreshold",
      "0.8",
      "--pairsFileName",
      "配对.json",
      "--json",
    ], face)

    expect(process.exitCode).toBe(0)
    expect(face.stderrText()).toBe("")
    expect(face.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(face.stdoutText()) as CrashuResult
    expect(result.success).toBe(true)
    expect(result.data?.similarFound).toBe(1)

    // One start call on this node's own route, carrying the node input verbatim: Windows separators and CJK.
    expect(fake.starts.map((start) => start.nodeId)).toEqual(["crashu"])
    expect(fake.starts.map((start) => start.input.action)).toEqual(["scan"])
    expect(fake.starts[0]?.input).toMatchObject({
      sourcePaths: ["D:\\Media\\示例\\source"],
      targetPath: "D:/Media/目标",
      similarityThreshold: 0.8,
      pairsFileName: "配对.json",
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"D:\\Media\\示例\\source"`)
  })

  test("move travels autoMove, and the schema keeps the danger gate that runs after confirmation", async () => {
    const fake = await startFakeHost({
      results: { move: { success: true, message: "Crashu completed: 1 matched, 0 moved, 0 error(s).", data: crashuData({ similarFound: 1, movedCount: 0, skippedCount: 1, plan: [planItem({ status: "skipped", destinationPath: "", reason: "target_exists" })], similarFolders: [similarFolder()] }) } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["move", "--source", "D:/media/src", "--targetNames", "Alt Name, 另一个", "--destinationPath", "D:/media/dst", "--moveDirection", "to_source", "--conflictPolicy", "rename", "--dryRun", "--json"], face)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toEqual(expect.objectContaining({
      action: "move",
      autoMove: true,
      dryRun: true,
      targetNames: ["Alt Name", "另一个"],
      moveDirection: "to_source",
      conflictPolicy: "rename",
      destinationPath: "D:/media/dst",
    }))

    // The gate itself is unchanged by the transport: naming the write action is dangerous only when the dry
    // run is explicitly off, and the session asks before it ever calls `run` — see `runGuidedInteraction`.
    const { schema } = createCrashuHostDefinition(face, {}, "zh")
    const live: CrashuInput = { action: "move", autoMove: true, dryRun: false, sourcePaths: ["D:/media/src"], destinationPath: "D:/media/dst" }
    expect(schema.isDangerous(live)).toBe(true)
    expect(schema.isDangerous({ ...live, dryRun: true })).toBe(false)
    expect(schema.isDangerous({ ...live, action: "plan" })).toBe(false)
    expect(schema.dangerPrompt?.(live)).toMatchObject({ title: "确认执行目录移动", body: "匹配目录将按冲突策略移动，覆盖无法撤销。", confirmLabel: "确认移动" })
  })

  test("plan stays read-only in the document the host receives", async () => {
    const fake = await startFakeHost({
      results: { plan: { success: true, message: "Plan generated: 1 move(s).", data: crashuData({ similarFound: 1, plan: [planItem()] }) } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "--sourcePaths", "D:/a;D:/b", "--targetPath", "D:/targets", "--threshold", "0.5", "--json"], face)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.map((start) => start.input)).toEqual([expect.objectContaining({
      action: "plan",
      sourcePaths: ["D:/a", "D:/b"],
      targetPath: "D:/targets",
      similarityThreshold: 0.5,
    })])
  })

  test("renders host events and the summary panel without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 40, message: "Scanning source folders." },
        { type: "log", message: "moving 蜂蜜作品 [Alt Name]" },
      ],
      results: { move: { success: true, message: "Crashu completed: 1 matched, 1 moved, 0 error(s).", data: crashuData({ similarFound: 1, movedCount: 1, pairsFile: "D:/media/dst/folder_pairs.json", similarFolders: [similarFolder()], plan: [planItem({ status: "success" })] }) } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["move", "--source", "D:/media/src", "--targetPath", "D:/media/targets", "--destinationPath", "D:/media/dst"], face)

    expect(process.exitCode).toBe(0)
    const stdout = face.stdoutText()
    expect(stdout).toContain("Crashu completed: 1 matched, 1 moved, 0 error(s).")
    expect(stdout).toContain("Summary")
    expect(stdout).toContain("moving 蜂蜜作品 [Alt Name]")
    expect(stdout).toContain("D:/media/dst/folder_pairs.json")
    // Non-JSON runs still show the plan rows the panel has always printed.
    expect(stdout).toContain("移动计划")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { scan: { success: true, message: "Scan completed: 0 similar folder(s).", data: crashuData() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const face = createHost()

    await runProgram(["scan", "--source", "D:/media/src", "--targetPath", "D:/media/targets", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], face)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    const input = fake.starts[0]?.input ?? {}
    expect(input).not.toHaveProperty("backend")
    expect(input).not.toHaveProperty("token")
    // The attach url is not mistaken for a source directory either.
    expect(input).toMatchObject({ action: "scan", sourcePaths: ["D:/media/src"] })
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path ran `core.ts` in this
    // process here, which is exactly what must not happen any more.
    const face = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["scan", "--source", "D:/media/src", "--targetPath", "D:/media/targets", "--json"], face)

    expect(process.exitCode).toBe(1)
    expect(face.stdoutText()).toBe("")
    expect(face.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(face.stderrText()).toContain("--backend <url> --token <token>")
    expect(face.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(face.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { scan: { success: true, message: "Scan completed: 0 similar folder(s).", data: crashuData() } }, token: "other-token" })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "--source", "D:/media/src", "--targetPath", "D:/media/targets", "--json"], face)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(face.stdoutText()).toBe("")
  })

  test("a host that reports failure answers with its own document and exit code 1", async () => {
    const fake = await startFakeHost({
      results: { scan: { success: false, message: "At least one source directory is required.", data: crashuData({ errors: ["At least one source directory is required."], errorCount: 1 }) } },
    })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "--source", "D:/media/src", "--targetPath", "D:/media/targets", "--json"], face)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(face.stdoutText()) as CrashuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("At least one source directory")
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

  test("the node's own guided flow refuses on the same gate before it renders", async () => {
    // `crashu gd` and `crashu guided` go through the shared guide; this bespoke loop is what an operator
    // gets when the node config keeps `cli.default_mode = "pipe"`, so it carries the same host gate.
    const dir = await mkdtemp(join(tmpdir(), "xiranite-crashu-face-"))
    sandboxDirs.push(dir)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "xiranite.config.toml"), "[nodes.crashu.cli]\ndefault_mode = \"pipe\"\n", "utf8")
    const face = createHost({ XIRANITE_DATA_DIR: dir, XIRANITE_HOST_BIN: join(dir, "no-host-binary-here") })
    ;(face.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(face.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram([], face)

    expect(process.exitCode).toBe(1)
    expect(face.stdoutText()).toBe("")
    expect(face.stderrText()).toContain("XIRANITE_HOST_BIN points at")
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
  finish(result: CrashuResult): void
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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 25, message: "Loading target folder names." } })}\n`)
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

describe("crashu terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const hanging = await startHangingHost()
    hosts.push(hanging)
    const face = createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createCrashuHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "scan", sourcePaths: ["D:/media/src"], targetPath: "D:/media/targets" }, (event) => messages.push(event.message))
    await hanging.streamOpened
    await definition.cancel?.()
    hanging.finish({ success: false, message: "Node operation cancelled.", data: crashuData() })
    const result = await running

    expect(messages).toEqual(["Loading target folder names."])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(hanging.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const hanging = await startHangingHost()
    hosts.push(hanging)
    const face = createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createCrashuHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "move", sourcePaths: ["D:/media/src"], destinationPath: "D:/media/dst", dryRun: true }, () => undefined)
    await hanging.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    hanging.finish({ success: true, message: "Crashu completed: 0 matched, 0 moved, 0 error(s).", data: crashuData() })
    const result = await running

    expect(result.success).toBe(true)
    expect(hanging.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const hanging = await startHangingHost()
    hosts.push(hanging)
    const face = createHost({ XIRANITE_BACKEND_URL: hanging.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createCrashuHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(hanging.controlPaths).toEqual([])
  })

  test("config defaults for the pairs file and destination still reach the schema", () => {
    const face = createHost({ XIRANITE_BACKEND_URL: "http://127.0.0.1:1", XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const { schema } = createCrashuHostDefinition(face, { output: { pairs_file_name: "配对.json", directory: "D:/media/dst", overwrite: true } }, "zh")
    expect(schema.initialValues).toMatchObject({ pairsFileName: "配对.json", destinationPath: "D:/media/dst", conflictPolicy: "overwrite" })
    expect(schema.toInput({ ...schema.initialValues, action: "move", sourcePaths: "D:/media/src", targetNames: "Alt Name" })).toMatchObject({
      autoMove: true,
      dryRun: true,
      conflictPolicy: "overwrite",
    })
  })
})

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine running
  // it. The data dir points at an empty sandbox so node config defaults cannot make the input document vary
  // between machines either.
  return {
    cwd: process.cwd(),
    env: { XIRANITE_DATA_DIR: join(tmpdir(), "xiranite-crashu-face-empty"), ...extraEnv, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
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
