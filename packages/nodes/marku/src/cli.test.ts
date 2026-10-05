import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Readable } from "node:stream"
import type { CliHost } from "@xiranite/cli-runtime"
import { confirmDangerousRun, createMarkuHostDefinition, runProgram } from "./cli.js"
import { createMarkuInteractionSchema } from "./interaction.js"
import type { MarkuData, MarkuResult } from "./core.js"

const HOST_TOKEN = "attach-token"
/** A config path that cannot exist, so no machine's `xiranite.config.toml` can move these expectations. */
const MISSING_CONFIG = resolve("artifacts/test-runs/marku-cli-missing-config.toml")

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
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because what these tests
 * are for is that the face holds no node engine of its own — the URL, the bearer header and the streamed frames
 * are exactly what a mocked client would hide. `crates/xiranite-api` is still being wired, so the bodies follow
 * `crates/xiranite-core/src/operation/dto.rs` and `core.ts`'s own `data()` mirror; nothing here proves the host
 * is correct.
 */
async function startFakeHost(options: {
  results: Record<string, MarkuResult>
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
  return { operationId, nodeId: "marku", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `data()` defaults, so the face renders a complete document. */
function data(partial: Partial<MarkuData> = {}): MarkuData {
  return {
    filesProcessed: 0,
    filesChanged: 0,
    inputText: "",
    outputText: "",
    diffText: "",
    diffs: [],
    history: [],
    undoId: "",
    errors: [],
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
  const dir = await mkdtemp(join(tmpdir(), "xiranite-marku-fake-host-"))
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

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true })
  process.exitCode = 0
})

describe("marku CLI", () => {
  test("refuses the configured interactive default outside a terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("marku ui")
  })

  test("processes inline markdown text as a host operation and prints the host document", async () => {
    const fake = await startFakeHost({
      results: {
        text: {
          success: true,
          message: "Text processed: changed.",
          data: data({ filesProcessed: 1, filesChanged: 1, inputText: "# 标题\n## 子标题", outputText: "- 标题\n  - 子标题", diffText: "--- a/input.md\n+++ b/input.md\n@@\n-# 标题\n+- 标题" }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["text", "--module", "markt", "--input", "# 标题\n## 子标题", "--config", '{"level_offset":1}', "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.success).toBe(true)
    expect(result.data?.outputText).toBe("- 标题\n  - 子标题")

    // One start call, on marku's own route, carrying the node input verbatim: CJK, newline and parsed config.
    expect(fake.starts.map((start) => start.path)).toEqual(["/nodes/marku/operations"])
    expect(fake.starts.map((start) => start.input.action)).toEqual(["text"])
    expect(fake.starts[0]?.input).toMatchObject({
      module: "markt",
      inputText: "# 标题\n## 子标题",
      stepConfig: { level_offset: 1 },
    })
    expect(fake.starts[0]?.rawBody).toContain(String.raw`"inputText":"# 标题\n## 子标题"`)
  })

  test("reads piped markdown for --input=- without inventing a second parser", async () => {
    const fake = await startFakeHost({ results: { text: { success: true, message: "Text processed: no changes.", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    host.stdin = Readable.from(["# 来自管道\n"]) as unknown as CliHost["stdin"]

    // The `=`-spelling is the one that really carries a dash through citty (`--input -` is parsed as an empty
    // value), so this is the case that proves the explicit-dash branch reads stdin.
    await runProgram(["text", "--module", "content_replace", "--input=-", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "text", module: "content_replace", inputText: "# 来自管道\n" })
    expect(fake.starts[0]?.input).not.toMatchObject({ inputText: "-" })
  })

  test("the loose dash spelling still pipes: citty reads it as an empty value", async () => {
    const fake = await startFakeHost({ results: { text: { success: true, message: "Text processed: no changes.", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    host.stdin = Readable.from(["# 松散的破折号\n"]) as unknown as CliHost["stdin"]

    await runProgram(["text", "--input", "-", "--json"], host)

    expect(fake.starts[0]?.input).toMatchObject({ inputText: "# 松散的破折号\n" })
  })

  test("takes bare piped stdin as the text when no --input was given", async () => {
    const fake = await startFakeHost({ results: { text: { success: true, message: "Text processed: no changes.", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    host.stdin = Readable.from(["piped without a flag\n"]) as unknown as CliHost["stdin"]

    await runProgram(["text", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "text", module: "markt", inputText: "piped without a flag\n" })
  })

  test("an unknown module falls back to markt in the face, exactly as before the host", async () => {
    const fake = await startFakeHost({ results: { text: { success: true, message: "Text processed: no changes.", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["text", "--module", "not_a_module", "--input", "x", "--json"], host)

    expect(fake.starts[0]?.input).toMatchObject({ module: "markt" })
  })

  test("sends a file run with its paths and recursive flag, and renders the host diffs without --json", async () => {
    const fake = await startFakeHost({
      events: [{ type: "progress", progress: 55, message: "第 1 章.md" }],
      results: {
        run: {
          success: true,
          message: "Processed 2 file(s), 1 changed (dry-run).",
          data: data({
            filesProcessed: 2,
            filesChanged: 1,
            diffs: [
              { file: "D:/笔记/第 1 章.md", changed: true, diff: "--- a/第 1 章.md\n+++ b/第 1 章.md\n@@ -1 +1 @@\n-# A\n+## A" },
              { file: "D:/笔记/第 2 章.md", changed: false, diff: "" },
            ],
          }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["run", "--path", "D:/笔记/第 1 章.md", "--paths", "D:/笔记;E:/other", "--recursive", "--dryRun"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({
      action: "run",
      module: "markt",
      paths: ["D:/笔记/第 1 章.md", "D:/笔记", "E:/other"],
      recursive: true,
      dryRun: true,
    })
    const stdout = host.stdoutText()
    expect(stdout).toContain("Processed 2 file(s), 1 changed (dry-run).")
    expect(stdout).toContain("Summary")
    // The diff text is the host's, quoted verbatim into the plan lines: the face adds no diff engine of its own.
    expect(stdout).toContain("changed")
    expect(stdout).toContain("D:/笔记/第 1 章.md")
    expect(stdout).toContain("same")
    expect(stdout).toContain("第 1 章.md")
  })

  test("--write overrides dry-run in the input document", async () => {
    const fake = await startFakeHost({ results: { run: { success: true, message: "Processed 1 file(s), 1 changed.", data: data({ filesProcessed: 1, filesChanged: 1 }) } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["run", "--path", "D:/a/x.md", "--dryRun", "--write", "--json"], host)

    expect(fake.starts[0]?.input).toMatchObject({ action: "run", dryRun: false, enableUndo: true })
  })

  test("a supplied workflow definition travels as a document and its step results come back untouched", async () => {
    const workflow = {
      id: "wf-cli",
      name: "cli pipeline",
      steps: [
        { id: "s1", module: "content_replace", config: { patterns: [{ from: "alpha", to: "beta" }] } },
        { id: "s2", module: "content_replace", config: { patterns: [{ from: "beta", to: "gamma" }] } },
      ],
    }
    const fake = await startFakeHost({
      results: {
        workflow: {
          success: true,
          message: "Workflow processed text: changed.",
          data: data({
            filesProcessed: 1,
            filesChanged: 1,
            inputText: "alpha",
            outputText: "gamma",
            diffText: "--- a/input.md\n+++ b/input.md\n@@ -1 +1 @@\n-alpha\n+gamma",
            workflow: {
              workflowId: "wf-cli",
              workflowName: "cli pipeline",
              stepCount: 2,
              sources: [{
                sourceId: "input.md",
                sourceLabel: "input.md",
                originalText: "alpha",
                outputText: "gamma",
                steps: [
                  { stepId: "s1", module: "content_replace", inputText: "alpha", outputText: "beta", changed: true },
                  { stepId: "s2", module: "content_replace", inputText: "beta", outputText: "gamma", changed: true },
                ],
              }],
            },
          }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["workflow", "--workflow", JSON.stringify(workflow), "--input", "alpha", "--json"], host)

    expect(process.exitCode).toBe(0)
    // The face parses the flag but does not normalise or validate it: the host owns that, and reports the
    // canonical missing/malformed failure itself.
    expect(fake.starts[0]?.input).toEqual({ action: "workflow", module: "markt", paths: [], inputText: "alpha", stepConfig: {}, recursive: undefined, dryRun: undefined, enableUndo: true, historyPath: undefined, undoId: undefined, workflow })
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.data?.workflow?.workflowId).toBe("wf-cli")
    expect(result.data?.workflow?.sources[0]?.steps.map((step) => step.outputText)).toEqual(["beta", "gamma"])
    // The per-step patch is not in the host document, and the face does not fabricate one.
    expect(result.data?.workflow?.sources[0]?.steps[0]).not.toHaveProperty("diff")
  })

  test("reads a workflow JSON file and hands its contents to the host", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xiranite-marku-workflow-"))
    cleanup.push(dir)
    const workflowPath = join(dir, "workflow.json")
    await writeFile(workflowPath, JSON.stringify({ id: "wf-bad", name: "bad", steps: [{ id: "s1", module: "ghost_module", config: {} }] }), "utf8")
    // The host, not the face, answers that the module is unknown.
    const fake = await startFakeHost({
      results: { workflow: { success: false, message: "Workflow step 1 references unknown module: ghost_module", data: data({ errors: ["Workflow step 1 references unknown module: ghost_module"] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["workflow", "--workflowFile", workflowPath, "--input", "alpha", "--json"], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(1)
    expect(fake.starts[0]?.input).toMatchObject({ action: "workflow", workflow: { id: "wf-bad" } })
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("unknown module: ghost_module")
  })

  test("a missing workflow definition stays the host's answer, not a local failure", async () => {
    const fake = await startFakeHost({ results: { workflow: { success: false, message: "Workflow definition is missing or malformed.", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["workflow", "--input", "alpha", "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(fake.starts[0]?.input).toMatchObject({ action: "workflow" })
    expect(fake.starts[0]?.input).not.toHaveProperty("workflow")
    expect((JSON.parse(host.stdoutText()) as MarkuResult).message).toContain("missing or malformed")
  })

  test("takes its module default, history path and named workflow from [nodes.marku]", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xiranite-marku-config-"))
    cleanup.push(dir)
    const configPath = join(dir, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.marku]",
      'default_module = "t2list"',
      'history_path = "/tmp/历史/marku.json"',
      "workflowLibrary = { schemaVersion = 1, workflows = [ { id = \"wf-saved\", name = \"saved pipeline\", steps = [ { id = \"s1\", module = \"content_replace\", config = { from = \"alpha\", to = \"beta\" } } ] } ] }",
      "",
    ].join("\n"), "utf8")
    const fake = await startFakeHost({
      results: {
        text: { success: true, message: "Text processed: no changes.", data: data() },
        workflow: { success: true, message: "Workflow processed text: no changes.", data: data({ workflow: { workflowId: "wf-saved", workflowName: "saved pipeline", stepCount: 1, sources: [] } }) },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_CONFIG_PATH: configPath, XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["text", "--input", "# T", "--json"], host)
    expect(fake.starts[0]?.input).toMatchObject({ module: "t2list", historyPath: "/tmp/历史/marku.json" })

    // `--name` is this face's lookup in the operator's own library; the definition it finds is handed over as a
    // document, and the host normalises, validates and runs it.
    const named = createHost({ XIRANITE_CONFIG_PATH: configPath, XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    await runProgram(["workflow", "--name", "saved pipeline", "--input", "alpha", "--json"], named)
    expect(fake.starts[1]?.input).toMatchObject({
      action: "workflow",
      module: "t2list",
      workflow: { id: "wf-saved", name: "saved pipeline", steps: [{ id: "s1", module: "content_replace", config: { from: "alpha", to: "beta" } }] },
    })
    expect((JSON.parse(named.stdoutText()) as MarkuResult).data?.workflow?.workflowId).toBe("wf-saved")
  })

  test("history and undo are host operations addressed by the record id", async () => {
    const fake = await startFakeHost({
      results: {
        history: { success: true, message: "Loaded 1 history record(s).", data: data({ history: [{ id: "undo-9", timestamp: "2026-10-06T00:00:00.000Z", module: "markt", summary: "marku markt: 2 file(s)", files: [{ path: "D:/笔记/a.md", content: "# A" }, { path: "D:/笔记/b.md", content: "# B" }], undone: false }] }) },
        undo: { success: true, message: "Undo completed: 2 file(s).", data: data({ undoId: "undo-9" }) },
      },
    })
    hosts.push(fake)
    const historyHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const undoHost = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["history", "--historyPath", "/tmp/历史/marku.json", "--json"], historyHost)
    await runProgram(["undo", "--undoId", "undo-9", "--historyPath", "/tmp/历史/marku.json", "--json"], undoHost)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.map((start) => start.input.action)).toEqual(["history", "undo"])
    expect(fake.starts[0]?.input).toMatchObject({ historyPath: "/tmp/历史/marku.json" })
    expect(fake.starts[1]?.input).toMatchObject({ undoId: "undo-9", historyPath: "/tmp/历史/marku.json" })
    const history = JSON.parse(historyHost.stdoutText()) as MarkuResult
    expect(history.data?.history[0]?.id).toBe("undo-9")
    const undo = JSON.parse(undoHost.stdoutText()) as MarkuResult
    expect(undo.data?.undoId).toBe("undo-9")
    // The history row the host returned is what the non-JSON face prints.
    const rendered = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    await runProgram(["history", "--historyPath", "/tmp/历史/marku.json"], rendered)
    expect(rendered.stdoutText()).toContain("Undo history:")
    expect(rendered.stdoutText()).toContain("undo-9 markt 2 file(s)")
  })

  test("writes the host output text to --outputFile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xiranite-marku-output-"))
    cleanup.push(dir)
    const inputFile = join(dir, "input.md")
    const outputFile = join(dir, "output.md")
    await writeFile(inputFile, "# Messy    Title\n", "utf8")
    const fake = await startFakeHost({
      results: { text: { success: true, message: "Text processed: changed.", data: data({ filesChanged: 1, inputText: "# Messy    Title\n", outputText: "# Messy Title\n" }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["text", "--module", "title_convert", "--inputFile", inputFile, "--outputFile", outputFile], host)

    expect(process.exitCode).toBe(0)
    expect(await readFile(outputFile, "utf8")).toBe("# Messy Title\n")
    expect(host.stdoutText()).toContain("Text processed: changed.")
    // The input file is read by the face and handed over as text; the host never sees a path it must open.
    expect(fake.starts[0]?.input).toMatchObject({ module: "title_convert", inputText: "# Messy    Title\n" })
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const fake = await startFakeHost({ results: { text: { success: true, message: "Text processed: no changes.", data: data() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost()

    await runProgram(["text", "--input", "# T", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "text", inputText: "# T" })
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    // No flags, no environment, no channel file: the face now owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there. The removed compat path used to run
    // `runMarku()` in-process here, which is exactly what must not happen any more.
    const host = createHost({ XIRANITE_HOST_BIN: join(tmpdir(), "no-such-xiranite-host") })

    await runProgram(["text", "--module", "markt", "--input", "# T", "--json"], host)

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
    const fake = await startFakeHost({ results: { text: { success: true, message: "Text processed: changed.", data: data({ outputText: "- T" }) } } })
    hosts.push(fake)
    const { binary, pidFile } = await fakeHostScript(fake.baseUrl, HOST_TOKEN)

    // One bare command line: no `--backend`, no `XIRANITE_BACKEND_URL`, no channel file.
    const host = createHost({ XIRANITE_HOST_BIN: binary, XIRANITE_FAKE_HOST_PID_FILE: pidFile })
    await runProgram(["text", "--input", "# T", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect((JSON.parse(host.stdoutText()) as MarkuResult).message).toBe("Text processed: changed.")
    expect(fake.starts.map((start) => start.input.action)).toEqual(["text"])

    const pid = Number(readFileSync(pidFile, "utf8").trim())
    expect(Number.isInteger(pid) && pid > 0).toBe(true)
    // Control for the liveness gauge: this process is obviously alive, so the `no such process` below is a
    // claim about the child and not about `process.kill` being broken here.
    expect(() => process.kill(process.pid, 0)).not.toThrow()
    // ADR-0074 §5: the host this face started belongs to this invocation, so `runProgram` stopped it.
    expect(() => process.kill(pid, 0)).toThrow(/no such process|ESRCH/)
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const fake = await startFakeHost({ results: { text: { success: true, message: "Text processed: changed." } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["text", "--input", "# T", "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(host.stdoutText()).toBe("")
    expect(process.exitCode).toBe(1)
    expect(host.stderrText()).toContain("401")
  })

  test("reports a host failure as a non-zero exit instead of a partial success", async () => {
    const fake = await startFakeHost({
      results: { run: { success: false, message: "No Markdown files found.", data: data({ errors: ["No Markdown files found."] }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })

    await runProgram(["run", "--path", "D:/a", "--dryRun", "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as MarkuResult
    expect(result.success).toBe(false)
    expect(result.message).toBe("No Markdown files found.")
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

describe("marku write gate", () => {
  test("a live file write is confirmed with the node's own danger wording before anything is sent", async () => {
    const fake = await startFakeHost({ results: { run: { success: true, message: "Processed 1 file(s), 1 changed.", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const schema = createMarkuInteractionSchema({}, "zh")
    const asked: { message: string; defaultValue: boolean }[] = []

    const confirmed = await confirmDangerousRun(host, schema, { action: "run", module: "markt", paths: ["D:/a.md"], dryRun: false }, async (message, defaultValue) => {
      asked.push({ message, defaultValue })
      return false
    })

    expect(confirmed).toBe(false)
    // The operator was asked once, with the node's published wording, and the answer defaulted to "no".
    expect(asked).toEqual([{ message: "确认执行", defaultValue: false }])
    expect(host.stdoutText()).toContain("该操作会修改磁盘中的 Markdown 文件。")
    // Refused before the run: the host never saw an operation.
    expect(fake.starts.length).toBe(0)
  })

  test("an accepted undo confirms with the node's wording and still sends nothing itself", async () => {
    const fake = await startFakeHost({ results: { undo: { success: true, message: "Undo completed: 2 file(s).", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const schema = createMarkuInteractionSchema({}, "zh")

    const confirmed = await confirmDangerousRun(host, schema, { action: "undo", undoId: "undo-1" }, async () => true)

    expect(confirmed).toBe(true)
    // The gate is a gate: only the caller's run may start an operation, so an accepted confirm alone posts
    // nothing to the host.
    expect(fake.starts.length).toBe(0)
    // Refusing the undo reads as a cancelled session, not as a failed run.
    const cancelled = await confirmDangerousRun(host, schema, { action: "undo", undoId: "undo-1" }, async () => false)
    expect(cancelled).toBe(false)
    expect(host.stdoutText()).toContain("操作已取消。")
    expect(fake.starts.length).toBe(0)
  })

  test("a dry-run or a text run asks nothing, because nothing is written", async () => {
    const host = createHost()
    const schema = createMarkuInteractionSchema({}, "zh")
    let asked = 0
    const confirm = async (): Promise<boolean> => {
      asked += 1
      return false
    }

    expect(await confirmDangerousRun(host, schema, { action: "run", module: "markt", paths: ["D:/a.md"], dryRun: true }, confirm)).toBe(true)
    expect(await confirmDangerousRun(host, schema, { action: "text", module: "markt", inputText: "# T" }, confirm)).toBe(true)
    expect(asked).toBe(0)
    expect(host.stdoutText()).toBe("")
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
  finish(result: MarkuResult): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolvePromise) => { resolveOpened = resolvePromise })
  const controlPaths: string[] = []
  let streamResponse: import("node:http").ServerResponse | undefined

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
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "Collecting Markdown files." } })}\n`)
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

describe("marku terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createMarkuHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "run", module: "markt", paths: ["D:/a"] }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled.", data: data() })
    const result = await running

    expect(messages).toEqual(["Collecting Markdown files."])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createMarkuHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "run", module: "markt", paths: ["D:/a"] }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Processed 1 file(s), 0 changed.", data: data({ filesProcessed: 1 }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createMarkuHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
  })

  test("the definition defaults come from the node config, not from a second list", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createMarkuHostDefinition(face, { default_module: "t2list", history_path: "/tmp/历史/marku.json", enable_undo: false }, "zh")

    expect(definition.schema.initialValues.module).toBe("t2list")
    expect(definition.schema.initialValues.historyPath).toBe("/tmp/历史/marku.json")
    expect(definition.schema.initialValues.enableUndo).toBe(false)
    // An unknown configured module must not leak into the schema: `markt` stays the default.
    expect(createMarkuHostDefinition(face, { default_module: "ghost" }, "zh").schema.initialValues.module).toBe("markt")
  })
})

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine running
  // it. The config path defaults to a file that cannot exist, so no user `[nodes.marku]` block can move a
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
