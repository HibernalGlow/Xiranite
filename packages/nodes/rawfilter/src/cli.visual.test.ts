import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { runProgram } from "./cli.js"
import type { RawfilterData, RawfilterPlanItem, RawfilterResult } from "./core.js"

/**
 * Visual regressions for the pipe face, driven by a scripted host instead of an in-process run: what is under
 * test here is how a plan document is laid out (summary counters, row colours by destination, truncation, the
 * error panel), not whether rawfilter groups or moves anything — that stays in `core.test.ts`, and the protocol
 * wiring is covered in `cli.test.ts`.
 *
 * The capture this replaced spawned `cli.ts` in a pseudo-terminal and waited for the hand-written guided
 * screen. `runProgram` has not been able to reach that screen since the shared `ui`/`gd` dispatcher took
 * `guided` over, and after this migration a spawned face would additionally need a host binary, which no CI leg
 * guarantees. The guided wording itself is still owned by `interaction.ts` and rendered by
 * `@xiranite/cli-runtime`.
 */
const HOST_TOKEN = "visual-token"
const MISSING_CONFIG = resolve("artifacts/test-runs/rawfilter-cli-visual-missing-config.toml")

interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

async function startFakeHost(options: {
  results: Record<string, RawfilterResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
}): Promise<FakeHost> {
  const byOperation = new Map<string, RawfilterResult>()
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
        byOperation.set(operationId, options.results[String(input?.action)] ?? { success: false, message: "no scripted result", data: data() })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      const result = stream?.[1] ? byOperation.get(stream[1]) : undefined
      if (!stream || !result) {
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
  return { operationId, nodeId: "rawfilter", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** `core.ts`'s `data()` defaults, so the face renders a complete document. */
function data(partial: Partial<RawfilterData> = {}): RawfilterData {
  return {
    archiveCount: 0,
    totalGroups: 0,
    duplicateGroups: 0,
    skippedFiles: 0,
    movedToTrash: 0,
    movedToMulti: 0,
    createdShortcuts: 0,
    keptCount: 0,
    errorCount: 0,
    plan: [],
    groups: [],
    errors: [],
    ...partial,
  }
}

function planItem(partial: Partial<RawfilterPlanItem> = {}): RawfilterPlanItem {
  return {
    groupKey: "game",
    groupLabel: "Game",
    fileName: "Game RAW.rar",
    sourcePath: "D:/归档/Game RAW.rar",
    targetPath: "D:/归档/trash/Game RAW.rar",
    destination: "trash",
    status: "pending",
    variant: "raw",
    reason: "duplicate raw version",
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

describe("rawfilter CLI visual output", () => {
  test("plan renders the counter panel and one row per planned item", async () => {
    const host = await attachToHost({
      plan: {
        success: true,
        message: "Plan generated: 3 operation(s).",
        data: data({
          archiveCount: 4,
          totalGroups: 2,
          duplicateGroups: 1,
          keptCount: 2,
          plan: [
            planItem({ fileName: "Game [Chinese].zip", destination: "keep", status: "kept", targetPath: "", reason: "best translated version" }),
            planItem({ fileName: "Game RAW.rar", destination: "trash", status: "pending" }),
            planItem({ fileName: "Set v2.7z", destination: "multi", status: "pending", targetPath: "D:/归档/multi/Set v2.7z" }),
          ],
        }),
      },
    }, [{ type: "log", message: "grouping 4 archive(s)" }])

    await runProgram(["plan", "--path", "D:/归档", "--minSimilarity", "0.8"], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Plan generated: 3 operation(s).")
    expect(stdout).toContain("archives: 4  groups: 2  duplicate: 1")
    expect(stdout).toContain("kept: 2  trash: 0  multi: 0  shortcut: 0")
    expect(stdout).toContain("grouping 4 archive(s)")
    expect(stdout).toContain("kept keep Game [Chinese].zip / best translated version")
    expect(stdout).toContain("pending trash Game RAW.rar -> D:/归档/trash/Game RAW.rar")
    expect(stdout).toContain("pending multi Set v2.7z -> D:/归档/multi/Set v2.7z")
  })

  test("a long plan is truncated with the count of what is hidden", async () => {
    const plan = Array.from({ length: 90 }, (_unused, index) => planItem({ fileName: `Vol ${index + 1}.zip`, status: "kept", destination: "keep", targetPath: "", reason: "r" }))
    const host = await attachToHost({
      plan: { success: true, message: "Plan generated: 90 operation(s).", data: data({ archiveCount: 90, totalGroups: 90, plan }) },
    })

    await runProgram(["plan", "--path", "D:/归档"], host)

    const stdout = host.stdoutText()
    expect(stdout).toContain("Vol 1.zip")
    expect(stdout).toContain("Vol 80.zip")
    expect(stdout).not.toContain("Vol 81.zip")
    expect(stdout).toContain("... 10 more item(s)")
  })

  test("an executed run shows its destinations and the error panel", async () => {
    const host = await attachToHost({
      execute: {
        success: true,
        message: "Execute completed: 1 moved, 0 skipped.",
        data: data({
          archiveCount: 2,
          totalGroups: 1,
          keptCount: 1,
          movedToTrash: 1,
          errorCount: 1,
          plan: [planItem({ status: "success" }), planItem({ fileName: "Set v2.7z", destination: "shortcut", status: "error", reason: "Access denied: D:/归档/shortcut" })],
          errors: ["Set v2.7z: Access denied: D:/归档/shortcut"],
        }),
      },
    })

    await runProgram(["execute", "--path", "D:/归档"], host)

    const stdout = host.stdoutText()
    expect(stdout).toContain("success trash Game RAW.rar -> D:/归档/trash/Game RAW.rar")
    expect(stdout).toContain("errors: 1  skipped: 0")
    expect(stdout).toContain("Error")
    expect(stdout).toContain("Set v2.7z: Access denied: D:/归档/shortcut")
  })

  test("a failed run keeps exit code 1 and the host's own message", async () => {
    const host = await attachToHost({
      execute: { success: false, message: "Access denied: D:/归档/trash", data: data({ errorCount: 1, errors: ["Access denied: D:/归档/trash"] }) },
    })

    await runProgram(["execute", "--path", "D:/归档"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toContain("Access denied: D:/归档/trash")
  })
})

/** A host attached through the environment, plus the non-TTY face that talks to it. */
async function attachToHost(
  results: Record<string, RawfilterResult>,
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
