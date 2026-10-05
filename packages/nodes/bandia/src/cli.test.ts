import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { createBandiaHostDefinition, runProgram } from "./cli.js"
import type { BandiaData, BandiaResult } from "./core.js"

const HOST_TOKEN = "attach-token"

interface RecordedStart {
  /** The node id the face addressed, read off the route rather than off the body. */
  nodeId: string
  /** The bandia input document exactly as the face serialised it. */
  input: Record<string, unknown>
  rawBody: string
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  /** `POST …/{cancel,pause,resume}` paths, in the order they arrived. */
  controlPaths: string[]
  /** Resolves once a hanging host has been asked for its operation stream. */
  streamOpened: Promise<void>
  /** Closes a hanging stream with this result document; a no-op when nothing is hanging. */
  finish(result: BandiaResult): void
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own — it used to import `runBandia` and a
 * `BandiaRuntime` and run Bandizip in this process. `crates/xiranite-api` is still being wired for bandia
 * (wave B), so the bodies below follow `nodeOperationSchema`/`nodeRunResultSchema`, the shapes
 * `packages/api/src/operationsClient.ts` mirrors, plus this file's own `data()` mirror of `core.ts`.
 * Nothing here proves the host is correct, and nothing here needs a host binary installed.
 */
async function startFakeHost(options: {
  /** Keyed by the `action` of the input document, the way the face's own router keys it. */
  results?: Record<string, BandiaResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
  /** Keeps the stream open until `finish()`, so mid-run control calls are observable. */
  hang?: boolean
} = {}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const controlPaths: string[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  const operationId = "op-bandia-1"
  const results = options.results ?? {}
  let pending: Record<string, unknown> | undefined
  let streamResponse: ServerResponse | undefined
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })

