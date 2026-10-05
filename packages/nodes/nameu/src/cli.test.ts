import { afterEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { Readable } from "node:stream"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { CliHost } from "@xiranite/cli-runtime"
import { createNameuHostDefinition, runProgram } from "./cli.js"
import type { NameuData, NameuPlanItem, NameuResult } from "./core.js"

const HOST_TOKEN = "attach-token"
/**
 * A config path that is not there: `loadNodeConfigWithHints` then answers `source: "default"`, so a run in this
 * file cannot inherit `[nodes.nameu]` defaults — or a theme — from the machine that happens to execute it.
 */
const ABSENT_CONFIG_PATH = join(tmpdir(), "xiranite-nameu-face-test", "xiranite.config.toml")

interface RecordedStart {
  nodeId: string
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
}

interface ScriptedHost {
  baseUrl: string
  starts: RecordedStart[]
  /** The control routes the face called, in order. */
  controlPaths: string[]
  /** Resolves when the operation's `/stream` has been opened, so a control call can be made mid-run. */
  streamOpened: Promise<void>
  /** Ends the held-open stream with this result document; a no-op when the host answers immediately. */
  finish(result: NameuResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of these
 * tests is that the face holds no node engine of its own and a mocked transport would not prove that.
 * `crates/xiranite-api/src/routes.rs` is the shape mirrored here (`{ operation }` envelopes, NDJSON frames
 * closed by a `result` frame, the token-free `/health`); nothing in this file proves the host is correct.
 */
async function startScriptedHost(options: {
  result: NameuResult
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** Keeps `/stream` open until `finish()` so cancel, pause and resume can be observed mid-run. */
  hang?: boolean
} = { result: planResult() }): Promise<ScriptedHost> {
  const starts: RecordedStart[] = []
  const controlPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  let sequence = 0
  let resolveOpened!: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  let heldStream: ServerResponse | undefined
  let lastOperationId = "op-unused"

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const requestedPath = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route the Rust host serves without the bearer token, and the face probes it
      // before it asks the operator anything, so a fake that did not answer it would look dead.
      if (requestedPath === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== expectedToken) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && request.url?.startsWith("/nodes/") && requestedPath.endsWith("/operations")) {
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        lastOperationId = operationId
        starts.push({ nodeId: decodeURIComponent(requestedPath.split("/")[2] ?? ""), input, rawBody: body })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const control = /^\/node-operations\/([^/]+)\/(cancel|pause|resume)$/.exec(requestedPath)
      if (control?.[1] && request.method === "POST") {
        controlPaths.push(requestedPath)
        const phase = control[2] === "cancel" ? "cancelled" : control[2] === "pause" ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(control[1], phase) }))
        return
      }

      if (/^\/node-operations\/[^/]+\/stream$/.test(requestedPath)) {
        if (options.hang) {
          heldStream = response
          response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
          response.write(`${JSON.stringify({ type: "operation", operation: record(lastOperationId, "running", { startedAt: 2 }) })}\n`)
          for (const [index, event] of (options.events ?? []).entries()) {
            response.write(`${JSON.stringify({ type: "event", index, event })}\n`)
          }
          resolveOpened()
          return
        }
        const frames = [
          { type: "operation", operation: record(lastOperationId, "running", { startedAt: 2 }) },
          ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
          { type: "result", operation: record(lastOperationId, "completed", { finishedAt: 4, result: options.result }), result: options.result },
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
      if (!heldStream) return
      const operation = { ...record(lastOperationId, "cancelled"), result }
      heldStream.write(`${JSON.stringify({ type: "result", operation, result })}\n`)
      heldStream.end()
      heldStream = undefined
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "nameu", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `data()` defaults, so the face always renders a complete document. */
function data(partial: Partial<NameuData> = {}): NameuData {
  return {
    action: "plan",
    mode: "multi",
    items: [],
    scannedCount: 0,
    readyCount: 0,
    renamedCount: 0,
    unchangedCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    errorCount: 0,
    errors: [],
    ...partial,
  }
}

function item(partial: Partial<NameuPlanItem> = {}): NameuPlanItem {
  return {
    sourcePath: "D:/archives/Artist/Book.zip",
    targetPath: "D:/archives/Artist/Book [Artist].zip",
    sourceName: "Book.zip",
    targetName: "Book [Artist].zip",
    artistName: "Artist",
    kind: "archive",
    status: "ready",
    ...partial,
  }
}

function planResult(items: NameuPlanItem[] = [item()]): NameuResult {
  return {
    success: true,
    message: `NameU planned ${items.length} item(s).`,
    data: data({ action: "plan", items, scannedCount: items.length, readyCount: items.filter((x) => x.status === "ready").length }),
  }
}

const openHosts: ScriptedHost[] = []

async function openHost(...args: Parameters<typeof startScriptedHost>): Promise<ScriptedHost> {
  const host = await startScriptedHost(...args)
  openHosts.push(host)
  return host
}

afterEach(async () => {
  for (const host of openHosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("nameu CLI pipe", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    expect(process.exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("nameu ui")
    // No host was resolved: the refusal happens before the face asks anything of one.
    expect(host.stderrText()).not.toContain("XIRANITE_BACKEND_URL")
  })

  test("runs a plan as a host operation and prints the host's result document", async () => {
    const fake = await openHost({ result: planResult() })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "D:\\资料库\\Artist", "--mode", "single", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as NameuResult
    expect(result.success).toBe(true)
    expect(result.data?.items[0]?.targetName).toBe("Book [Artist].zip")

    // One start call against the nameu route, carrying the node input verbatim: absolute paths and CJK included.
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.nodeId).toBe("nameu")
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", paths: ["D:\\资料库\\Artist"], mode: "single", dryRun: true })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"paths":["D:\\资料库\\Artist"]`)
  })

  test("maps the action words and the negating flags onto the input document", async () => {
    const fake = await openHost({ result: planResult() })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["scan", "D:/a"], host)
    await runProgram(["rename", "D:/a", "--no-recursive", "--no-artist", "--no-folder-normalize", "--no-keep-time", "--json"], host)
    await runProgram(["run", "D:/a", "--dry-run", "--json"], host)

    expect(fake.starts.map((start) => start.input.action)).toEqual(["scan", "rename", "rename"])
    expect(fake.starts[0]?.input).toMatchObject({ dryRun: true })
    expect(fake.starts[1]?.input).toMatchObject({
      dryRun: false,
      recursive: false,
      addArtistName: false,
      normalizeFolders: false,
      keepTimestamp: false,
    })
    // `run` is the old spelling of `rename`, and `--dry-run` keeps it a plan.
    expect(fake.starts[2]?.input).toMatchObject({ action: "rename", dryRun: true })
  })

  test("reads folder paths from stdin for `-` and for a bare piped run", async () => {
    const fake = await openHost({ result: planResult() })
    const dashHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    dashHost.stdin = Readable.from(["D:/one\nD:/two\n"])
    await runProgram(["plan", "-", "--json"], dashHost)

    const pipedHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    pipedHost.stdin = Readable.from(["D:/three\n"])
    await runProgram(["plan", "--json"], pipedHost)

    expect(fake.starts.map((start) => start.input.paths)).toEqual([["D:/one", "D:/two"], ["D:/three"]])
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await openHost({ result: planResult() })
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["plan", "E:/books", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", paths: ["E:/books"] })
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
  })

  test("prints the message and the plan rows without --json, capped at 80 rows", async () => {
    const many = Array.from({ length: 81 }, (_unused, index) => item({ sourcePath: `D:/a/${index}.zip`, sourceName: `${index}.zip` }))
    const fake = await openHost({ result: planResult(many) })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "D:/a"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText()).toContain("NameU planned 81 item(s).")
    const rows = host.stdoutText().split("\n").slice(1).filter(Boolean)
    expect(rows.length).toBe(80)
    expect(rows[0]).toBe("ready\tD:/a/0.zip\t->\tBook [Artist].zip")
    // No config hint belongs on this face's error line.
    expect(host.stderrText()).not.toContain("XIRANITE_BACKEND_URL")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. Running nameu inside this process is exactly
    // what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["plan", "D:/a", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("guided and ui modes refuse before drawing anything when no host is reachable", async () => {
    // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
    const host = asInteractive(createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") }))

    await runProgram(["gd"], host)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")

    const uiHost = asInteractive(createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") }))

    await runProgram(["ui"], uiHost)
    expect(process.exitCode).toBe(1)
    expect(uiHost.stdoutText()).toBe("")
  })

  test("a host result with success:false is exit code 1 and the JSON still lands", async () => {
    const fake = await openHost({
      result: {
        success: false,
        message: "At least one artist folder or library root is required.",
        data: data({ errorCount: 1, items: [item({ status: "error", reason: "no paths" })], errors: ["D:/a: no paths"] }),
      },
    })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as NameuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("library root is required")
    expect(fake.starts.length).toBe(1)
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await openHost({ result: planResult(), token: "other-token" })
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "D:/a", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
  })
})

describe("nameu terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await openHost({ hang: true, result: planResult() })
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createNameuHostDefinition(face, {}, "zh")
    const events: string[] = []

    const running = definition.run({ action: "rename", paths: ["D:/a"], dryRun: false }, (event) => events.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled.", data: data() })
    const result = await running

    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-1/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await openHost({ hang: true, result: planResult() })
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createNameuHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "plan", paths: ["D:/a"] }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish(planResult())
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-1/pause", "/node-operations/op-1/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await openHost({ hang: true, result: planResult() })
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createNameuHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  test("the schema defaults come from the node config, not from a local run", async () => {
    const fake = await openHost({ result: planResult() })
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createNameuHostDefinition(face, { mode: "single", add_artist_name: false, dry_run: true }, "zh")
    const initial = definition.schema.initialValues

    expect(initial).toMatchObject({ mode: "single", addArtistName: false, dryRun: true })
    expect(await definition.run(definition.schema.toInput(initial), () => undefined)).toMatchObject({ success: true })
    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", mode: "single", addArtistName: false, dryRun: true })
  })
})

/** A `CliHost` whose streams and TTY flags a test can flip, plus the buffers it wrote into. */
interface TestHost extends CliHost {
  stdoutText: () => string
  stderrText: () => string
}

function createHost(extraEnv: Record<string, string> = {}): TestHost {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach, and a config file, must come from this test and not
  // from the machine running it.
  return {
    cwd: process.cwd(),
    env: { ...extraEnv, XIRANITE_CONFIG_PATH: ABSENT_CONFIG_PATH, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: { isTTY: false, columns: 120, write(chunk: string) { stdout += chunk; return true } },
    stderr: { isTTY: false, columns: 120, write(chunk: string) { stderr += chunk; return true } },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  } as TestHost
}

/** Makes the host look like an interactive terminal, which is what `ui` and `gd` demand before anything else. */
function asInteractive(host: TestHost): TestHost {
  ;(host.stdin as { isTTY?: boolean }).isTTY = true
  ;(host.stdout as { isTTY?: boolean }).isTTY = true
  return host
}
