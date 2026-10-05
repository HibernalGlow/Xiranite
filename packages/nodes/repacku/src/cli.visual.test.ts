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
 * The workbench under capture opens only after this face has a host (ADR-0074 §5), so the capture attaches
 * to this scripted one over `/operations` instead of the compiled Rust host: what is captured is the path
 * matrix and the plan panel, and a visual test must not depend on a host binary or on the machine's attach
 * environment. `/health` is answered token-free because that is the one route the host serves without the
 * bearer token, and the face probes it before it draws the first frame.
 */
async function startFakeHost(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const record = (operationId: string, phase: string) => ({ operationId, nodeId: "repacku", phase, createdAt: 1, updatedAt: 2, eventCount: 0 })
  const result = {
    success: true,
    message: "Compression plan complete: 1 operation(s).",
    data: {
      configPath: "", totalFolders: 1, entireCount: 1, selectiveCount: 0, skipCount: 0, plannedCount: 1,
      compressedCount: 0, failedCount: 0, skippedCount: 0, totalOperations: 1, galleryCount: 0, folderTree: null,
      operations: [{ mode: "entire", sourcePath: "C:/incoming/书", targetPath: "C:/incoming/书.zip", extensions: [".jpg"], fileCount: 1, status: "planned", originalSize: 1024, compressedSize: 0 }],
      errors: [],
    },
  }
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

describe("RepackU OpenTUI visual capture", () => {
  test("captures the packing workbench for GUI comparison", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const capture = await captureCliVisual({
      nodeId: "repacku",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "packing-workbench",
      waitForText: "REPACKU // PACKING WORKBENCH",
      env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
      columns: 128,
      rows: 32,
      viewport: { width: 1024, height: 720 },
      timeoutMs: 15_000,
    })
    expect(capture.plainText).toContain("路径矩阵")
    expect(capture.plainText).toContain("重打包计划")
    expect(capture.plainText).toContain("开始重打包")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
