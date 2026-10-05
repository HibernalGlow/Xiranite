import { afterEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
const HOST_TOKEN = "visual-token"

interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

/**
 * The guided capture spawns the real face in a pty, so after ADR-0074 §5 it needs a host to talk to: the face
 * resolves the host *before* it asks anything, and a capture without one would only show the attach error.
 * It gets this scripted one over `/operations` rather than the compiled Rust host — what is captured is the
 * shared guide's first screen (the node's own schema), and a test must not depend on a host binary or on the
 * machine's attach environment. `/health` is answered token-free because that is the one route
 * `crates/xiranite-api` serves without the bearer token, and the face probes it first.
 */
async function startFakeHost(): Promise<FakeHost> {
  let sequence = 0
  const byOperation = new Map<string, Record<string, unknown>>()

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
      const result = {
        success: true,
        message: "Preview completed, 1 item(s).",
        data: { mappings: [{ src: "D:/demo/╘bad.txt", dst: "D:/demo/坏名.txt", type: "file", depth: 1 }], matches: [], processed: 0 },
      }
      const record = { nodeId: "encodeb", createdAt: 1, updatedAt: 2, eventCount: 0 }

      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        const operationId = `op-${(sequence += 1)}`
        byOperation.set(operationId, result)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: { ...record, operationId, phase: "queued" } }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      const scripted = stream?.[1] ? byOperation.get(stream[1]) : undefined
      if (!stream || !scripted) {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "Node operation not found." }))
        return
      }
      const finished = { ...record, operationId: stream[1], phase: "completed", finishedAt: 4, result: scripted }
      const frames = [
        { type: "operation", operation: { ...finished, phase: "running" } },
        { type: "event", index: 0, event: { type: "progress", progress: 40, message: "Scanning D:/demo" } },
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

const hosts: FakeHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  process.exitCode = 0
})

describe("encodeb guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const capture = await captureCliVisual({
      nodeId: "encodeb",
      cliPath: CLI_PATH,
      args: ["gd"],
      artifactName: "guided-entry",
      waitForText: "查找乱码",
      env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
    })

    // The guide renders the node's own schema: title, description and the action field's option vocabulary.
    expect(capture.plainText).toContain("EncodeB")
    expect(capture.plainText).toContain("文件名乱码检测")
    expect(capture.plainText).toContain("查找乱码")
    expect(capture.plainText).toContain("预览修复")
    expect(capture.plainText).toContain("执行修复")
    expect(capture.plainText).not.toContain("Recovery task")
    expect(capture.plainText).not.toContain("Enter at least one path.")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
