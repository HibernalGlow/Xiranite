import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createTrenameHostDefinition, runProgram } from "./cli.js"
import type { TrenameData, TrenameResult } from "./core.js"

const HOST_TOKEN = "attach-token"

interface RecordedStart {
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
  /** The operation id this start handed back — the only address the control calls may use. */
  operationId: string
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  /** Every `/node-operations/<id>/...` path the face hit, in order: streams first, then control calls. */
  operationPaths: string[]
  streamOpened: Promise<void>
  release(result: TrenameResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. `crates/xiranite-api` is still being wired,
 * so the bodies below follow `crates/xiranite-core/src/operation/dto.rs` and this node's own `TrenameData`
 * mirror of `core.ts`; nothing here proves the host is correct.
 *
 * It writes no file either. A scan that really produced a tree, or a rename that really moved a file inside
 * a test sandbox, would be evidence that the face fell back to `runTrename()` in this process — the compat
 * path ADR-0074 §5 removes.
 */
async function startFakeHost(options: {
  results?: Record<string, TrenameResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** Keeps the stream open until `release`, so control calls made during a run can be observed. */
  holdStream?: boolean
} = {}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const operationPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  const resultsByOperation = new Map<string, TrenameResult>()
  const streams = new Map<ServerResponse, string>()
  let sequence = 0
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })

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
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if (headers["x-xiranite-token"] !== expectedToken) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }

      if (request.method === "POST" && path.startsWith("/nodes/") && path.endsWith("/operations")) {
        const operationId = `op-${(sequence += 1)}`
        const body = Buffer.concat(chunks).toString("utf8")
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ input, rawBody: body, operationId })
        resultsByOperation.set(operationId, options.results?.[String(input?.action)] ?? { success: false, message: "no scripted result" })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const control = /^\/node-operations\/([^/]+)\/(cancel|pause|resume)$/.exec(path)
      if (control?.[1] && control[2]) {
        operationPaths.push(path)
        const phase = control[2] === "cancel" ? "cancelled" : control[2] === "pause" ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(control[1], phase) }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        operationPaths.push(path)
        const operationId = stream[1]
        const result = resultsByOperation.get(operationId) ?? { success: false, message: "no scripted result" }
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.write(`${JSON.stringify({ type: "operation", operation: record(operationId, "running", { startedAt: 2 }) })}\n`)
        for (const [index, event] of (options.events ?? []).entries()) {
          response.write(`${JSON.stringify({ type: "event", index, event })}\n`)
        }
        if (options.holdStream) {
          streams.set(response, operationId)
          resolveOpened()
          return
        }
        response.end(`${JSON.stringify({ type: "result", operation: record(operationId, "completed", { finishedAt: 4, result }), result })}\n`)
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
    operationPaths,
    streamOpened,
    release(result: TrenameResult): void {
      for (const [stream, operationId] of streams) {
        stream.write(`${JSON.stringify({ type: "result", operation: record(operationId, "cancelled", { result }), result })}\n`)
        stream.end()
      }
      streams.clear()
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "trename", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s result defaults, so the face renders a complete document. */
function data(partial: Partial<TrenameData> = {}): TrenameData {
  return {
    jsonContent: "",
    segments: [],
    totalItems: 0,
    pendingCount: 0,
    readyCount: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    operationId: "",
    conflicts: [],
    operations: [],
    history: [],
    basePath: "",
    errors: [],
    ...partial,
  }
}

const hosts: FakeHost[] = []
const sandboxes: string[] = []

/**
 * The only directories these tests create: a gallery to scan, a folder with a real file in it, and a
 * witness file the input document never names. The face must leave all of them as it found them, because
 * renaming, scanning and journaling are the host's job.
 */
async function createSandbox(): Promise<{ root: string; galleryRoot: string; renameRoot: string; fileInRenameRoot: string; witness: string }> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-trename-face-"))
  sandboxes.push(root)
  const galleryRoot = join(root, "画集")
  const renameRoot = join(root, "重命名")
  const witness = join(root, "沙箱外", "别碰.txt")
  await mkdir(galleryRoot, { recursive: true })
  await mkdir(renameRoot, { recursive: true })
  await mkdir(join(root, "沙箱外"), { recursive: true })
  const fileInRenameRoot = join(renameRoot, "一号.jpg")
  await writeFile(join(galleryRoot, "封面.jpg"), "jpg", "utf8")
  await writeFile(join(galleryRoot, "说明.txt"), "txt", "utf8")
  await writeFile(fileInRenameRoot, "jpg", "utf8")
  await writeFile(witness, "do not touch", "utf8")
  return { root, galleryRoot, renameRoot, fileInRenameRoot, witness }
}

