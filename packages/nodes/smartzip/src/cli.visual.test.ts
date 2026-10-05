import { afterEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders } from "node:http"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
const HOST_TOKEN = "visual-token"

interface FakeHost {
  baseUrl: string
  close(): Promise<void>
}

/**
 * The host this face attaches to while the workbench renders. ADR-0074 §5 gates the interactive forms
 * behind a resolved host, so the visual capture has to bring one: without it `smartzip ui` answers one
 * attach error line and never draws a frame. Only `/health` is exercised here — the screen is what is
 * under test, and the protocol wiring lives in `cli.test.ts`.
 */
async function startFakeHost(): Promise<FakeHost> {
  const server = createServer((request, response) => {
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
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "Node operation not found." }))
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

let host: FakeHost | undefined

afterEach(async () => {
  await host?.close()
  host = undefined
  process.exitCode = 0
})

describe("SmartZip OpenTUI visual capture", () => {
  test("captures the path queue and operation chamber for GUI comparison", async () => {
    host = await startFakeHost()
    const capture = await captureCliVisual({
      nodeId: "smartzip",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "operation-chamber",
      waitForText: "SMARTZIP // OPERATION CHAMBER",
      columns: 128,
      rows: 32,
      viewport: { width: 1024, height: 720 },
      timeoutMs: 15_000,
      env: { XIRANITE_BACKEND_URL: host.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
    })
    expect(capture.plainText).toContain("路径队列")
    expect(capture.plainText).toContain("Operation chamber")
    expect(capture.plainText).toContain("运行 SmartZip")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
