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
 * The OpenTUI capture spawns the real face in a pty, so after ADR-0074 §5 it needs a host to talk to: the face
 * resolves the host before it draws the laboratory. It gets this scripted one over `/operations` rather than
 * the compiled Rust host (bitv is still wave B), because what is captured is the screen layout and a test must
 * not depend on a host binary, on ffprobe, or on the machine's attach environment. `/health` is answered
 * token-free because that is the one route `crates/xiranite-api` serves without the bearer token, and it is the
 * probe the face makes before it renders.
 */
async function startFakeHost(): Promise<FakeHost> {
  const result = {
    success: true,
    message: "Analyzed 1 video file(s).",
    data: {
      action: "analyze",
      ffprobePath: "C:/ffmpeg/bin/ffprobe.exe",
      requestedPaths: ["C:/demo.mp4"],
      videos: [{
        path: "C:/demo.mp4",
        relativePath: "demo.mp4",
        filename: "demo.mp4",
        durationSeconds: 100,
        bitrateBps: 1_000_000,
        bitrateMbps: 1,
        width: 1920,
        height: 1080,
        fps: 30,
        sizeBytes: 12_500_000,
        resolution: "1920x1080",
        bitrateLevel: "5Mbps",
      }],
      stats: { totalVideos: 1, totalSizeBytes: 12_500_000, totalDurationSeconds: 100, averageBitrateMbps: 1, bitrateDistribution: { "5Mbps": 1 } },
      operations: [],
      dryRun: true,
      errors: [],
    },
  }
  const record = { operationId: "op-visual", nodeId: "bitv", createdAt: 1, updatedAt: 2, eventCount: 0 }

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

describe("BitV OpenTUI visual capture", () => {
  test("captures the analysis laboratory for GUI comparison", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const capture = await captureCliVisual({ nodeId: "bitv", cliPath: CLI_PATH, args: ["ui", "--lang", "zh"], artifactName: "analysis-lab", waitForText: "BITV // VIDEO ANALYSIS LAB", columns: 128, rows: 32, viewport: { width: 1024, height: 720 }, timeoutMs: 15_000, env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: `${process.cwd()}/artifacts/test-runs/bitv-missing.toml` } })
    expect(capture.plainText).toContain("视频来源")
    expect(capture.plainText).toContain("码率分析台")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})

