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
 * The screen under capture is classf's own OpenTUI workbench, which the face now refuses to open before a host
 * is resolved (ADR-0074 §5), so the pty gets this scripted host over `/operations` instead of the compiled Rust
 * one: `classf` is wave B in `docs/migration/face-execution-ledger.md` and a test must not depend on a host
 * binary or on the machine's attach environment. What is captured is layout — panel titles, the action tabs,
 * the classify button — not classification output, which stays in `core.test.ts`. `/health` is answered
 * token-free because that is the one route the host serves without the bearer token, and the face probes it
 * before it renders anything.
 */
async function startFakeHost(): Promise<FakeHost> {
  const server = createServer((request, response) => {
    request.on("data", () => undefined)
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

describe("ClassF OpenTUI visual capture", () => {
  test("captures source list and classification plan", async () => {
    const fake = await startFakeHost()
    hosts.push(fake)
    const capture = await captureCliVisual({
      nodeId: "classf",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "transfer-control",
      waitForText: "CLASSF // TRANSFER CONTROL",
      columns: 128,
      rows: 32,
      viewport: { width: 1024, height: 720 },
      timeoutMs: 15_000,
      env: { XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
    })
    expect(capture.plainText).toContain("来源列表")
    expect(capture.plainText).toContain("分类计划")
    expect(capture.plainText).toContain("执行分类")
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
