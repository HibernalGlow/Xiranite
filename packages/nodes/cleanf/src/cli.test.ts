import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { CliHost } from "@xiranite/cli-runtime"
import { stopSharedHost } from "@xiranite/cli-runtime/backend"
import { createCleanfHostDefinition, runGuided, runProgram, type CleanfGuidedPrompts } from "./cli.js"
import { CLEANF_PRESET_COMBINATIONS } from "./interaction.js"
import type { CleanfData, CleanfResult } from "./core.js"

const HOST_TOKEN = "attach-token"
/** A path that is never written: node config must not leak in from the machine running the test. */
const MISSING_CONFIG = join(tmpdir(), "xiranite-cleanf-cli-missing.toml")

interface RecordedStart {
  /** The route the face chose, i.e. the operation name the host keys the bundle under. */
  route: string
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
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of these
 * tests is that the face holds no node engine of its own. `cleanf` is wave B in
 * `docs/migration/face-execution-ledger.md` (not in the Rust registry yet), so a fake is the only way to assert
 * the wire; the node's own planning stays covered by `core.test.ts`. Bodies follow
 * `crates/xiranite-core/src/operation/dto.rs`; nothing here proves the host is correct.
 */
async function startFakeHost(options: {
  results: Record<string, CleanfResult>
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

      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ route: path, input, rawBody: body })
        pending.set(operationId, input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const result = options.results[scriptKey(pending.get(stream[1]))] ?? { success: false, message: "no scripted result" }
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

/**
 * The cleanf pipe face selects preview vs live with the `preview` flag and carries no `action`, while the
 * `ui`/`gd` schema always sends one; both are scripted by the same key here.
 */
function scriptKey(input: Record<string, unknown> | undefined): string {
  const action = input?.action
  if (typeof action === "string" && action) return action
  return input?.preview === false ? "clean" : "preview"
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "cleanf", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** The fields the face reads off a result document, so a scripted run is a complete one. */
function data(partial: Partial<CleanfData> = {}): CleanfData {
  return { totalRemoved: 0, removedDetails: {}, previewFiles: [], skipped: 0, ...partial }
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

describe("cleanf CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("cleanf ui")
  })

  test("preview is a host operation and the result document is printed as JSON", async () => {
    const fake = await attach({
      preview: {
        success: true,
        message: "Preview completed, found 2 item(s).",
        data: data({ totalRemoved: 2, removedDetails: { backup_files: 1, temp_folders: 1 }, previewFiles: ["/tmp/中文/old.bak", "/tmp/中文/temp_cache"] }),
      },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["preview", "--paths", "/tmp/中文;a;  ", "--presets", "backup_files, temp_folders", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as CleanfResult
    expect(result.success).toBe(true)
    expect(result.data?.totalRemoved).toBe(2)

    // One start call on this node's own route, with the face's own list splitting already applied.
    expect(fake.starts.map((start) => [start.route, start.input.preview])).toEqual([["/nodes/cleanf/operations", true]])
    expect(fake.starts[0]?.input).toMatchObject({
      paths: ["/tmp/中文", "a"],
      presets: ["backup_files", "temp_folders"],
      preview: true,
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"/tmp/中文"`)
  })

  test("run answers with preview off, which is the live recycle-bin path", async () => {
    const fake = await attach({
      clean: {
        success: true,
        message: "Cleanup completed, moved 2 item(s) to the recycle bin.",
        data: data({ totalRemoved: 2, removedDetails: { empty_folders: 2 }, undoAvailable: true, undoBatchCount: 1 }),
      },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["run", "--paths", "/tmp/a", "--exclude", "keep,this", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ paths: ["/tmp/a"], preview: false, exclude: "keep,this" })
    expect(JSON.parse(host.stdoutText()) as CleanfResult).toMatchObject({ success: true })
  })

  test("omits presets when the operator named none, so the host keeps its own defaults", async () => {
    const fake = await attach({ preview: { success: true, message: "Preview completed, found 0 item(s).", data: data() } })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["preview", "--paths", "/tmp/a", "--json"], host)

    // Not `[]`: an empty list would be an explicit "no presets", while omission means "the node's defaults".
    expect(fake.starts[0]?.input).not.toHaveProperty("presets")
  })

  test("undo is a host operation with its own action", async () => {
    const fake = await attach({
      undo: { success: true, message: "Undo completed, restored 2 item(s).", data: data({ restored: 2 }) },
    })
    // Undo has no pipe subcommand (see `help.ts`): the terminal faces reach it through the definition, so the
    // assertion belongs there.
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createCleanfHostDefinition(face, {}, "zh")

    const result = await definition.run({ action: "undo" }, () => undefined)

    expect(process.exitCode).toBe(0)
    expect(result.success).toBe(true)
    expect(fake.starts.map((start) => [start.route, start.input.action])).toEqual([["/nodes/cleanf/operations", "undo"]])
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { preview: { success: true, message: "Preview completed", data: data() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["preview", "--paths", "/tmp/a", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
  })

  test("renders host events and the summary panel without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 40, message: "Scanning /tmp/a" },
        { type: "log", message: "Preview found 1 item(s)." },
      ],
      results: { preview: { success: true, message: "Preview completed, found 1 item(s).", data: data({ totalRemoved: 1, removedDetails: { backup_files: 1 }, previewFiles: ["/tmp/a/old.bak"] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["preview", "--paths", "/tmp/a"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Preview completed, found 1 item(s).")
    expect(stdout).toContain("清理总结")
    expect(stdout).toContain("Preview found 1 item(s).")
    // The summary names the preset (`backup_files` → "Backup files"); the id table is the node's published
    // vocabulary and the face reads it instead of printing bare keys.
    expect(stdout).toContain("Backup files")
    expect(stdout).toContain("/tmp/a/old.bak")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path used to trash files
    // from this process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["preview", "--paths", "/tmp/a", "--json"], host)

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
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("guided mode sends the preset combination the operator actually chose", async () => {
    const fake = await attach({
      preview: { success: true, message: "Preview completed, found 2 item(s).", data: data({ totalRemoved: 2, removedDetails: { backup_files: 1, temp_folders: 1 }, previewFiles: ["/tmp/a/old.bak", "/tmp/a/temp_x"] }) },
      clean: { success: true, message: "Cleanup completed, moved 2 item(s) to the recycle bin.", data: data({ totalRemoved: 2, removedDetails: { backup_files: 2 }, undoAvailable: true, undoBatchCount: 1 }) },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    // The guide refuses without a terminal, so this test claims one; the prompts themselves are scripted below,
    // which is why no keystrokes travel through `host.stdin`.
    ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

    // A folder that really exists: `verifyPaths` is the face's own safety check and stays the real one.
    const folder = await mkdtemp(join(tmpdir(), "xiranite-cleanf-guided-"))
    const questions: string[] = []
    const prompts: CleanfGuidedPrompts = {
      select: async <Value extends string>(_face: CliHost, prompt: string): Promise<Value> => {
        questions.push(prompt)
        // The operator picks a named combination, not the default id list and not a hand-typed id. `complete` is
        // deliberately one that is wider than the enabled defaults, so a picker that ignored the choice (the
        // degraded behaviour this test was written against) cannot pass by answering the default ids.
        if (prompt === "选择路径输入方式") return "manual" as Value
        if (prompt === "选择清理模式") return "preset" as Value
        if (prompt === "选择预设组合") return "complete" as Value
        throw new Error(`unexpected guided question: ${prompt}`)
      },
      text: async () => "",
      confirm: async (_face, prompt) => {
        questions.push(prompt)
        // Both safety confirmations are answered as the guide asks them; undo and the next round are declined.
        return prompt.startsWith("确认开始清理") || prompt.startsWith("确认将以上")
      },
      pathLines: async () => [folder],
      readClipboard: async () => "",
    }

    try {
      await runGuided(host, prompts)
    } finally {
      await stopSharedHost()
      await rm(folder, { recursive: true, force: true })
    }

    const combination = CLEANF_PRESET_COMBINATIONS.find((item) => item.id === "complete")
    expect(combination?.id).toBe("complete")
    expect(combination?.presets).toEqual(expect.arrayContaining(["log_files", "upscale"]))
    expect(questions).toEqual(expect.arrayContaining(["选择清理模式", "选择预设组合"]))
    // Preview first, then the live run — and both carry exactly the combination's preset ids.
    expect(fake.starts.map((start) => [start.route, start.input.preview])).toEqual([
      ["/nodes/cleanf/operations", true],
      ["/nodes/cleanf/operations", false],
    ])
    for (const start of fake.starts) expect(start.input.presets).toEqual(combination?.presets)
    expect(fake.starts.map((start) => start.input.paths)).toEqual([[folder], [folder]])
    // The panel text now comes from the node's published vocabulary: the combination by its name, the presets
    // by theirs, instead of bare ids.
    const stdout = host.stdoutText()
    expect(stdout).toContain("完整清理")
    expect(stdout).toContain("Backup files")
    expect(process.exitCode).toBe(0)
  })

  test("reports a host failure as a non-zero exit instead of a partial success", async () => {
    const fake = await attach({
      preview: { success: false, message: "no node bundle is registered for this host", data: data({ skipped: 1 }) },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["preview", "--paths", "/tmp/a", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(JSON.parse(host.stdoutText()) as CleanfResult).toMatchObject({ success: false })
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { preview: { success: true, message: "Preview completed" } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["preview", "--paths", "/tmp/a", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).not.toBe(0)
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
  finish(result: CleanfResult): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  const controlPaths: string[] = []
  let streamResponse: ServerResponse | undefined

  const server = createServer((request, response) => {
    // The body has to be drained before `end` fires, or a GET without one never reaches this handler at all
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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "Scanning /tmp/a" } })}\n`)
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

describe("cleanf terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createCleanfHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ paths: ["/tmp/a"], preview: true }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(messages).toEqual(["Scanning /tmp/a"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createCleanfHostDefinition(face, {}, "zh")

    const running = definition.run({ paths: ["/tmp/a"], preview: true }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Preview completed, found 0 item(s).", data: data() })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createCleanfHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
  })
})

/** A scripted host plus the handle to it, registered for teardown. */
async function attach(
  results: Record<string, CleanfResult>,
  events?: { type: "progress" | "log"; progress?: number; message: string }[],
): Promise<FakeHost> {
  const fake = await startFakeHost({ results, events })
  hosts.push(fake)
  return fake
}

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine running
  // it, and neither may a real node config decide the preset defaults.
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
