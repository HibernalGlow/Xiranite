import { afterEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"

import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
const HOST_TOKEN = "visual-token"

/**
 * The OpenTUI capture spawns the real face in a pty, so after ADR-0074 §5 it needs a host to talk
 * to. It gets this scripted one over `/operations` rather than the compiled Rust host: what is
 * captured is the workbench layout, and a test must not depend on a host binary or on the
 * machine's attach environment. `/health` is answered token-free because that is the one route
 * `crates/xiranite-api` serves without the bearer token, and the face probes it before it
 * renders anything. The operation routes exist so a stray run cannot hit a 404; the capture
 * itself never confirms an execution.
 */
interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

async function startFakeHost(): Promise<FakeHost> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
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
      const result = { success: true, message: "Recycle cleaner is idle.", data: { timerStatus: "idle", cleanCount: 0, lastCleanTime: null, remainingSeconds: 0 } }
      const record = { operationId: "op-visual", nodeId: "recycleu", phase: "completed", createdAt: 1, updatedAt: 2, eventCount: 0, result }

      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        void JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: { ...record, phase: "queued" } }))
        return
      }
      if (/^\/node-operations\/[^/]+\/stream$/.test(path)) {
        const frames = [
          { type: "operation", operation: { ...record, phase: "running" } },
          { type: "result", operation: record, result },
        ]
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`)
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

const hosts: FakeHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("recycleu OpenTUI visual capture", () => {
  test("captures the fullscreen Chinese control/monitor/log workbench", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const capture = await captureCliVisual({
      nodeId: "recycleu",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "opentui-workbench",
      waitForText: "RECYCLEU // 回收站控制台",
      columns: 120,
      rows: 34,
      viewport: { width: 1440, height: 820 },
      timeoutMs: 12_000,
      env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
    })
    expect(capture.plainText).toContain("清理控制")
    expect(capture.plainText).toContain("循环监控")
    expect(capture.plainText).toContain("日志")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
