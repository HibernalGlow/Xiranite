import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { stopSharedHost } from "@xiranite/cli-runtime/backend"
import { createFormatvHostDefinition, runProgram } from "./cli.js"
import type { FormatvData, FormatvResult } from "./core.js"

const HOST_TOKEN = "attach-token"
/** `[nodes.formatv.output]` as the operator's own config writes it; see `resolveFormatvDefaults`. */
const CONFIG_BASE = "config_version = 1\n\n"

/** The node input document exactly as the face serialised it, plus the bytes it went out in. */
interface RecordedStart {
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
 * these tests is that this face holds no node engine of its own. `crates/xiranite-api` is still being wired,
 * so the bodies follow `crates/xiranite-core/src/operation/dto.rs` and this file's mirror of `core.ts`'s
 * `FormatvData`; nothing here proves the host is correct.
 */
async function startFakeHost(options: {
  results: Record<string, FormatvResult>
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
      // `/health` is the one route `crates/xiranite-api` serves without the bearer token, and this face
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

      if (request.method === "POST" && /^\/nodes\/formatv\/operations$/.test(path)) {
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
        const result = options.results[String(pending.get(stream[1])?.action ?? "")] ?? unanswered()
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
  return { operationId, nodeId: "formatv", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** The host's own "this action has no scripted answer" document, reported as a failure by the face. */
function unanswered(): FormatvResult {
  return { success: false, message: "formatv action is not answered by this host", data: data({ errors: ["unanswered action"], errorCount: 1 }) }
}

/** `core.ts`'s `data()` defaults, so the face renders a complete document. */
function data(partial: Partial<FormatvData> = {}): FormatvData {
  return {
    normalCount: 0,
    novCount: 0,
    prefixedCounts: {},
    normalFiles: [],
    novFiles: [],
    prefixedFiles: {},
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    duplicates: [],
    prefixedLarger: [],
    operations: [],
    reportPath: "",
    errors: [],
    ...partial,
  }
}

function operation(partial: Partial<FormatvData["operations"][number]> = {}): FormatvData["operations"][number] {
  return { sourcePath: "D:/视频/a.mp4", targetPath: "D:/视频/a.mp4.nov", action: "add_nov", status: "planned", ...partial }
}

const hosts: { close(): Promise<void> }[] = []
const sandboxes: string[] = []

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  await stopSharedHost()
  await Promise.all(sandboxes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  process.exitCode = 0
})

/**
 * A sandbox with real video files in it, under the OS temp dir and deleted in `afterEach`. The files exist so
 * the "the face did not run the node locally" assertions can fail: a rename that happens in this process
 * leaves a `*.nov` behind, and the removed compat path used to do exactly that.
 */
async function createSandbox(name: string): Promise<{ root: string; folder: string; video: string; nov: string; prefixed: string; configPath: string }> {
  const root = await mkdtemp(join(tmpdir(), `xiranite-formatv-face-${name}-`))
  sandboxes.push(root)
  const folder = join(root, "视频库")
  const video = join(folder, "a.mp4")
  const nov = join(folder, "b.mkv.nov")
  const prefixed = join(folder, "[#hb]c.mp4")
  await mkdir(folder, { recursive: true })
  await writeFile(video, "mp4", "utf8")
  await writeFile(nov, "mkv", "utf8")
  await writeFile(prefixed, "prefixed", "utf8")
  const configPath = join(root, "xiranite.config.toml")
  await writeFile(configPath, CONFIG_BASE, "utf8")
  return { root, folder, video, nov, prefixed, configPath }
}

/** Replace the sandbox config with a `[nodes.formatv]` section, so `--json` runs read the operator's own knobs. */
async function writeSandboxConfig(sandbox: { configPath: string }, section: string): Promise<void> {
  await writeFile(sandbox.configPath, `${CONFIG_BASE}${section}`, "utf8")
}

describe("formatv CLI", () => {
  test("refuses guided mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("formatv")
    expect(host.stderrText()).toContain("formatv ui")
  })

  test("runs a scan as a host operation and prints the result document", async () => {
    const sandbox = await createSandbox("scan")
    const fake = await startFakeHost({
      results: {
        scan: {
          success: true,
          message: "Scan completed: 1 normal, 1 .nov.",
          data: data({ normalCount: 1, novCount: 1, prefixedCounts: { hb: 1 }, normalFiles: [sandbox.video], novFiles: [sandbox.nov], prefixedFiles: { hb: [sandbox.prefixed] } }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["scan", "--path", sandbox.folder, "--recursive", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as FormatvResult
    expect(result.message).toBe("Scan completed: 1 normal, 1 .nov.")
    expect(result.data?.normalFiles).toEqual([sandbox.video])
    expect(result.data?.prefixedCounts.hb).toBe(1)

    // One start call, carrying the node input verbatim: the absolute CJK folder and the flag spelling.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["scan"])
    expect(fake.starts[0]?.input).toMatchObject({ paths: [sandbox.folder], recursive: true })
    expect(fake.starts[0]?.rawBody).toContain(JSON.stringify(sandbox.folder))
  })

  test("carries --dryRun into the input document and renames nothing here", async () => {
    const sandbox = await createSandbox("dry-run")
    const fake = await startFakeHost({
      results: {
        add_nov: {
          success: true,
          message: "Add .nov completed: 1 planned, 0 skipped, 0 error(s).",
          data: data({ normalCount: 1, operations: [operation({ sourcePath: sandbox.video, targetPath: `${sandbox.video}.nov` })] }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["add-nov", "--path", sandbox.folder, "--dryRun", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "add_nov", dryRun: true })
    // The plan line came from the host, not from a local rename: the file on disk is still `a.mp4`.
    expect(existsSync(sandbox.video)).toBe(true)
    expect(existsSync(`${sandbox.video}.nov`)).toBe(false)
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const sandbox = await createSandbox("flags")
    const fake = await startFakeHost({
      results: { remove_nov: { success: true, message: "Remove .nov completed: 0 planned, 0 skipped, 0 error(s).", data: data() } },
    })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost({ XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["remove-nov", "--path", sandbox.folder, "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "remove_nov", paths: [sandbox.folder] })
  })

  test("takes the attach from a channel file, and the path never reaches the input", async () => {
    const sandbox = await createSandbox("channel-file")
    const fake = await startFakeHost({
      results: { scan: { success: true, message: "Scan completed: 0 normal, 0 .nov.", data: data() } },
    })
    hosts.push(fake)
    const channelPath = join(sandbox.root, "channel.json")
    await writeFile(channelPath, JSON.stringify({ baseUrl: fake.baseUrl, token: HOST_TOKEN, instanceId: "pid-1" }), "utf8")
    const host = createHost({ XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["scan", "--path", sandbox.folder, "--channel-file", channelPath, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).not.toHaveProperty("channelFile")
    expect(fake.starts[0]?.input).not.toHaveProperty("channel-file")
    expect(fake.starts[0]?.input).toMatchObject({ paths: [sandbox.folder] })
  })

  test("applies the operator's report path and keeps overwrite:false as a dry-run guard", async () => {
    const sandbox = await createSandbox("report-existing")
    await writeSandboxConfig(sandbox, `[nodes.formatv.output]\nreport_name_template = "重复报告-{prefix}.json"\ndirectory = "${tomlString(sandbox.root)}"\noverwrite = false\n`)
    const reportPath = join(sandbox.root, "重复报告-hb.json")
    await writeFile(reportPath, "{}", "utf8")
    const fake = await startFakeHost({
      results: { check_duplicates: { success: true, message: "Duplicate check completed: 0 duplicate(s).", data: data({ reportPath: "" }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["duplicates", "--path", sandbox.folder, "--json"], host)

    // `overwrite = false` plus an existing report means the run must not be asked to write it: the face
    // answers that with `dryRun: true` and no report path, exactly as it did when it ran the node locally.
    expect(fake.starts[0]?.input).toMatchObject({ action: "check_duplicates", dryRun: true })
    expect(fake.starts[0]?.input).not.toHaveProperty("reportPath")
    expect(existsSync(reportPath)).toBe(true)
  })

  test("resolves the report path from config when the operator did not name one", async () => {
    const sandbox = await createSandbox("report-new")
    await writeSandboxConfig(sandbox, `[nodes.formatv.output]\nreport_name_template = "重复报告-{prefix}.json"\ndirectory = "${tomlString(sandbox.root)}"\noverwrite = true\n`)
    const fake = await startFakeHost({
      results: { check_duplicates: { success: true, message: "Duplicate check completed: 1 duplicate(s).", data: data({ duplicateCount: 1, duplicates: [sandbox.video], reportPath: join(sandbox.root, "重复报告-hb.json") }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["duplicates", "--path", sandbox.folder, "--prefix", "hb", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({
      action: "check_duplicates",
      prefixName: "hb",
      reportPath: join(sandbox.root, "重复报告-hb.json"),
    })
  })

  test("leaves an explicit --reportPath alone", async () => {
    const sandbox = await createSandbox("report-explicit")
    await writeSandboxConfig(sandbox, `[nodes.formatv.output]\ndirectory = "${tomlString(sandbox.root)}"\noverwrite = false\n`)
    const explicit = join(sandbox.root, "operator-report.json")
    const fake = await startFakeHost({
      results: { check_duplicates: { success: true, message: "Duplicate check completed: 0 duplicate(s).", data: data({ reportPath: explicit }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["duplicates", "--path", sandbox.folder, "--reportPath", explicit, "--json"], host)

    expect(fake.starts[0]?.input).toMatchObject({ reportPath: explicit })
    expect(fake.starts[0]?.input).not.toHaveProperty("dryRun")
  })

  test("renders host events and the summary panel without --json", async () => {
    const sandbox = await createSandbox("render")
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 40, message: `rename ${sandbox.video}` },
        { type: "log", message: "跳过已存在的目标" },
      ],
      results: {
        add_nov: {
          success: true,
          message: "Add .nov completed: 1 success, 0 skipped, 0 error(s).",
          data: data({
            normalCount: 1,
            novCount: 1,
            prefixedCounts: { hb: 1 },
            successCount: 1,
            operations: [operation({ sourcePath: sandbox.video, targetPath: `${sandbox.video}.nov`, status: "success" })],
            duplicates: ["D:/视频/old.mp4"],
          }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["add-nov", "--path", sandbox.folder], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Add .nov completed")
    expect(stdout).toContain("Summary")
    expect(stdout).toContain("跳过已存在的目标")
    expect(stdout).toContain(sandbox.video)
    expect(stdout).toContain("old.mp4")
    // The prefix bucket is named by the key the host answered with; the display string lives in the node
    // core and is not this face's to keep a second copy of.
    expect(stdout).toContain("前缀")
    expect(stdout).toContain("1 个 hb")
  })

  test("reports an action the host cannot answer as a failure, not as a local run", async () => {
    const sandbox = await createSandbox("unanswered")
    const fake = await startFakeHost({ results: {} })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["add-nov", "--path", sandbox.folder, "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as FormatvResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("not answered by this host")
    expect(existsSync(`${sandbox.video}.nov`)).toBe(false)
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    const sandbox = await createSandbox("no-host")
    // No flags, no environment, no channel file: the face now owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there.
    const host = createHost({ XIRANITE_HOST_BIN: join(sandbox.root, "no-such-xiranite-host"), XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["add-nov", "--path", sandbox.folder, "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
    // The removed compat path ran the node here instead. Nothing was renamed.
    expect(existsSync(sandbox.video)).toBe(true)
    expect(existsSync(`${sandbox.video}.nov`)).toBe(false)
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const sandbox = await createSandbox("wrong-token")
    const fake = await startFakeHost({ results: { add_nov: { success: true, message: "never reached", data: data() } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["add-nov", "--path", sandbox.folder, "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(existsSync(`${sandbox.video}.nov`)).toBe(false)
  })

  test("guided mode refuses before the first prompt when no host can be reached", async () => {
    const sandbox = await createSandbox("guided-refuse")
    const host = createHost({ XIRANITE_HOST_BIN: join(sandbox.root, "no-host-binary-here"), XIRANITE_CONFIG_PATH: sandbox.configPath })
    // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
    ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram(["gd"], host)

    expect(process.exitCode).toBe(1)
    // Nothing was asked: the guide's intro and its first prompt both come after the host is resolved.
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("stdin paths become the input document, not a local folder read", async () => {
    const sandbox = await createSandbox("stdin")
    const fake = await startFakeHost({
      results: { scan: { success: true, message: "Scan completed: 0 normal, 0 .nov.", data: data() } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })
    // `--path -` is the documented stdin spelling; the face reads the line and never lists the folder.
    Object.defineProperty(host.stdin, Symbol.asyncIterator, { value: () => lines([sandbox.folder]) })

    await runProgram(["scan", "--path", "-", "--json"], host)

    expect(process.exitCode).toBe(0)
    // The stdin line is handed to the host verbatim; the duplicate `paths` entry is this CLI's own long-standing
    // merge of `--path` into `--paths`, and the node dedupes it — the face does not read the folder itself.
    const paths = fake.starts[0]?.input.paths as string[]
    expect([...new Set(paths)]).toEqual([sandbox.folder])
    expect(existsSync(`${sandbox.video}.nov`)).toBe(false)
  })
})

describe("formatv terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createFormatvHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "add_nov", paths: ["D:/视频"], dryRun: false }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled." })
    const result = await running

    expect(messages).toEqual(["scanning D:/视频"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createFormatvHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "remove_nov", paths: ["D:/视频"] }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Remove .nov completed: 1 success, 0 skipped, 0 error(s).", data: data({}) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createFormatvHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  /**
   * The danger gate travels with the schema into `ui`/`gd`: the session asks for confirmation because the
   * node's schema still says a live rename is dangerous, and only then calls `run`. A definition that lost
   * the schema would start a host operation straight away.
   */
  test("the host-backed definition keeps the node's rename gate", async () => {
    const fake = await startFakeHost({ results: { add_nov: { success: true, message: "Add .nov completed", data: data() } } })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createFormatvHostDefinition(face, { recursive: true, prefix_name: "hb", dry_run: false }, "zh")

    expect(definition.schema.id).toBe("formatv")
    expect(definition.schema.isDangerous({ action: "add_nov", paths: ["D:/视频"], dryRun: false })).toBe(true)
    expect(definition.schema.isDangerous({ action: "add_nov", paths: ["D:/视频"], dryRun: true })).toBe(false)
    expect(definition.schema.dangerPrompt?.({ action: "remove_nov", paths: [], dryRun: false })?.title).toBe("确认重命名")
    expect(definition.schema.fields.map((field) => field.id)).toEqual(["action", "pathsText", "recursive", "prefixName", "reportPath", "dryRun"])

    await definition.run({ action: "add_nov", paths: ["D:/视频"], dryRun: false }, () => undefined)
    expect(fake.starts.map((start) => start.input.action)).toEqual(["add_nov"])
  })

  test("config defaults reach the rendered schema without a second owner", async () => {
    const fake = await startFakeHost({ results: { scan: { success: true, message: "Scan completed", data: data() } } })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createFormatvHostDefinition(face, { recursive: true, prefix_name: "me", dry_run: false }, "en")

    expect(definition.schema.initialValues).toMatchObject({ recursive: true, prefixName: "me", dryRun: false })
    expect(definition.schema.fields.find((field) => field.id === "action")?.options?.[0]?.label).toBe("Scan")
  })
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui`/`gd` definition
 * makes during a run can be observed.
 */
interface HangingHost {
  baseUrl: string
  starts: RecordedStart[]
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: FormatvResult): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  const controlPaths: string[] = []
  const starts: RecordedStart[] = []
  let streamResponse: ServerResponse | undefined

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      // Token-free on the real host, and this face probes it before it starts an operation.
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
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && /^\/nodes\/formatv\/operations$/.test(path)) {
        starts.push({ input: JSON.parse(body).input as Record<string, unknown>, rawBody: body })
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
      if (path === "/node-operations/op-hang/stream") {
        streamResponse = response
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.write(`${JSON.stringify({ type: "operation", operation: record("op-hang", "running", { startedAt: 2 }) })}\n`)
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "scanning D:/视频" } })}\n`)
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

/** A host attached through the environment, plus the non-TTY face that talks to it. */
function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine
  // running it, and no config file outside the sandbox is read.
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

/** The TOML basic-string spelling of a path, for the sandbox config files. */
function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/** A stdin stand-in for a piped path list; `readStdinLines` consumes it as chunks of text. */
async function* lines(values: string[]): AsyncGenerator<string> {
  for (const value of values) yield `${value}\n`
}
