import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { DissolvefData, DissolvefResult } from "./core.js"

/**
 * Visual regressions for the pipe face, driven by a scripted host instead of an in-process run:
 * what is under test here is how a result document is laid out (panel titles, plan lines, mode
 * colours), not whether dissolvef computes them — that stays in `core.test.ts`, and the protocol
 * wiring is covered in `cli.test.ts`. `crates/xiranite-api` is still being wired, so these bodies
 * follow `crates/xiranite-core/src/operation/dto.rs`.
 */
const HOST_TOKEN = "visual-token"

interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

async function startFakeHost(options: {
  results: Record<string, DissolvefResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
}): Promise<FakeHost> {
  let sequence = 0
  const byOperation = new Map<string, DissolvefResult>()

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const requestedPath = (request.url ?? "").split("?")[0] ?? ""
      // `/health` carries no bearer token on the real host, and the face probes it before running.
      if (requestedPath === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const target = request.url ?? ""
      const path = target.split("?")[0] ?? target

      if (request.method === "POST" && path.endsWith("/operations")) {
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8")).input as { action?: string }
        const result = options.results[String(input?.action)] ?? { success: false, message: "no scripted result" }
        byOperation.set(operationId, result)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: { operationId, nodeId: "dissolvef", phase: "queued", createdAt: 1, updatedAt: 1, eventCount: 0 } }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      const result = stream?.[1] ? byOperation.get(stream[1]) : undefined
      if (!stream || !result) {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "Node operation not found." }))
        return
      }
      const record = { operationId: stream[1], nodeId: "dissolvef", phase: "completed", createdAt: 1, updatedAt: 4, finishedAt: 4, eventCount: 0, result }
      const frames = [
        { type: "operation", operation: { ...record, phase: "running" } },
        ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
        { type: "result", operation: record, result },
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

function data(partial: Partial<DissolvefData> = {}): DissolvefData {
  return {
    plan: [],
    history: [],
    archivePaths: [],
    nestedCount: 0,
    mediaCount: 0,
    archiveCount: 0,
    directFiles: 0,
    directDirs: 0,
    skippedCount: 0,
    totalCount: 0,
    successCount: 0,
    failedCount: 0,
    errorCount: 0,
    operationId: "",
    errors: [],
    ...partial,
  }
}

function planItem(partial: Partial<DissolvefData["plan"][number]> = {}): DissolvefData["plan"][number] {
  return {
    mode: "nested",
    operation: "move",
    sourcePath: "D:/a/outer/inner",
    targetPath: "D:/a/outer",
    itemKind: "directory",
    status: "planned",
    ...partial,
  } as DissolvefData["plan"][number]
}

const hosts: FakeHost[] = []

// The face reports failure by setting `process.exitCode`, which starts out undefined.
beforeEach(() => {
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("dissolvef CLI visual output", () => {
  test("plan subcommand renders rich summary panel without --json", async () => {
    const host = await attachToHost(
      { plan: { success: true, message: "Plan generated", data: data({ totalCount: 2, plan: [planItem({ mode: "archive", operation: "delete_dir" }), planItem({ mode: "archive", status: "skipped", reason: "blacklisted", targetPath: "" })] }) } },
      [{ type: "log", message: "planning D:/book" }],
    )

    await runProgram(["plan", "--path", "D:/book", "--archive", "--similarityThreshold", "0"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Plan generated")
    expect(stdout).toContain("解散操作总结")
    expect(stdout).toContain("planned")
    expect(stdout).toContain("move")
    expect(stdout).toContain("skipped")
    expect(stdout).toContain("blacklisted")
    expect(stdout).toContain("planning D:/book")
  })

  test("nested subcommand visual output contains summary and operation lines", async () => {
    const host = await attachToHost({
      nested: {
        success: true,
        message: "Dissolve completed",
        data: data({
          nestedCount: 1,
          successCount: 2,
          totalCount: 2,
          operationId: "undo-17",
          plan: [planItem({ status: "success" }), planItem({ mode: "nested", operation: "delete_dir", status: "success", targetPath: "" })],
          history: [{ id: "undo-17", timestamp: "2026-10-05T12:00:00.000Z", mode: "nested", path: "D:/a/outer", count: 2, operations: [], undone: false }],
        }),
      },
    })

    await runProgram(["nested", "--path", "D:/a/outer", "--similarityThreshold", "0"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Dissolve completed")
    expect(stdout).toContain("解散操作总结")
    expect(stdout).toContain("nested")
    expect(stdout).toContain("move")
    // History rows and the undo id are part of the same panel contract.
    expect(stdout).toContain("undo-17")
    expect(stdout).toContain("撤销历史")
  })

  test("archive subcommand visual output marks archive mode", async () => {
    const host = await attachToHost({
      archive: {
        success: true,
        message: "Dissolve completed",
        data: data({ archiveCount: 1, successCount: 1, totalCount: 1, archivePaths: ["D:/a/comic.cbz", "D:/a/bundle.zip"], plan: [planItem({ mode: "archive", status: "success" })] }),
      },
    })

    await runProgram(["archive", "--path", "D:/a", "--similarityThreshold", "0"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Dissolve completed")
    expect(stdout).toContain("解散操作总结")
    expect(stdout).toContain("archive")
    expect(stdout).toContain("已收集到的压缩包路径")
    expect(stdout).toContain("D:/a/bundle.zip")
  })

  test("a failed run renders the error panel and keeps exit code 1", async () => {
    const host = await attachToHost({
      direct: { success: false, message: "Dissolve failed", data: data({ failedCount: 1, errorCount: 1, errors: ["target exists: D:/a/outer"] }) },
    })

    await runProgram(["direct", "--path", "D:/a/outer"], host)

    expect(process.exitCode).toBe(1)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Dissolve failed")
    expect(stdout).toContain("错误")
    expect(stdout).toContain("target exists: D:/a/outer")
  })
})

/** A host attached through the environment, plus the non-TTY face that talks to it. */
async function attachToHost(
  results: Record<string, DissolvefResult>,
  events?: { type: "progress" | "log"; progress?: number; message: string }[],
): Promise<CliHost & { stdoutText: () => string; stderrText: () => string }> {
  const fake = await startFakeHost({ results, events })
  hosts.push(fake)
  return createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
}

function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  return {
    cwd: process.cwd(),
    // Not spreading process.env: an attach must come from this test, not from the machine.
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
