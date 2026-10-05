import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import type { OperationEvent } from "@xiranite/cli-runtime/backend"
import { createClassqHostDefinition, runProgram } from "./cli.js"
import type { ClassqAction, ClassqData, ClassqResult } from "./core.js"

const HOST_TOKEN = "attach-token"
/** A closed port: nothing can answer `/health` here, so an attach attempt fails the way a dead host does. */
const DEAD_HOST_URL = "http://127.0.0.1:1"

interface RecordedStart {
  /** The id the face put in the route, read off the request rather than off the face's own constant. */
  nodeId: string
  operationId: string
  /** The node input document exactly as the face serialised it. */
  input: Record<string, unknown>
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  /** Control calls this face made, in the order it made them. */
  controls: { action: "pause" | "resume" | "cancel"; operationId: string }[]
  /** Completes a held `/stream` so the face's wait ends with this result. */
  finish(operationId: string, result: ClassqResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own and every run is a protocol call. Nothing
 * here proves the host is correct — the bodies follow `crates/xiranite-api/src/routes.rs` and this file's
 * own mirror of `core.ts`'s `data()`.
 */
async function startFakeHost(options: {
  results: Partial<Record<ClassqAction, ClassqResult>>
  events?: OperationEvent[]
  /** Keeps `/stream` open until `finish()`, which is the only way to catch a run mid-flight. */
  holdStream?: boolean
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const controls: FakeHost["controls"] = []
  const openStreams = new Map<string, { response: ServerResponse; operationId: string }>()
  const scripted = new Map<string, Record<string, unknown>>()
  let sequence = 0

  const resultFor = (input: Record<string, unknown> | undefined): ClassqResult =>
    options.results[String(input?.action ?? "") as ClassqAction] ?? { success: false, message: "no scripted result", data: data() }

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
      if (headers["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const body = Buffer.concat(chunks).toString("utf8")

      const start = /^\/nodes\/([^/]+)\/operations$/.exec(path)
      if (request.method === "POST" && start?.[1]) {
        const operationId = `op-${(sequence += 1)}`
        const input = (JSON.parse(body) as { input: Record<string, unknown> }).input
        starts.push({ nodeId: decodeURIComponent(start[1]), operationId, input })
        scripted.set(operationId, input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const control = /^\/node-operations\/([^/]+)\/(pause|resume|cancel)$/.exec(path)
      if (request.method === "POST" && control?.[1] && control?.[2]) {
        controls.push({ action: control[2], operationId: control[1] })
        const phase = control[2] === "pause" ? "paused" : control[2] === "resume" ? "running" : "cancelled"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(control[1], phase) }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const operationId = stream[1]
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.write(`${JSON.stringify({ type: "operation", operation: record(operationId, "running", { startedAt: 2 }) })}\n`)
        for (const [index, event] of (options.events ?? []).entries()) {
          response.write(`${JSON.stringify({ type: "event", index, event })}\n`)
        }
        const result = resultFor(scripted.get(operationId))
        if (options.holdStream) {
          openStreams.set(operationId, { response, operationId })
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
    controls,
    finish(operationId, result) {
      const open = openStreams.get(operationId)
      if (!open) return
      openStreams.delete(operationId)
      open.response.end(`${JSON.stringify({ type: "result", operation: record(operationId, "completed", { finishedAt: 6, result }), result })}\n`)
    },
    close: async () => {
      // Never leave a face waiting on a stream this test is done with.
      for (const [operationId, open] of openStreams) {
        openStreams.delete(operationId)
        open.response.end()
      }
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "classq", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `data()` defaults, so the face renders a complete document. */
function data(partial: Partial<ClassqData> = {}): ClassqData {
  return {
    action: "plan",
    keyword: "already",
    waitKeyword: "wait",
    transferMode: "move",
    items: [],
    rootCount: 0,
    keywordCount: 0,
    readyCount: 0,
    waitCount: 0,
    movedCount: 0,
    copiedCount: 0,
    conflictCount: 0,
    errorCount: 0,
    errors: [],
    ...partial,
  }
}

function planResult(partial: Partial<ClassqData> = {}): ClassqResult {
  return { success: true, message: "ClassQ planned 2 item(s).", data: data({ rootCount: 1, keywordCount: 1, readyCount: 1, waitCount: 1, ...partial }) }
}

/**
 * The host this face is pointed at. `XIRANITE_CONFIG_PATH` goes to a path that does not exist on purpose:
 * an unset one would resolve to the developer's real `xiranite.config.toml`, whose `[nodes.classq]`
 * section would then leak defaults (`--keyword`, `transfer_mode`, …) into these expected inputs.
 */
function createHost(extraEnv: Record<string, string> = {}, stdin?: unknown): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine
  // running it.
  return {
    cwd: process.cwd(),
    env: { XIRANITE_CONFIG_PATH: join("/tmp", "xiranite-classq-absent-config.toml"), XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1", ...extraEnv },
    stdin: (stdin ?? { isTTY: false }) as CliHost["stdin"],
    stdout: { isTTY: false, columns: 120, write(chunk: string) { stdout += chunk; return true } },
    stderr: { isTTY: false, columns: 120, write(chunk: string) { stderr += chunk; return true } },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}

/** A stdin that yields piped root lines, which is how `classq plan -` takes its roots. */
function pipedStdin(lines: string[]) {
  return {
    isTTY: false,
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield Buffer.from(`${line}\n`)
    },
  }
}

const hosts: FakeHost[] = []
const tempDirs: string[] = []

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
  process.exitCode = 0
})

function track(fake: FakeHost): FakeHost {
  hosts.push(fake)
  return fake
}

/** The attach the faces resolve from, as environment rather than flags. */
function attachedHost(fake: FakeHost, stdin?: unknown) {
  return createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN }, stdin)
}

describe("classq CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("classq")
  })

  test("prints the node's own help card for `help` and starts nothing", async () => {
    const host = createHost()

    await runProgram(["help"], host)

    expect(process.exitCode).toBe(0)
    // `help.ts` is the node's self-authored dictionary and feeds both the terminal `--help` and the
    // in-app card, so its wording is what must not drift here.
    expect(host.stdoutText()).toContain("ClassQ")
    expect(host.stdoutText()).toContain("xiranite classq plan D:/set --keyword already --wait wait")
    expect(host.stdoutText()).toContain("classify D:/set --keyword done --wait wait --transfer copy")
  })

  test("runs a plan as a host operation and prints the result document", async () => {
    const fake = track(await startFakeHost({ results: { plan: planResult() } }))
    const host = attachedHost(fake)

    await runProgram(["plan", "D:/MediaSet", "--keyword", "done", "--wait", "hold", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as ClassqResult
    expect(result.success).toBe(true)
    expect(result.data?.keywordCount).toBe(1)
    // One start call, on this node's route, carrying the input verbatim.
    expect(fake.starts.map((start) => [start.nodeId, start.input.action])).toEqual([["classq", "plan"]])
    expect(fake.starts[0]?.input).toMatchObject({ paths: ["D:/MediaSet"], keyword: "done", waitKeyword: "hold", dryRun: true })
  })

  test("classify stays a dry run unless --apply, and keeps the transfer and existing vocabulary", async () => {
    const fake = track(await startFakeHost({
      results: {
        classify: {
          success: true,
          message: "ClassQ applied 1 transfer(s).",
          data: data({ action: "classify", transferMode: "copy", copiedCount: 1, items: [{ rootPath: "D:/set", parentPath: "D:/set", keywordPath: "D:/set/done", sourcePath: "D:/set/pending.zip", targetPath: "D:/set/wait/pending.zip", sourceName: "pending.zip", targetRelative: "wait/pending.zip", kind: "file", stage: "wait", status: "copied" }] }),
        },
      },
    }))

    await runProgram(["classify", "D:/set", "--transfer", "copy", "--existing", "skip", "--json"], attachedHost(fake))
    // The node's own default: classify without `--apply` must not reach the host as a live transfer.
    expect(fake.starts[0]?.input).toMatchObject({ action: "classify", transferMode: "copy", existingPolicy: "skip", dryRun: true })

    const applied = attachedHost(fake)
    await runProgram(["classify", "D:/set", "--apply"], applied)
    expect(applied.stdoutText()).toContain("ClassQ applied 1 transfer(s).")
    expect(applied.stdoutText()).toContain("copied\twait\tpending.zip")
    // With no flag and no config section the face sends neither key at all — `core.ts`'s own defaults
    // (move / merge) stay the host's business, which is exactly what they were before the migration.
    expect(fake.starts[1]?.input).toMatchObject({ action: "classify", dryRun: false })
    expect(fake.starts[1]?.input).not.toHaveProperty("transferMode")
    expect(fake.starts[1]?.input).not.toHaveProperty("existingPolicy")
  })

  test("reads config defaults into the input the host is given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xiranite-classq-config-"))
    tempDirs.push(dir)
    const configPath = join(dir, "xiranite.config.toml")
    await writeFile(configPath, "[nodes.classq]\nkeyword = \"done\"\nwait_keyword = \"hold\"\ntransfer_mode = \"copy\"\nexisting_policy = \"skip\"\n", "utf8")
    const fake = track(await startFakeHost({ results: { plan: planResult() } }))
    const host = createHost({ XIRANITE_CONFIG_PATH: configPath, XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "D:/set", "--json"], host)

    expect(fake.starts[0]?.input).toMatchObject({ keyword: "done", waitKeyword: "hold", transferMode: "copy", existingPolicy: "skip" })
  })

  test("takes the roots from a piped stdin line list", async () => {
    const fake = track(await startFakeHost({ results: { plan: planResult({ rootCount: 2 }) } }))
    const host = attachedHost(fake, pipedStdin(["D:/one", "D:/two"]))

    await runProgram(["plan", "-"], host)

    expect(fake.starts[0]?.input).toMatchObject({ action: "plan", paths: ["D:/one", "D:/two"] })
    expect(host.stdoutText()).toContain("ClassQ planned 2 item(s).")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = track(await startFakeHost({ results: { plan: planResult() } }))
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["plan", "D:/set", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    const input = fake.starts[0]?.input ?? {}
    expect(input.paths).toEqual(["D:/set"])
    expect(input).not.toHaveProperty("backend")
    expect(input).not.toHaveProperty("token")
    expect(JSON.stringify(input)).not.toContain(HOST_TOKEN)
  })

  test("stops with the attach hint instead of running core in this process", async () => {
    const host = createHost({ XIRANITE_BACKEND_URL: DEAD_HOST_URL, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["plan", "D:/set", "--json"], host)

    expect(process.exitCode).toBe(1)
    // Nothing was written as if it were a classification result — a face with no host prints no result.
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("/health")
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
  })

  test("reports a run the host refused as a failed result, not as a crash", async () => {
    const fake = track(await startFakeHost({ results: {} }))
    const host = attachedHost(fake)

    await runProgram(["classify", "D:/set", "--json"], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    // `classify` had no scripted result, so the host's own unsuccessful document is what prints, and the
    // face still leaves a failing code for it (1) rather than throwing.
    expect(exitCode).toBe(1)
    expect(JSON.parse(host.stdoutText()) as ClassqResult).toMatchObject({ success: false, message: "no scripted result" })
  })

  test("the ui/gd definition forwards the host's events and returns its result document", async () => {
    const fake = track(await startFakeHost({
      results: { plan: planResult() },
      events: [{ type: "progress", progress: 20, message: "Scanning keyword folders." }, { type: "progress", progress: 70, message: "Applying wait-folder transfers." }],
    }))
    const definition = createClassqHostDefinition(attachedHost(fake), { keyword: "already", wait_keyword: "wait" }, "zh")

    const events: OperationEvent[] = []
    const result = await definition.run({ action: "plan", paths: ["D:/set"] }, (event) => events.push(event))

    expect(result.success).toBe(true)
    expect(result.message).toBe("ClassQ planned 2 item(s).")
    expect(fake.starts.map((start) => start.nodeId)).toEqual(["classq"])
    expect(events.map((event) => event.message)).toEqual(["Scanning keyword folders.", "Applying wait-folder transfers."])
    // The operation is finished, so the control calls have nothing left to address.
    await definition.pause?.()
    await definition.resume?.()
    await definition.cancel?.()
    expect(fake.controls).toEqual([])
  })

  test("pause, resume and cancel address the operation this face started", async () => {
    const fake = track(await startFakeHost({ results: { plan: planResult() }, holdStream: true }))
    const definition = createClassqHostDefinition(attachedHost(fake), {}, "zh")

    const wait = definition.run({ action: "plan", paths: ["D:/set"] }, () => undefined)
    // Let the start call land and the stream open, then control it while it is still running.
    for (let attempt = 0; attempt < 50 && fake.starts.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    await definition.pause?.()
    await definition.resume?.()
    await definition.cancel?.()
    const operationId = fake.starts[0]?.operationId
    expect(operationId).toBeDefined()
    fake.finish(operationId ?? "", planResult())

    const result = await wait
    expect(result.success).toBe(true)
    expect(fake.controls).toEqual([
      { action: "pause", operationId: operationId },
      { action: "resume", operationId: operationId },
      { action: "cancel", operationId: operationId },
    ])
  })
})
