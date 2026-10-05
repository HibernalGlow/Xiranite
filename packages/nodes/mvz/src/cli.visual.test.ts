import { afterEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
const HOST_TOKEN = "visual-token"

const hosts: { close(): Promise<void> }[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

/**
 * The guided screen under capture is this node's own flow, which after ADR-0074 §5 resolves a host before it
 * draws the first prompt. It gets this scripted one over `/operations` rather than the compiled Rust host:
 * what is captured is the intro panel and the action list, and a visual test must not depend on a host
 * binary or on the machine's attach environment. `/health` is answered token-free because that is the one
 * route the host serves without the bearer token, and the face probes it first.
 */
async function startFakeHost(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const record = (operationId: string, phase: string) => ({ operationId, nodeId: "mvz", phase, createdAt: 1, updatedAt: 2, eventCount: 0 })
  const result = { success: true, message: "Extraction plan ready", data: { action: "extract", totalFiles: 1, totalArchives: 1, successCount: 1, failedCount: 0, results: [], preview: [] } }
  let sequence = 0
  const byOperation = new Map<string, typeof result>()

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
      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        const operationId = `op-${(sequence += 1)}`
        byOperation.set(operationId, result)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }
      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      const scripted = stream?.[1] ? byOperation.get(stream[1]) : undefined
      if (!stream || !scripted) {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "Node operation not found." }))
        return
      }
      const finished = { ...record(stream[1], "completed"), finishedAt: 4, result: scripted }
      const frames = [
        { type: "operation", operation: { ...finished, phase: "running" } },
        { type: "result", operation: finished, result: scripted },
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

describe("mvz guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const capture = await captureCliVisual({
      nodeId: "mvz",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择要执行的动作",
      env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
    })

    expect(capture.plainText).toContain("Xiranite Mvz")
    expect(capture.plainText).toContain("7-Zip 压缩包内文件操作工具")
    expect(capture.plainText).toContain("选择要执行的动作")
    expect(capture.plainText).toContain("extract")
    expect(capture.plainText).toContain("move")
    expect(capture.plainText).toContain("delete")
    expect(capture.plainText).toContain("rename")
    expect(capture.plainText).toContain("mvz extract --entry archive.zip//file.txt --dry-run --json")
    expect(capture.plainText).not.toContain("Enter path(s)")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