/** Nothing scanned, nothing renamed, nothing journalled: no node core ran in this process. */
async function expectSandboxUntouched(sandbox: { galleryRoot: string; renameRoot: string; witness: string }): Promise<void> {
  expect((await readdir(sandbox.galleryRoot)).sort()).toEqual(["封面.jpg", "说明.txt"].sort())
  expect(await readdir(sandbox.renameRoot)).toEqual(["一号.jpg"])
  expect(await readFile(sandbox.witness, "utf8")).toBe("do not touch")
}

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  await Promise.all(sandboxes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  process.exitCode = 0
})

describe("trename CLI", () => {
  test("refuses the configured interactive mode outside a terminal", async () => {
    const host = createHost([])

    await runProgram(host.args, host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("requires an interactive terminal")
    expect(host.stderrText()).toContain("subcommand")
    expect(host.stderrText()).toContain("--json")
  })

  test("scans as a host operation with the input document verbatim", async () => {
    const sandbox = await createSandbox()
    const scanJson = JSON.stringify({ root: [{ src_dir: "画集", tgt_dir: "Album", children: [{ src: "封面.jpg", tgt: "cover.jpg" }] }] })
    const fake = await startFakeHost({
      results: { scan: { success: true, message: "Scan completed", data: data({ jsonContent: scanJson, segments: [scanJson], totalItems: 2, pendingCount: 1, readyCount: 0, basePath: sandbox.root }) } },
      events: [{ type: "progress", progress: 60, message: "Scanning 画集" }],
    })
    hosts.push(fake)
    const host = createHost([
      "scan",
      "--path", sandbox.galleryRoot,
      "--mode", "leak",
      "--includeHidden",
      "--noRoot",
      "--exclude", ".jpg,.txt",
      "--maxLines", "1000",
      "--json",
    ], fake)

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as TrenameResult
    expect(result.success).toBe(true)
    expect(result.data?.jsonContent).toContain("cover.jpg")

    expect(fake.starts.map((start) => start.input.action)).toEqual(["scan"])
    expect(fake.starts[0]?.input).toMatchObject({
      paths: sandbox.galleryRoot,
      mode: "leak",
      includeHidden: true,
      includeRoot: false,
      excludeExts: ".jpg,.txt",
      maxLines: 1000,
      dryRun: true,
    })
    expect(fake.starts[0]?.rawBody).toContain(`"paths":"${sandbox.galleryRoot}"`)
    await expectSandboxUntouched(sandbox)
  })

  test("writes the scan output file the operator named, and segments it the way the host answered", async () => {
    const sandbox = await createSandbox()
    const fake = await startFakeHost({
      results: {
        scan: {
          success: true,
          message: "Scan completed",
          data: data({ jsonContent: "one", segments: ["first", "second"], totalItems: 3 }),
        },
      },
    })
    hosts.push(fake)
    const output = join(sandbox.root, "输出", "scan.json")
    await mkdir(join(sandbox.root, "输出"), { recursive: true })
    const host = createHost(["scan", "--path", sandbox.galleryRoot, "--output", output, "--json"], fake)

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    // `writeSegments` is the face's own job for a file the operator asked for, driven by the host's segments.
    expect(await readFile(join(sandbox.root, "输出", "scan_1.json"), "utf8")).toBe("first\n")
    expect(await readFile(join(sandbox.root, "输出", "scan_2.json"), "utf8")).toBe("second\n")
    expect(existsSync(output)).toBe(false)
    await expectSandboxUntouched(sandbox)
  })

  test("a live rename reaches the host with dryRun false and never touches the file itself", async () => {
    const sandbox = await createSandbox()
    const fake = await startFakeHost({
      results: {
        rename: {
          success: true,
          message: "Rename completed",
          data: data({
            successCount: 1,
            totalCount: 1,
            operationId: "batch-9",
            basePath: sandbox.renameRoot,
            operations: [{ originalPath: join(sandbox.renameRoot, "一号.jpg"), newPath: join(sandbox.renameRoot, "ONE.jpg") }],
            history: [{ id: "batch-9", timestamp: "2026-10-06T02:00:00.000Z", description: "rename 1", undone: false, operations: [{ originalPath: "一号.jpg", newPath: "ONE.jpg" }] }],
          }),
        },
      },
    })
    hosts.push(fake)
    const inputJson = join(sandbox.root, "改名.json")
    const jsonBody = JSON.stringify({ root: [{ src: "一号.jpg", tgt: "ONE.jpg" }] })
    await writeFile(inputJson, jsonBody, "utf8")
    const undoPath = join(sandbox.root, "记录", "trename-undo.json")
    const host = createHost(["rename", "--input", inputJson, "--base", sandbox.renameRoot, "--undoPath", undoPath, "--execute", "--json"], fake)

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    const result = JSON.parse(host.stdoutText()) as TrenameResult
    expect(result.data?.successCount).toBe(1)

    // The document the host was told to apply is the file's own bytes, CJK included, not a re-encoding.
    expect(fake.starts[0]?.input).toMatchObject({
      action: "rename",
      jsonContent: jsonBody,
      basePath: sandbox.renameRoot,
      undoPath,
      dryRun: false,
    })
    // The CJK stays legible in the POST body while the inner quotes are escaped by `JSON.stringify`.
    expect(fake.starts[0]?.rawBody).toContain("一号.jpg")
    expect((JSON.parse(fake.starts[0]!.rawBody) as { input: { jsonContent?: string } }).input.jsonContent).toBe(jsonBody)
    // `--execute` renamed nothing in this process.
    await expectSandboxUntouched(sandbox)
  })

  test("expands stdin for the dash spelling and for a piped rename with no input file", async () => {
    const dash = await startFakeHost({ results: { import: { success: true, message: "Import completed", data: data({ totalItems: 1, jsonContent: "{}" }) } } })
    hosts.push(dash)
    const dashHost = createHost(["import", "--input", "-", "--json"], dash)
    dashHost.pipeStdin('{"root":[{"src":"一号.jpg","tgt":"ONE.jpg"}]}')
    await runProgram(dashHost.args, dashHost)

    expect(process.exitCode).toBe(0)
    // `readStdinText` hands the raw bytes over, trailing newline and all: the face re-encodes nothing.
    expect(dash.starts[0]?.input).toMatchObject({ action: "import", jsonContent: '{"root":[{"src":"一号.jpg","tgt":"ONE.jpg"}]}\n' })

    // No `--input` at all with a non-TTY stdin: the same capture the legacy in-process run did.
    const piped = await startFakeHost({ results: { validate: { success: true, message: "Validate completed", data: data({ totalItems: 1, readyCount: 1 }) } } })
    hosts.push(piped)
    const pipedHost = createHost(["validate", "--base", "/tmp/沙箱/重命名", "--json"], piped)
    pipedHost.pipeStdin('{"root":[{"src":"a.jpg","tgt":"b.jpg"}]}')
    await runProgram(pipedHost.args, pipedHost)

    expect(process.exitCode).toBe(0)
    expect(piped.starts[0]?.input).toMatchObject({ action: "validate", jsonContent: '{"root":[{"src":"a.jpg","tgt":"b.jpg"}]}\n', basePath: "/tmp/沙箱/重命名" })
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { history: { success: true, message: "History loaded", data: data() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost(["history", "--undoPath", "/tmp/沙箱/记录/trename-undo.json", "--json"])
    host.args.push("--backend", fake.baseUrl, "--token", HOST_TOKEN)

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    for (const key of ["backend", "token", "channelFile", "channel-file"]) {
      expect(fake.starts[0]?.input).not.toHaveProperty(key)
    }
    expect(fake.starts[0]?.input).toMatchObject({ action: "history", undoPath: "/tmp/沙箱/记录/trename-undo.json" })
  })

  test("undo and history are host operations carrying the undo path verbatim", async () => {
    const fake = await startFakeHost({
      results: {
        undo: { success: true, message: "Undo completed", data: data({ successCount: 1, history: [{ id: "batch-9", timestamp: "2026-10-06T02:00:00.000Z", description: "rename 1", undone: true, operations: [] }] }) },
        history: { success: true, message: "History loaded", data: data({ history: [{ id: "batch-9", timestamp: "2026-10-06T02:00:00.000Z", description: "rename 1", undone: false, operations: [] }] }) },
      },
    })
    hosts.push(fake)
    const undoPath = "/tmp/沙箱/记录/trename-undo.json"

    const historyHost = createHost(["history", "--undoPath", undoPath, "--json"], fake)
    await runProgram(historyHost.args, historyHost)
    expect((JSON.parse(historyHost.stdoutText()) as TrenameResult).data?.history).toHaveLength(1)

    const undoHost = createHost(["undo", "--undoPath", undoPath, "--batchId", "batch-9", "--json"], fake)
    await runProgram(undoHost.args, undoHost)
    expect((JSON.parse(undoHost.stdoutText()) as TrenameResult).success).toBe(true)

    expect(fake.starts.map((start) => start.input.action)).toEqual(["history", "undo"])
    expect(fake.starts[1]?.input).toMatchObject({ action: "undo", undoPath, batchId: "batch-9" })
  })

  test("a disabled undo config refuses before the host is ever asked", async () => {
    const sandbox = await createSandbox()
    const fake = await startFakeHost({ results: { undo: { success: true, message: "Undo completed" } } })
    hosts.push(fake)
    const config = join(sandbox.root, "xiranite.config.toml")
    await writeFile(config, "[nodes.trename]\nenable_undo = false\n", "utf8")
    const host = createHost(["undo", "--undoPath", join(sandbox.root, "记录.json"), "--json"], fake, { XIRANITE_CONFIG_PATH: config })

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toContain("Undo 功能已被配置禁用")
    // The gate is in front of the call: no operation was started at all.
    expect(fake.starts).toEqual([])
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    const sandbox = await createSandbox()
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path used to run
    // `runTrename()` in-process here, which is exactly what must not happen any more.
    const host = createHost(["rename", "--jsonContent", '{"root":[]}', "--base", sandbox.renameRoot, "--execute", "--json"], undefined, {
      XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host"),
    })

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
    await expectSandboxUntouched(sandbox)
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const sandbox = await createSandbox()
    const fake = await startFakeHost({ results: { rename: { success: true, message: "Rename completed" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost(["rename", "--jsonContent", '{"root":[{"src":"一号.jpg","tgt":"ONE.jpg"}]}', "--base", sandbox.renameRoot, "--execute", "--json"], fake)

    await runProgram(host.args, host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("401")
    // The live rename did not happen behind the host's back either.
    await expectSandboxUntouched(sandbox)
  })

  test("gd and its guided alias refuse before the first prompt when no host can be reached", async () => {
    for (const invocation of ["gd", "guided"]) {
      const host = createHost([invocation], undefined, { XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") })
      // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
      ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
      ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

      await runProgram(host.args, host)

      expect(process.exitCode).toBe(1)
      // Nothing was asked: the intro panel and the first prompt both come after the host is resolved.
      expect(host.stdoutText()).toBe("")
      expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
      process.exitCode = 0
    }
  })
})

describe("trename terminal definition", () => {
  test("runs on the host and cancels the operation this face started", async () => {
    const fake = await startFakeHost({ holdStream: true })
    hosts.push(fake)
    const face = createHost([], fake)
    const definition = createTrenameHostDefinition(face, { enableUndo: true }, "zh")

    const running = definition.run({ action: "rename", jsonContent: '{"root":[]}', basePath: "/tmp/沙箱/重命名", dryRun: false }, () => undefined)
    await fake.streamOpened
    expect(fake.starts.map((start) => start.operationId)).toEqual(["op-1"])
    await definition.cancel?.()
    fake.release({ success: false, message: "Node operation cancelled.", data: data() })
    const result = await running

    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call addressed the id this face got back from its own start, and no other run.
    expect(fake.operationPaths).toEqual(["/node-operations/op-1/stream", "/node-operations/op-1/cancel"])
  })

  test("pause and resume hit the same operation id the start returned", async () => {
    const fake = await startFakeHost({ holdStream: true, events: [{ type: "progress", progress: 20, message: "Scanning 画集" }] })
    hosts.push(fake)
    const face = createHost([], fake)
    const definition = createTrenameHostDefinition(face, { enableUndo: true }, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "scan", paths: "/tmp/沙箱/画集" }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.release({ success: true, message: "Scan completed", data: data({ totalItems: 1 }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(messages).toEqual(["Scanning 画集"])
    expect(fake.operationPaths).toEqual([
      "/node-operations/op-1/stream",
      "/node-operations/op-1/pause",
      "/node-operations/op-1/resume",
    ])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startFakeHost({ holdStream: true })
    hosts.push(fake)
    const face = createHost([], fake)
    const definition = createTrenameHostDefinition(face, { enableUndo: true }, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.operationPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  test("the definition still runs on the node's own danger semantics", async () => {
    const fake = await startFakeHost({ holdStream: true })
    hosts.push(fake)
    const face = createHost([], fake)
    const undoPath = "/tmp/沙箱/记录/trename-undo.json"
    const definition = createTrenameHostDefinition(face, { enableUndo: true, undoPath }, "zh")

    // `ui`/`gd` gate on these before `definition.run`; the migration moved the run, not the semantics.
    const live = definition.schema.toInput({ ...definition.schema.initialValues, action: "rename", dryRun: false })
    const preview = definition.schema.toInput({ ...definition.schema.initialValues, action: "rename" })
    expect(definition.schema.isDangerous(live)).toBe(true)
    expect(definition.schema.isDangerous(preview)).toBe(false)
    expect(definition.schema.isDangerous(definition.schema.toInput({ ...definition.schema.initialValues, action: "validate", dryRun: false }))).toBe(false)
    expect(definition.schema.dangerPrompt?.(live)).toEqual({
      title: "确认真实重命名",
      body: "文件将被移动。请先检查路径差异与冲突列表。",
      confirmLabel: "确认移动文件",
    })
    // The undo store from the node config still seeds the schema the session starts from.
    expect(definition.schema.initialValues).toMatchObject({ undoPath, action: "scan", dryRun: true })
    expect(fake.starts.length).toBe(0)
  })
})

/**
 * A face host that attaches to one of the fake hosts above. `XIRANITE_CONFIG_PATH` points at a file that
 * cannot exist unless a test writes one, so a machine's `xiranite.config.toml` cannot leak
 * `[nodes.trename]` values or load hints into the run.
 */
function createHost(
  args: string[],
  attachTo?: { baseUrl: string },
  extraEnv: Record<string, string> = {},
): FaceHost {
  let stdout = ""
  let stderr = ""
  const env: Record<string, string> = {
    // Default: a file that cannot exist, so a machine's `xiranite.config.toml` cannot leak `[nodes.trename]`
    // values or load hints into the run. A test that wants a config passes one through `extraEnv`, which
    // wins over this default.
    XIRANITE_CONFIG_PATH: join(process.cwd(), "artifacts", "test-runs", "trename-missing.toml"),
    XIRANITE_CLI_COLUMNS: "120",
    NO_COLOR: "1",
    ...extraEnv,
  }
  if (attachTo) {
    // Deliberately not spreading process.env: an attach must come from this test, not from the machine.
    env.XIRANITE_BACKEND_URL = attachTo.baseUrl
    env.XIRANITE_BACKEND_TOKEN = HOST_TOKEN
  }
  const host = {
    cwd: process.cwd(),
    env,
    args,
    stdin: { isTTY: false } as unknown as CliHost["stdin"],
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
    pipeStdin(...lines: string[]): void {
      // `readStdinText()` only runs when the stream is non-TTY *and* async iterable, so a run that never
      // pipes keeps the plain object above and a run that pipes reads exactly these bytes.
      host.stdin = {
        isTTY: false,
        async *[Symbol.asyncIterator]() {
          for (const line of lines) yield Buffer.from(`${line}\n`)
        },
      } as unknown as CliHost["stdin"]
    },
  }
  return host as FaceHost
}

type FaceHost = CliHost & {
  args: string[]
  stdoutText(): string
  stderrText(): string
  pipeStdin(...lines: string[]): void
}
