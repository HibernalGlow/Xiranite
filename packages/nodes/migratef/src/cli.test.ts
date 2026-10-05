import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createMigratefHostDefinition, runProgram } from "./cli.js"
import type { MigratefData, MigratefResult, MigratePlanItem, UndoRecord } from "./core.js"

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
  /** Resolves once a held-open stream has been opened. */
  streamOpened: Promise<void>
  release(result: MigratefResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. `crates/xiranite-api` is still being wired,
 * so the bodies below follow `crates/xiranite-core/src/operation/dto.rs` and this node's own `MigratefData`
 * mirror of `core.ts`; nothing here proves the host is correct.
 *
 * It also deliberately writes no file. A run that really moved something inside a test sandbox would be
 * evidence that the face fell back to `runMigratef()` in this process — the compat path ADR-0074 §5 removes.
 */
async function startFakeHost(options: {
  results?: Record<string, MigratefResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** Keeps the stream open until `release`, so control calls made during a run can be observed. */
  holdStream?: boolean
} = {}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const operationPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  const resultsByOperation = new Map<string, MigratefResult>()
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
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && path.startsWith("/nodes/") && path.endsWith("/operations")) {
        const operationId = `op-${(sequence += 1)}`
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
    release(result: MigratefResult): void {
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
  return { operationId, nodeId: "migratef", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s result defaults, so the face renders a complete document. */
function data(partial: Partial<MigratefData> = {}): MigratefData {
  return {
    plan: [],
    history: [],
    migratedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    totalCount: 0,
    operationId: "",
    successCount: 0,
    failedCount: 0,
    errors: [],
    ...partial,
  }
}

function planItem(partial: Partial<MigratePlanItem> = {}): MigratePlanItem {
  return {
    sourcePath: "/tmp/沙箱/源/一号.txt",
    targetPath: "/tmp/沙箱/目标/一号.txt",
    action: "move",
    kind: "file",
    operation: "transfer",
    status: "pending",
    ...partial,
  }
}

function undoRecord(partial: Partial<UndoRecord> = {}): UndoRecord {
  return {
    id: "batch-7",
    timestamp: "2026-10-06T02:00:00.000Z",
    description: "move 1 item(s)",
    action: "move",
    operations: [{ sourcePath: "/tmp/沙箱/源/一号.txt", targetPath: "/tmp/沙箱/目标/一号.txt", action: "move" }],
    ...partial,
  }
}

const hosts: FakeHost[] = []
const sandboxes: string[] = []

/**
 * The only directories these tests create. The face must not write into any of them — writing is the host's
 * job — and `outsideFile` sits in a sibling directory the input document never names, as a witness that the
 * face did not go looking for a filesystem of its own.
 */
async function createSandbox(): Promise<{ root: string; sourceFile: string; targetDir: string; outsideFile: string }> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-migratef-face-"))
  sandboxes.push(root)
  const sourceDir = join(root, "源")
  const targetDir = join(root, "目标")
  const outsideFile = join(root, "沙箱外", "别碰.txt")
  const sourceFile = join(sourceDir, "一号.txt")
  await mkdir(sourceDir, { recursive: true })
  await mkdir(targetDir, { recursive: true })
  await mkdir(join(root, "沙箱外"), { recursive: true })
  await writeFile(sourceFile, "alpha", "utf8")
  await writeFile(outsideFile, "do not touch", "utf8")
  return { root, sourceFile, targetDir, outsideFile }
}

/** Nothing moved, nothing deleted, nothing written: no node core ran in this process. */
async function expectSandboxUntouched(sandbox: { sourceFile: string; targetDir: string; outsideFile: string }): Promise<void> {
  expect(await readFile(sandbox.sourceFile, "utf8")).toBe("alpha")
  expect(await readdir(sandbox.targetDir)).toEqual([])
  expect(await readFile(sandbox.outsideFile, "utf8")).toBe("do not touch")
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

describe("migratef CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost([])

    await runProgram(host.args, host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("migratef")
    expect(host.stderrText()).toContain("migratef ui")
  })

  test("runs a move as a host operation and prints the result document verbatim", async () => {
    const sandbox = await createSandbox()
    const fake = await startFakeHost({
      results: {
        move: {
          success: true,
          message: "Migration completed",
          data: data({ migratedCount: 1, successCount: 1, totalCount: 1, operationId: "batch-7", plan: [planItem({ status: "success" })] }),
        },
      },
    })
    hosts.push(fake)
    const historyPath = join(sandbox.root, "历史", "migratef.undo.json")
    const host = createHost([
      "move",
      "--source", sandbox.sourceFile,
      "--target", "/Volumes/其他/目标",
      "--mode", "preserve",
      "--historyPath", historyPath,
      "--json",
    ], fake)

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as MigratefResult
    expect(result.success).toBe(true)
    expect(result.data?.migratedCount).toBe(1)

    // Exactly one start call, carrying the node input document verbatim: absolute paths and CJK included.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["move"])
    expect(fake.starts[0]?.input).toMatchObject({
      sourcePaths: [sandbox.sourceFile],
      targetPath: "/Volumes/其他/目标",
      mode: "preserve",
      historyPath,
      dryRun: false,
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"targetPath":"/Volumes/其他/目标"`)
    expect(fake.starts[0]?.rawBody).toContain(`"sourcePaths":["${sandbox.sourceFile}"]`)
    // The move happened only on the host's side of the wire.
    await expectSandboxUntouched(sandbox)
  })

  test("expands stdin for the dash spelling and for a piped run with no source flag", async () => {
    const dash = await startFakeHost({
      results: { plan: { success: true, message: "Plan generated", data: data({ totalCount: 2, plan: [planItem({}), planItem({ targetPath: "/Volumes/其他/二号.txt" })] }) } },
    })
    hosts.push(dash)
    const dashHost = createHost(["plan", "--source", "-", "--target", "/Volumes/其他", "--json"], dash)
    dashHost.pipeStdin("/tmp/沙箱/源/一号.txt", "/tmp/沙箱/源/二号.txt")

    await runProgram(dashHost.args, dashHost)

    expect(process.exitCode).toBe(0)
    expect(dash.starts[0]?.input).toMatchObject({
      action: "plan",
      sourcePaths: ["/tmp/沙箱/源/一号.txt", "/tmp/沙箱/源/二号.txt"],
      targetPath: "/Volumes/其他",
    })

    // No `--source` at all with a non-TTY stdin: the same expansion the legacy in-process run did.
    const piped = await startFakeHost({ results: { plan: { success: true, message: "Plan generated", data: data({ totalCount: 1, plan: [planItem({})] }) } } })
    hosts.push(piped)
    const pipedHost = createHost(["plan", "--target", "/Volumes/其他", "--json"], piped)
    pipedHost.pipeStdin("/tmp/沙箱/源/三号.txt")

    await runProgram(pipedHost.args, pipedHost)

    expect(process.exitCode).toBe(0)
    expect(piped.starts[0]?.input).toMatchObject({ action: "plan", sourcePaths: ["/tmp/沙箱/源/三号.txt"] })
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { plan: { success: true, message: "Plan generated", data: data({ totalCount: 1, plan: [planItem({})] }) } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost(["plan", "--source", "/tmp/沙箱/源/一号.txt", "--target", "/tmp/沙箱/目标", "--json"])
    host.setAttachFlags(fake.baseUrl, HOST_TOKEN)

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    for (const key of ["backend", "token", "channelFile", "channel-file"]) {
      expect(fake.starts[0]?.input).not.toHaveProperty(key)
    }
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", sourcePaths: ["/tmp/沙箱/源/一号.txt"], targetPath: "/tmp/沙箱/目标" })
  })

  test("undo and history are host operations with their own action and history path", async () => {
    const fake = await startFakeHost({
      results: {
        history: { success: true, message: "History loaded", data: data({ history: [undoRecord()], totalCount: 1 }) },
        undo: { success: true, message: "Undo completed", data: data({ successCount: 1, totalCount: 1, history: [undoRecord({ undone: true })] }) },
      },
    })
    hosts.push(fake)
    const historyPath = "/tmp/沙箱/历史/migratef.undo.json"

    const historyHost = createHost(["history", "--historyPath", historyPath, "--json"], fake)
    await runProgram(historyHost.args, historyHost)
    const history = JSON.parse(historyHost.stdoutText()) as MigratefResult
    expect(history.success).toBe(true)
    expect(history.data?.history).toHaveLength(1)

    const undoHost = createHost(["undo", "--historyPath", historyPath, "--batchId", "batch-7", "--json"], fake)
    await runProgram(undoHost.args, undoHost)
    expect((JSON.parse(undoHost.stdoutText()) as MigratefResult).success).toBe(true)

    expect(fake.starts.map((start) => start.input.action)).toEqual(["history", "undo"])
    expect(fake.starts[1]?.input).toMatchObject({ action: "undo", historyPath, batchId: "batch-7" })
  })

  test("renders host events and the summary panel without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 50, message: "planning /tmp/沙箱/源" },
        { type: "log", message: "moving 一号.txt" },
      ],
      results: {
        copy: {
          success: true,
          message: "Migration completed",
          data: data({ migratedCount: 1, successCount: 1, totalCount: 1, operationId: "batch-7", plan: [planItem({ action: "copy", status: "success" })], history: [undoRecord({ action: "copy" })] }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost(["copy", "--source", "/tmp/沙箱/源/一号.txt", "--target", "/tmp/沙箱/目标"], fake)

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Migration completed")
    expect(stdout).toContain("Summary")
    expect(stdout).toContain("moved/copied: 1")
    expect(stdout).toContain("planning /tmp/沙箱/源")
    expect(stdout).toContain("moving 一号.txt")
    expect(stdout).toContain("batch-7")
    expect(stdout).toContain("Undo history:")
  })

  test("keeps a failed host run as a result document with exit code 1", async () => {
    const fake = await startFakeHost({
      results: {
        move: { success: false, message: "Migration failed", data: data({ failedCount: 1, errorCount: 1, errors: ["target exists: /tmp/沙箱/目标/一号.txt"] }) },
      },
    })
    hosts.push(fake)
    const host = createHost(["move", "--source", "/tmp/沙箱/源/一号.txt", "--target", "/tmp/沙箱/目标", "--json"], fake)

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as MigratefResult
    expect(result.success).toBe(false)
    expect(result.data?.errors).toEqual(["target exists: /tmp/沙箱/目标/一号.txt"])
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    const sandbox = await createSandbox()
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path used to run
    // `runMigratef()` in-process here, which is exactly what must not happen any more.
    const host = createHost(["move", "--source", sandbox.sourceFile, "--target", sandbox.targetDir, "--json"], undefined, {
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
    const fake = await startFakeHost({ results: { move: { success: true, message: "Migration completed" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost(["move", "--source", sandbox.sourceFile, "--target", sandbox.targetDir, "--json"], fake)

    await runProgram(host.args, host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("401")
    // The live move did not happen behind the host's back either.
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
      // Nothing was asked: the guide's intro and its first prompt both come after the host is resolved.
      expect(host.stdoutText()).toBe("")
      expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
      process.exitCode = 0
    }
  })
})

describe("migratef terminal definition", () => {
  test("runs on the host and cancels the operation this face started", async () => {
    const fake = await startFakeHost({ holdStream: true })
    hosts.push(fake)
    const face = createHost([], fake)
    const definition = createMigratefHostDefinition(face, "/tmp/沙箱/历史/migratef.undo.json", "zh")

    const running = definition.run({ action: "move", sourcePaths: ["/tmp/沙箱/源/一号.txt"], targetPath: "/tmp/沙箱/目标", dryRun: false }, () => undefined)
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
    const fake = await startFakeHost({ holdStream: true, events: [{ type: "progress", progress: 20, message: "planning /tmp/沙箱/源" }] })
    hosts.push(fake)
    const face = createHost([], fake)
    const definition = createMigratefHostDefinition(face, undefined, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "plan", sourcePaths: ["/tmp/沙箱/源/一号.txt"], targetPath: "/tmp/沙箱/目标" }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.release({ success: true, message: "Plan generated", data: data({ totalCount: 1, plan: [planItem({})] }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(messages).toEqual(["planning /tmp/沙箱/源"])
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
    const definition = createMigratefHostDefinition(face, undefined, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.operationPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  test("the definition still runs on the node's own danger semantics and default vocabulary", async () => {
    const fake = await startFakeHost({ holdStream: true })
    hosts.push(fake)
    const face = createHost([], fake)
    const historyPath = "/tmp/沙箱/历史/migratef.undo.json"
    const definition = createMigratefHostDefinition(face, historyPath, "zh")

    // `ui`/`gd` gate on these before `definition.run`; the migration moved the run, not the semantics.
    // The inputs are seeded from `initialValues` the way the session seeds them.
    const live = definition.schema.toInput({ ...definition.schema.initialValues, action: "move", dryRun: false })
    const preview = definition.schema.toInput({ ...definition.schema.initialValues, action: "move" })
    const undo = definition.schema.toInput({ ...definition.schema.initialValues, action: "undo" })
    expect(definition.schema.isDangerous(live)).toBe(true)
    expect(definition.schema.isDangerous(undo)).toBe(true)
    expect(definition.schema.isDangerous(preview)).toBe(false)
    expect(definition.schema.dangerPrompt?.(live)).toEqual({
      title: "确认真实迁移",
      body: "文件系统将被真实修改。",
      confirmLabel: "确认执行",
    })
    expect(definition.schema.dangerPrompt?.(undo)).toMatchObject({ title: "确认撤销批次" })
    // The config-supplied history path still lands in the schema's starting values, which is what the
    // `ui`/`gd` session seeds `toInput` from, and nothing has been started yet.
    expect(definition.schema.initialValues).toMatchObject({ historyPath, action: "plan", mode: "preserve", maxWorkers: 16, dryRun: true })
    expect(definition.schema.toInput({ ...definition.schema.initialValues, action: "move", dryRun: false })).toMatchObject({
      action: "move",
      historyPath,
      mode: "preserve",
      maxWorkers: 16,
      dryRun: false,
    })
    expect(fake.starts.length).toBe(0)
  })
})

/**
 * A face host that attaches to one of the fake hosts above. `XIRANITE_CONFIG_PATH` points at a file that
 * cannot exist, so a machine's `xiranite.config.toml` cannot leak `[nodes.migratef]` values or hints in.
 */
function createHost(
  args: string[],
  attachTo?: { baseUrl: string },
  extraEnv: Record<string, string> = {},
): FaceHost {
  let stdout = ""
  let stderr = ""
  const env: Record<string, string> = {
    // Default: a file that cannot exist, so a machine's `xiranite.config.toml` cannot leak
    // `[nodes.migratef]` values or hints into the run. A test that wants a config passes one in `extraEnv`.
    XIRANITE_CONFIG_PATH: join(process.cwd(), "artifacts", "test-runs", "migratef-missing.toml"),
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
      // `readStdinLines()` only runs when the stream is non-TTY *and* async iterable, so a run that never
      // pipes keeps the plain object above and a run that pipes reads exactly these lines.
      host.stdin = {
        isTTY: false,
        async *[Symbol.asyncIterator]() {
          for (const line of lines) yield Buffer.from(`${line}\n`)
        },
      } as unknown as CliHost["stdin"]
    },
    setAttachFlags(baseUrl: string, token: string): void {
      host.args = [...host.args, "--backend", baseUrl, "--token", token]
    },
  }
  return host as FaceHost
}

type FaceHost = CliHost & {
  args: string[]
  stdoutText(): string
  stderrText(): string
  pipeStdin(...lines: string[]): void
  setAttachFlags(baseUrl: string, token: string): void
}
