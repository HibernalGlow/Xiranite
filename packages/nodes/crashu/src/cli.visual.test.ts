import { afterEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
const HOST_TOKEN = "visual-token"

interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

/**
 * The screen under capture is this node's own guided flow, which an operator reaches when the node config keeps
 * `cli.default_mode = "pipe"`. The sandbox pins that instead of inheriting whichever mode the machine running
 * the test happens to have configured.
 */
async function guidedSandbox(): Promise<{ dir: string; configEnv: Record<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-crashu-visual-"))
  await writeFile(join(dir, "xiranite.config.toml"), "[nodes.crashu.cli]\ndefault_mode = \"pipe\"\n", "utf8")
  return { dir, configEnv: { XIRANITE_DATA_DIR: dir } }
}

/**
 * The guided capture spawns the real face in a pty, so after ADR-0074 §5 it needs a host to talk to. It gets
 * this scripted one over `/operations` rather than the compiled Rust host: what is captured is the intro panel
 * and the first prompt, and a test must not depend on a host binary or on the machine's attach environment.
 * `/health` is answered token-free because that is the one route `crates/xiranite-api` serves without the
 * bearer token, and the face probes it before it renders anything.
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
        message: "Scan completed: 1 similar folder(s).",
        data: {
          sourceCount: 1, targetCount: 1, totalScanned: 1, similarFound: 1, movedCount: 0, skippedCount: 0, errorCount: 0,
          pairsFile: "D:/demo/folder_pairs.json",
          similarFolders: [{ name: "蜂蜜作品 [Alt Name]", path: "D:/demo/source/蜂蜜作品 [Alt Name]", target: "Alt Name", similarity: 0.91, matchDim: "token", matchSrc: "蜂蜜作品 alt name", matchTgt: "alt name" }],
          plan: [{ sourcePath: "D:/demo/source/蜂蜜作品 [Alt Name]", targetName: "Alt Name", destinationPath: "D:/demo/destination/Alt Name/蜂蜜作品 [Alt Name]", direction: "to_target", similarity: 0.91, status: "pending", reason: "matched" }],
          errors: [],
        },
      }
      const record = { nodeId: "crashu", createdAt: 1, updatedAt: 2, eventCount: 0 }

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
        { type: "event", index: 0, event: { type: "progress", progress: 40, message: "Scanning source folders." } },
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
const sandboxDirs: string[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  await Promise.all(sandboxDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  process.exitCode = 0
})

describe("crashu guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const sandbox = await guidedSandbox()
    sandboxDirs.push(sandbox.dir)
    const capture = await captureCliVisual({
      nodeId: "crashu",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "留空进入任务选择",
      env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, ...sandbox.configEnv },
    })

    expect(capture.plainText).toContain("Xiranite Crashu")
    expect(capture.plainText).toContain("文件夹相似度检测与批量移动")
    expect(capture.plainText).toContain("auto_dir")
    expect(capture.plainText).toContain("留空进入任务选择")
    expect(capture.plainText).not.toContain("crashu guided")
    expect(capture.plainText).not.toContain("Source directory.")
    expect(capture.plainText).not.toContain("Target directory or target name.")
    expect(capture.plainText).not.toContain("Action: scan or plan.")
    expect(capture.plainText).not.toContain("Press q to exit")
    expect(capture.plainText).not.toContain("Running...")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
