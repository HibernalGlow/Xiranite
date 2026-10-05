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
 * The workbench capture spawns the real face in a pty, so after ADR-0074 §5 it needs a host to talk to: the
 * face resolves the host before it opens the screen, and a face with no host stops on one error line. It gets
 * this scripted one over `/operations` rather than the compiled Rust host (bandia is still wave B), because
 * what is captured is the OpenTUI layout and a test must not depend on a host binary or on the machine's
 * attach environment. `/health` is answered token-free because that is the one route `crates/xiranite-api`
 * serves without the bearer token, and it is the probe the face makes.
 */
async function startFakeHost(): Promise<FakeHost> {
  const result = {
    success: true,
    message: "Extract complete: 1 succeeded, 0 failed.",
    data: {
      action: "extract",
      extractedCount: 1,
      compressedCount: 0,
      failedCount: 0,
      totalCount: 1,
      exportedCount: 0,
      pathMappings: [{ archivePath: "D:/in/book.zip", extractedPath: "D:/in/[extract] book" }],
      results: [{ kind: "extract", sourcePath: "D:/in/book.zip", outputPath: "D:/in/[extract] book", success: true, durationMs: 10 }],
    },
  }
  const record = { operationId: "op-visual", nodeId: "bandia", createdAt: 1, updatedAt: 2, eventCount: 0 }

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
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: { ...record, phase: "queued" } }))
        return
      }
      if (/^\/node-operations\/[^/]+\/(stream|cancel|pause|resume)$/.test(path)) {
        const finished = { ...record, phase: "completed", finishedAt: 4, result }
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.end(`${JSON.stringify({ type: "operation", operation: { ...finished, phase: "running" } })}\n${JSON.stringify({ type: "result", operation: finished, result })}\n`)
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
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

describe("bandia OpenTUI visual capture", () => {
  test("captures the archive workbench as ANSI, HTML, and PNG artifacts", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const capture = await captureCliVisual({
      nodeId: "bandia",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "archive-workbench",
      waitForText: "BANDIA // ARCHIVE PIPELINE",
      columns: 142,
      rows: 38,
      viewport: { width: 1136, height: 836 },
      timeoutMs: 15_000,
      // A missing config file keeps the documented defaults (`ui` + opentui + zh) instead of whichever mode
      // the machine running the test happens to have configured.
      env: {
        XIRANITE_BACKEND_URL: fake.baseUrl,
        XIRANITE_BACKEND_TOKEN: HOST_TOKEN,
        XIRANITE_CONFIG_PATH: `${process.cwd()}/artifacts/test-runs/bandia-missing.toml`,
      },
    })

    expect(capture.plainText).toContain("输入队列")
    expect(capture.plainText).toContain("命令舱")
    expect(capture.plainText).toContain("映射输出")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