  const record = (phase: string, extra: Record<string, unknown> = {}) => ({
    operationId,
    nodeId: "bandia",
    phase,
    createdAt: 1,
    updatedAt: 2,
    eventCount: (options.events ?? []).length,
    ...extra,
  })
  const ndjson = (response: ServerResponse, frames: unknown[]): void => {
    response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
    response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`)
  }

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route `crates/xiranite-api` serves without the bearer token, and the face probes
      // it before it asks the operator anything, so a fake that did not answer it would look dead.
      if (path === "/health") {
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

      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        const input = JSON.parse(body).input as Record<string, unknown>
        pending = input
        starts.push({ nodeId: decodeURIComponent(path.split("/")[2] ?? ""), input, rawBody: body })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("queued") }))
        return
      }

      const control = /^\/node-operations\/([^/]+)\/(cancel|pause|resume)$/.exec(path)
      if (control?.[1] && control[2]) {
        controlPaths.push(`/node-operations/${control[1]}/${control[2]}`)
        const phase = control[2] === "cancel" ? "cancelled" : control[2] === "pause" ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(phase) }))
        return
      }

      if (/^\/node-operations\/[^/]+\/stream$/.test(path)) {
        // A hanging host still answers the control calls above and only closes the stream on `finish()`.
        if (options.hang) {
          response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
          response.write(`${JSON.stringify({ type: "operation", operation: record("running", { startedAt: 2 }) })}\n`)
          response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 40, message: "Extracting 1/1" } })}\n`)
          streamResponse = response
          resolveOpened()
          return
        }
        const result = results[String(pending?.action ?? "")] ?? { success: false, message: "no scripted result", data: data() }
        ndjson(response, [
          { type: "operation", operation: record("running", { startedAt: 2 }) },
          ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
          { type: "result", operation: record("completed", { finishedAt: 4, result }), result },
        ])
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
      const response = streamResponse
      streamResponse = undefined
      // The headers went out when the stream hung, so this writes the frame only.
      response.write(`${JSON.stringify({ type: "result", operation: record("completed", { finishedAt: 6, result }), result })}\n`)
      response.end()
    },
    close: async () => {
      // A stream still held open by a failed assertion would otherwise keep this socket from closing.
      streamResponse?.end()
      streamResponse = undefined
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

/** `core.ts`'s `emptyData()` plus the fields a real run fills in, so the face renders a complete document. */
function data(partial: Partial<BandiaData> = {}): BandiaData {
  return {
    action: "extract",
    extractedCount: 0,
    compressedCount: 0,
    failedCount: 0,
    totalCount: 0,
    exportedCount: 0,
    pathMappings: [],
    results: [],
    ...partial,
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
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  process.exitCode = 0
})

describe("bandia CLI", () => {
  test("refuses interactive mode outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("bandia")
  })

  test("posts a dry-run compress as a host operation and prints pure JSON", async () => {
    const fake = await startFakeHost({
      results: {
        compress: {
          success: true,
          message: "Compress complete: 1 succeeded, 0 failed.",
          data: data({
            action: "compress",
            compressedCount: 1,
            totalCount: 1,
            pathMappings: [{ archivePath: "D:/archives/source folder.zip", extractedPath: "D:/in/source folder" }],
            results: [{ kind: "compress", sourcePath: "D:/in/source folder", archivePath: "D:/archives/source folder.zip", success: true, durationMs: 0, skipped: true, command: '"bz.exe" a -y "D:/archives/source folder.zip" "source folder"' }],
          }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram([
      "compress",
      "--path",
      "D:/in/source folder",
      "--outputDir",
      "D:/archives",
      "--dryRun",
      "--json",
    ], host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect(host.stderrText()).toBe("")
    const result = JSON.parse(host.stdoutText()) as BandiaResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("Compress complete: 1 succeeded, 0 failed.")
    expect(result.data?.compressedCount).toBe(1)

    // One start call, addressed at this node by id, carrying the pipe document verbatim: spaces included,
    // no defaults invented in the face and no attach flags leaking into the input.
    expect(fake.starts.map((start) => start.nodeId)).toEqual(["bandia"])
    expect(fake.starts[0]?.input).toMatchObject({
      action: "compress",
      paths: ["D:/in/source folder"],
      outputDir: "D:/archives",
      dryRun: true,
    })
    expect(fake.starts[0]?.input).not.toHaveProperty("workers")
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
  })

  test("renders host events and the summary panel without --json", async () => {
    const fake = await startFakeHost({
      events: [
        { type: "progress", progress: 50, message: "Extracting 1/1" },
        { type: "log", message: "ok book.zip" },
      ],
      results: {
        extract: {
          success: true,
          message: "Extract complete: 1 succeeded, 0 failed.",
          data: data({
            extractedCount: 1,
            totalCount: 1,
            results: [{ kind: "extract", sourcePath: "D:/in/book.zip", outputPath: "D:/in/[extract] book", success: true, durationMs: 12 }],
          }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["extract", "--path", "D:/in/book.zip"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Extract complete: 1 succeeded, 0 failed.")
    expect(stdout).toContain("Summary")
    // The progress bar and the log line both come off the host stream, not off a local run.
    expect(stdout).toContain("Extracting 1/1")
    expect(stdout).toContain("ok book.zip")
    expect(stdout).toContain("D:/in/[extract] book")
    expect(fake.starts[0]?.input).toMatchObject({ action: "extract", paths: ["D:/in/book.zip"] })
  })

  test("hands a mapping file over as mappingText instead of parsing it here", async () => {
    const document = JSON.stringify({ mappings: [{ archivePath: "D:/漫画/a.zip", extractedPath: "D:/漫画/a" }] }, null, 2)
    const dir = await mkdtemp(join(tmpdir(), "bandia-mappings-"))
    tempDirs.push(dir)
    const mappingFile = join(dir, "mappings.json")
    await writeFile(mappingFile, document, "utf8")

    const fake = await startFakeHost({
      results: { repack: { success: true, message: "Repack complete: 1 succeeded, 0 failed.", data: data({ action: "repack", compressedCount: 1, totalCount: 1 }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["repack", "--mappingFile", mappingFile, "--deleteSource", "--json"], host)

    expect(process.exitCode).toBe(0)
    // The node's own `collectMappings()` reads this text — JSON and the `=>`/tab/`|` spellings alike — so the
    // face sends it untouched and holds no parser of its own.
    expect(fake.starts[0]?.input).toMatchObject({ action: "repack", mappingText: document, deleteSource: true })
    expect(fake.starts[0]?.input).not.toHaveProperty("mappings")
    // The CJK paths travelled as the JSON the face wrote, not as a re-encoded or filtered copy of it.
    expect(fake.starts[0]?.rawBody).toContain("漫画/a.zip")
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({
      results: { export_efu: { success: true, message: "Exported 1 path(s) to D:/out.efu.", data: data({ action: "export_efu", exportedCount: 1, totalCount: 1, efuPath: "D:/out.efu" }) } },
    })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["export-efu", "--path", "D:/in/book.zip", "--outputPath", "D:/out.efu", "--open", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({
      action: "export_efu",
      paths: ["D:/in/book.zip"],
      efuOutputPath: "D:/out.efu",
      openInEverything: true,
    })
    const result = JSON.parse(host.stdoutText()) as BandiaResult
    expect(result.data?.efuPath).toBe("D:/out.efu")
  })

  test("reports a host failure as exit code 1 with the host's own result document", async () => {
    const fake = await startFakeHost({
      results: {
        extract: {
          success: false,
          message: "Bandizip executable was not found. Set BANDIZIP_PATH or install Bandizip.",
          data: data({ failedCount: 1, results: [{ kind: "extract", sourcePath: "D:/in/book.zip", success: false, durationMs: 0, error: "bz: not found" }] }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["extract", "--path", "D:/in/book.zip", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as BandiaResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("Bandizip executable was not found")
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { extract: { success: true, message: "Extract complete", data: data() } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["extract", "--path", "D:/in/book.zip", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    // The client names the route and the status, which is how a face tells "wrong token" from "no host".
    expect(host.stderrText()).toContain("/nodes/bandia/operations")
    expect(host.stderrText()).toContain("401")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face owns the host lifecycle (ADR-0074 §6), so the only
    // way this run can fail is a host binary that is not there. The removed compat path ran Bandizip from
    // this process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["extract", "--path", "D:/in/book.zip", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("guided mode refuses before the first prompt when no host can be reached", async () => {
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-host-binary-here") }, true)

    await runProgram(["gd"], host)

    expect(process.exitCode).toBe(1)
    // Nothing was asked: the guide's intro and its first prompt both come after the host is resolved.
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })
})

describe("bandia terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startFakeHost({ hang: true })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createBandiaHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "extract", paths: ["D:/in/book.zip"] }, (event) => messages.push(event.message))
    await fake.streamOpened
    expect(fake.starts[0]?.input).toMatchObject({ action: "extract", paths: ["D:/in/book.zip"] })

    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled.", data: data() })
    const result = await running

    expect(messages).toEqual(["Extracting 1/1"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-bandia-1/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startFakeHost({ hang: true })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createBandiaHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "compress", paths: ["D:/in/a"] }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Compress complete: 1 succeeded, 0 failed.", data: data({ compressedCount: 1 }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-bandia-1/pause", "/node-operations/op-bandia-1/resume"])
    // The started record is released with the run, so a late control call cannot hit another operation.
    await definition.cancel?.()
    expect(fake.controlPaths.length).toBe(2)
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createBandiaHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  test("the configured mappings reach the workbench as mapping text", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createBandiaHostDefinition(
      face,
      { mappings: [{ archivePath: "D:/a.zip", extractedPath: "D:/a" }] },
      "zh",
    )

    expect(definition.schema.fields.find((field) => field.id === "mappingText")).toBeDefined()
    expect(String(definition.schema.initialValues.mappingText)).toContain("D:/a.zip")
  })
})

function createHost(extraEnv: Record<string, string> = {}, tty = false): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine
  // running it, and a missing config file keeps bandia's documented defaults under test.
  return {
    cwd: process.cwd(),
    env: {
      ...extraEnv,
      XIRANITE_CLI_COLUMNS: "120",
      NO_COLOR: "1",
      XIRANITE_CONFIG_PATH: join(process.cwd(), "artifacts", "test-runs", "bandia-missing.toml"),
    },
    // A closed empty pipe: `pipedPathOptions()` treats a non-TTY stdin as piped input and reads it, so a
    // fixture without an async iterator would fail inside citty's `runMain` rather than in this test.
    stdin: emptyPipe(tty) as CliHost["stdin"],
    stdout: {
      isTTY: tty,
      columns: 120,
      write(chunk: string) {
        stdout += chunk
        return true
      },
    },
    stderr: {
      isTTY: tty,
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

/** A stdin that is a finished, empty pipe — what `readStdinLines()` needs to answer `[]` instead of throwing. */
function emptyPipe(tty: boolean): NodeJS.ReadableStream & { isTTY?: boolean } {
  if (tty) return { isTTY: true } as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
  return {
    isTTY: false,
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: true as const, value: undefined }) }
    },
  } as unknown as NodeJS.ReadableStream & { isTTY?: boolean }
}
