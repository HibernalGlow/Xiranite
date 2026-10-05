import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders } from "node:http"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { TrenameData, TrenameResult } from "./core.js"

/**
 * Visual regressions for the pipe face, driven by a scripted host instead of an in-process run: what is
 * under test here is how a result document is laid out (the Chinese summary panel, the operation rows, the
 * conflict rail, the JSON preview block), not whether trename computes them — that stays in `core.test.ts`,
 * and the protocol wiring is covered in `cli.test.ts`. `crates/xiranite-api` is still being wired, so these
 * bodies follow `crates/xiranite-core/src/operation/dto.rs`.
 */
const HOST_TOKEN = "visual-token"

interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

async function startFakeHost(options: {
  results: Record<string, TrenameResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
}): Promise<FakeHost> {
  const resultsByOperation = new Map<string, TrenameResult>()
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
        resultsByOperation.set(operationId, options.results[String(input?.action)] ?? { success: false, message: "no scripted result" })
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
  return { operationId, nodeId: "trename", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

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

beforeEach(() => {
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("trename CLI visual output", () => {
  test("interactive refusal still mentions the scripted JSON fallback", async () => {
    const host = createHost([])

    await runProgram(host.args, host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("requires an interactive terminal")
    expect(host.stderrText()).toContain("subcommand")
    expect(host.stderrText()).toContain("--json")
  })

  test("scan renders the Chinese summary panel and the JSON preview block", async () => {
    const jsonContent = '{\n  "root": [\n    { "src_dir": "画集" }\n  ]\n}'
    const host = await attachToHost({
      scan: { success: true, message: "Scan completed", data: data({ jsonContent, segments: [jsonContent], totalItems: 3, pendingCount: 2, readyCount: 1, basePath: "/tmp/沙箱" }) },
    }, [{ type: "log", message: "Scanning 画集" }])

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("执行总结")
    expect(stdout).toContain("总计:")
    expect(stdout).toContain("待翻译:")
    expect(stdout).toContain("可重命名:")
    expect(stdout).toContain("基础路径: /tmp/沙箱")
    expect(stdout).toContain("JSON 预览")
    expect(stdout).toContain("画集")
    expect(stdout).toContain("Scanning 画集")
  })

  test("rename dry-run renders the operation rows and the conflict rail", async () => {
    const host = await attachToHost({
      rename: {
        success: true,
        message: "Rename planned",
        data: data({
          successCount: 1,
          skippedCount: 1,
          totalCount: 2,
          operationId: "batch-9",
          operations: [{ originalPath: "/tmp/沙箱/重命名/一号.jpg", newPath: "/tmp/沙箱/重命名/ONE.jpg" }],
          conflicts: [{ type: "target_exists", srcPath: "/tmp/沙箱/重命名/二号.jpg", tgtPath: "/tmp/沙箱/重命名/TWO.jpg", message: "目标已存在: TWO.jpg" }],
        }),
      },
    })

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Rename planned")
    expect(stdout).toContain("执行总结")
    expect(stdout).toContain("成功:")
    expect(stdout).toContain("跳过:")
    expect(stdout).toContain("操作 ID: batch-9")
    expect(stdout).toContain("操作详情")
    expect(stdout).toContain("/tmp/沙箱/重命名/一号.jpg")
    expect(stdout).toContain("冲突详情 (1)")
    expect(stdout).toContain("目标已存在: TWO.jpg")
  })

  test("undo with no batch renders the failed panel and keeps exit code 1", async () => {
    const host = await attachToHost({
      undo: { success: false, message: "No undo batch found", data: data({ failedCount: 1, errors: ["undo store is empty"] }) },
    })
    host.args.push("--undoPath", "/tmp/沙箱/记录/trename-undo.json")

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toContain("执行总结")
    expect(host.stdoutText()).toContain("No undo batch found")
  })

  test("history with no batches renders an empty Chinese summary", async () => {
    const host = await attachToHost({ history: { success: true, message: "History loaded", data: data() } })
    host.args.push("--undoPath", "/tmp/沙箱/记录/trename-undo.json")

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(0)
    expect(host.stdoutText()).toContain("执行总结")
    expect(host.stdoutText()).toContain("History loaded")
  })

  test("--json keeps stdout one clean document even when the run failed", async () => {
    const host = await attachToHost({
      rename: { success: false, message: "Rename failed", data: data({ failedCount: 1, errors: ["boom"] }) },
    }, [{ type: "progress", progress: 40, message: "renaming" }])
    host.args.push("--json")

    await runProgram(host.args, host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    expect((JSON.parse(host.stdoutText()) as TrenameResult).message).toBe("Rename failed")
  })
})

/** A host attached through the environment, plus the non-TTY face that talks to it. */
async function attachToHost(
  results: Record<string, TrenameResult>,
  events?: { type: "progress" | "log"; progress?: number; message: string }[],
): Promise<VisualHost> {
  const fake = await startFakeHost({ results, events })
  hosts.push(fake)
  const action = Object.keys(results)[0] ?? "scan"
  const args = action === "scan"
    ? ["scan", "--path", "/tmp/沙箱/画集"]
    : action === "rename"
      ? ["rename", "--jsonContent", '{"root":[{"src":"一号.jpg","tgt":"ONE.jpg"}]}', "--base", "/tmp/沙箱/重命名"]
      : [action]
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
      XIRANITE_CONFIG_PATH: "/nonexistent/xiranite-trename-visual.toml",
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
