import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { MarkuData, MarkuResult } from "./core.js"

/**
 * Visual regressions for the pipe face, driven by a scripted host instead of an in-process run: what is under
 * test here is how a result document is laid out (panel titles, per-file rows, truncation lines, history
 * markers), not whether marku computes them — that stays in `core.test.ts`, and the protocol wiring is covered
 * in `cli.test.ts`.
 *
 * The capture this replaced spawned `cli.ts` in a pseudo-terminal and waited for the hand-written guided
 * screen. `runProgram` has not been able to reach that screen since the shared `ui`/`gd` dispatcher took
 * `guided` over (`bun scripts/audit-face-execution-path.ts` reads the same two files), and after this migration
 * a spawned face would additionally need a host binary, which no CI leg guarantees. The guided wording itself is
 * still owned by `interaction.ts` and rendered by `@xiranite/cli-runtime`.
 */
const HOST_TOKEN = "visual-token"
const MISSING_CONFIG = resolve("artifacts/test-runs/marku-cli-visual-missing-config.toml")

interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

async function startFakeHost(options: {
  results: Record<string, MarkuResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
}): Promise<FakeHost> {
  const byOperation = new Map<string, MarkuResult>()
  const pending = new Map<string, string>()
  let sequence = 0

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` carries no bearer token on the real host, and the face probes it before running.
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
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8")).input as { action?: string }
        const action = String(input?.action)
        byOperation.set(operationId, options.results[action] ?? { success: false, message: "no scripted result", data: data() })
        pending.set(operationId, action)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      const operationId = stream?.[1]
      const result = operationId ? byOperation.get(operationId) : undefined
      if (!operationId || !result) {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "Node operation not found." }))
        return
      }
      const frames = [
        { type: "operation", operation: record(operationId, "running", { startedAt: 2 }) },
        ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
        { type: "result", operation: record(operationId, "completed", { finishedAt: 4, result }), result },
      ]
      response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
      response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`)
    })
  })

  await new Promise<void>((resolveListen) => { server.listen(0, "127.0.0.1", resolveListen) })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
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

const hosts: FakeHost[] = []

beforeEach(() => {
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("marku CLI visual output", () => {
  test("a text run prints the message line and the output panel", async () => {
    const host = await attachToHost({
      text: { success: true, message: "Text processed: changed.", data: data({ filesProcessed: 1, filesChanged: 1, inputText: "# 标题", outputText: "- 标题" }) },
    })

    await runProgram(["text", "--module", "markt", "--input", "# 标题"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Text processed: changed.")
    expect(stdout).toContain("Output")
    expect(stdout).toContain("- 标题")
  })

  test("a file run renders the summary and the per-file rows, then truncates past twenty", async () => {
    const diffs = Array.from({ length: 23 }, (_unused, index) => ({
      file: `D:/笔记/第 ${index + 1} 章.md`,
      changed: index < 3,
      diff: index === 0 ? "--- a/第 1 章.md\n+++ b/第 1 章.md\n@@ -1 +1 @@\n-# A\n+## A" : "",
    }))
    const host = await attachToHost({
      run: { success: true, message: "Processed 23 file(s), 3 changed (dry-run).", data: data({ filesProcessed: 23, filesChanged: 3, diffs }) },
    }, [{ type: "log", message: "Collecting Markdown files." }])

    await runProgram(["run", "--path", "D:/笔记", "--recursive", "--dryRun"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Processed 23 file(s), 3 changed (dry-run).")
    expect(stdout).toContain("files: 23  changed: 3")
    expect(stdout).toContain("changed D:/笔记/第 1 章.md")
    expect(stdout).toContain("same D:/笔记/第 20 章.md")
    // Row 21..23 are behind the truncation line, which is part of the same panel contract.
    expect(stdout).toContain("... 3 more file(s)")
    expect(stdout).not.toContain("第 21 章.md")
    expect(stdout).toContain("Collecting Markdown files.")
  })

  test("history rows mark undone records and the failure path keeps exit code 1", async () => {
    const host = await attachToHost({
      history: {
        success: true,
        message: "Loaded 2 history record(s).",
        data: data({ history: [
          { id: "undo-2", timestamp: "2026-10-06T00:00:00.000Z", module: "markt", summary: "s", files: [{ path: "D:/a.md", content: "A" }], undone: true },
          { id: "undo-1", timestamp: "2026-10-05T00:00:00.000Z", module: "t2list", summary: "s", files: [{ path: "D:/b.md", content: "B" }, { path: "D:/c.md", content: "C" }] },
        ] }),
      },
    })

    await runProgram(["history", "--historyPath", "/tmp/marku.json"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("undo-2 markt 1 file(s)")
    expect(stdout).toContain("undone")
    expect(stdout).toContain("undo-1 t2list 2 file(s)")
    expect(stdout).toContain("active")
  })

  test("a failed run keeps its red line and exit code 1 with the host message", async () => {
    const host = await attachToHost({
      run: { success: false, message: "No Markdown files found.", data: data({ errors: ["No Markdown files found."] }) },
    })

    await runProgram(["run", "--path", "D:/空目录", "--dryRun"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toContain("No Markdown files found.")
  })
})

/** A host attached through the environment, plus the non-TTY face that talks to it. */
async function attachToHost(
  results: Record<string, MarkuResult>,
  events?: { type: "progress" | "log"; progress?: number; message: string }[],
): Promise<CliHost & { stdoutText: () => string; stderrText: () => string }> {
  const fake = await startFakeHost({ results, events })
  hosts.push(fake)
  return createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
}

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Not spreading process.env: an attach must come from this test, not from the machine.
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
