import { afterEach, describe, expect, test } from "vitest"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

/**
 * The guided entry screen draws no results, but the face will not open an interactive flow without a
 * host it can reach (ADR-0074 §5 — a guide that ends after six prompts on a dead host is worse than one
 * that refuses first). So the capture names a host: a `node:http` listener in this test process that
 * answers `/health`, the one route the real host serves without a bearer token and the only one the
 * intro screen touches. Nothing here contacts a developer backend.
 */
const HOST_TOKEN = "visual-token"
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

describe("linedup guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const baseUrl = await startHealthOnlyHost()
    const capture = await captureCliVisual({
      nodeId: "linedup",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择 linedup 工作流",
      env: { XIRANITE_BACKEND_URL: baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
    })

    expect(capture.plainText).toContain("Xiranite Linedup")
    expect(capture.plainText).toContain("当前目录 source.txt + filter.txt -> output.txt")
    expect(capture.plainText).toContain("选择 linedup 工作流")
    expect(capture.plainText).toContain("当前目录约定文件")
    expect(capture.plainText).toContain("剪贴板作为源文本")
    expect(capture.plainText).not.toContain("Entry")
    expect(capture.plainText).not.toContain("Script")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
