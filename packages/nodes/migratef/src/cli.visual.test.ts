import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders } from "node:http"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { MigratefData, MigratefResult, MigratePlanItem, UndoRecord } from "./core.js"

/**
 * Visual regressions for the pipe face, driven by a scripted host instead of an in-process run: what is
 * under test here is how a result document is laid out (panel titles, plan rows, status colours, undo
 * history rows), not whether migratef computes them — that stays in `core.test.ts`, and the protocol wiring
 * is covered in `cli.test.ts`.
 *
 * This replaces the old `captureCliVisual` PTY capture, which drove the *interactive* guided screen and so
 * could only ever work against a running host and a machine-specific `xiranite.config.toml` default mode.
 * The Clack look itself is `@xiranite/cli-runtime`'s contract, not this node's, and the guided flow is
 * covered by `cli.test.ts` (host refusal) and `Tui.node.test.tsx` (danger gate before the run).
 */
const HOST_TOKEN = "visual-token"

interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

async function startFakeHost(options: {
  results: Record<string, MigratefResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
}): Promise<FakeHost> {
  const expectedResults = options.results
  const resultsByOperation = new Map<string, MigratefResult>()
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

      if (request.method === "POST" && path.startsWith("/nodes/") && path.endsWith("/operations")) {
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8")).input as { action?: string }
        resultsByOperation.set(operationId, expectedResults[String(input?.action)] ?? { success: false, message: "no scripted result" })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      const result = stream?.[1] ? resultsByOperation.get(stream[1]) : undefined
      if (!stream?.[1] || !result) {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "Node operation not found." }))
        return
      }
      const frames = [
        { type: "operation", operation: record(stream[1], "running", { startedAt: 2 }) },
        ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
        { type: "result", operation: record(stream[1], "completed", { finishedAt: 4, result }), result },
      ]
      response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
      response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`)
    })
  })

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "migratef", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

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

beforeEach(() => {
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("migratef CLI visual output", () => {
  test("plan subcommand renders the summary panel with pending rows and the undo id", async () => {
    const host = await attachToHost({
      plan: {
        success: true,
        message: "Plan generated",
        data: data({
          totalCount: 2,
          plan: [
            planItem({ status: "pending" }),
            planItem({ targetPath: "", status: "skipped", reason: "目标已存在", operation: undefined }),
          ],
        }),
      },
    }, [{ type: "log", message: "planning /tmp/沙箱/源" }])

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Plan generated")
    expect(stdout).toContain("Summary")
    expect(stdout).toContain("total: 2")
    expect(stdout).toContain("pending: 1")
    expect(stdout).toContain("pending")
    expect(stdout).toContain("skipped")
    expect(stdout).toContain("目标已存在")
    expect(stdout).toContain("planning /tmp/沙箱/源")
  })

  test("move subcommand marks success rows and lists the undo history", async () => {
    const host = await attachToHost({
      move: {
        success: true,
        message: "Migration completed",
        data: data({
          migratedCount: 1,
          successCount: 1,
          totalCount: 1,
          operationId: "batch-7",
          plan: [planItem({ status: "success" })],
          history: [undoRecord(), undoRecord({ id: "batch-6", undone: true })],
        }),
      },
    })

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Migration completed")
    expect(stdout).toContain("moved/copied: 1")
    expect(stdout).toContain("success")
    expect(stdout).toContain("/tmp/沙箱/源/一号.txt -> /tmp/沙箱/目标/一号.txt")
    expect(stdout).toContain("Undo history:")
    expect(stdout).toContain("batch-7 move 1")
    // The undone flag is its own column, and the row count is the host's, not this process's.
    expect(stdout).toContain("batch-6 move 1 (undone)")
  })

  test("a failed run renders the error panel and keeps exit code 1", async () => {
    const host = await attachToHost({
      copy: {
        success: false,
        message: "Migration failed",
        data: data({ failedCount: 1, errorCount: 1, errors: ["target exists: /tmp/沙箱/目标/一号.txt"] }),
      },
    })

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(1)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Migration failed")
    expect(stdout).toContain("errors: 1")
    expect(stdout).toContain("Error")
    expect(stdout).toContain("target exists: /tmp/沙箱/目标/一号.txt")
  })

  test("--json keeps stdout one clean document even when the run failed", async () => {
    const host = await attachToHost({
      move: { success: false, message: "Migration failed", data: data({ failedCount: 1, errorCount: 1, errors: ["boom"] }) },
    }, [{ type: "progress", progress: 40, message: "moving" }])
    host.args.push("--json")

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(1)
    const parsed = JSON.parse(host.stdoutText()) as MigratefResult
    expect(parsed.message).toBe("Migration failed")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
  })
})

/** A host attached through the environment, plus the non-TTY face that talks to it. */
async function attachToHost(
  results: Record<string, MigratefResult>,
  events?: { type: "progress" | "log"; progress?: number; message: string }[],
): Promise<VisualHost> {
  const fake = await startFakeHost({ results, events })
  hosts.push(fake)
  const action = Object.keys(results)[0] ?? "plan"
  const args = action === "plan"
    ? ["plan", "--source", "/tmp/沙箱/源/一号.txt", "--target", "/tmp/沙箱/目标"]
    : [action, "--source", "/tmp/沙箱/源/一号.txt", "--target", "/tmp/沙箱/目标", "--historyPath", "/tmp/沙箱/历史/migratef.undo.json"]
  return createHost(args, fake.baseUrl)
}

type VisualHost = CliHost & { args: string[]; stdoutText(): string; stderrText(): string }

function createHost(args: string[], baseUrl: string): VisualHost {
  let stdout = ""
  let stderr = ""
  return {
    cwd: process.cwd(),
    // Not spreading process.env: an attach must come from this test, not from the machine.
    env: {
      XIRANITE_BACKEND_URL: baseUrl,
      XIRANITE_BACKEND_TOKEN: HOST_TOKEN,
      XIRANITE_CONFIG_PATH: "/nonexistent/xiranite-migratef-visual.toml",
      XIRANITE_CLI_COLUMNS: "120",
      NO_COLOR: "1",
    },
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
    args,
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}
