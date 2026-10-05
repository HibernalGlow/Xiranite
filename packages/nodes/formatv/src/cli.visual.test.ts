import { afterEach, describe, expect, test } from "vitest"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
const HOST_TOKEN = "visual-token"

/**
 * The OpenTUI capture spawns the real face in a pty, so after ADR-0074 §5 it needs a host to talk to. It gets
 * this one over `/health`, the single route `crates/xiranite-api` serves without the bearer token and the only
 * one the intro screen touches: the face resolves the host *before* it draws, so a capture with no host would
 * freeze on the refusal line instead of the workbench. Nothing here contacts a developer backend.
 */
let healthServer: { close(): Promise<void> } | undefined

async function startHealthOnlyHost(): Promise<string> {
  const server = createServer((request, response) => {
    if ((request.url ?? "").split("?")[0] === "/health") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ status: "ok" }))
      return
    }
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "Node operation not found." }))
  })
  await new Promise<void>((resolveListen) => { server.listen(0, "127.0.0.1", resolveListen) })
  const port = (server.address() as AddressInfo).port
  healthServer = {
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolveClose) => { server.close(() => resolveClose()) })
    },
  }
  return `http://127.0.0.1:${port}`
}

afterEach(async () => {
  const pending = healthServer
  healthServer = undefined
  if (pending) await pending.close()
  process.exitCode = 0
})

describe("FormatV OpenTUI visual capture", () => {
  test("captures media format lab", async () => {
    const baseUrl = await startHealthOnlyHost()
    const capture = await captureCliVisual({
      nodeId: "formatv",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "media-format-lab",
      waitForText: "FORMATV // MEDIA FORMAT LAB",
      columns: 128,
      rows: 32,
      viewport: { width: 1024, height: 720 },
      timeoutMs: 15_000,
      env: { XIRANITE_BACKEND_URL: baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
    })
    expect(capture.plainText).toContain("视频来源")
    expect(capture.plainText).toContain("格式检查")
    expect(capture.plainText).toContain("执行检查")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
