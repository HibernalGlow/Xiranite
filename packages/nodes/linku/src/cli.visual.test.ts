import { afterEach, describe, expect, test } from "vitest"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { captureCliVisual, expectCliVisualArtifacts } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))

/**
 * The guided capture spawns the real face in a pty, so after ADR-0074 §5 it needs a host it can reach: the
 * face resolves the host *before* the first prompt, because a guide that walks the operator through path,
 * target and confirmation and only then reports a dead host spends their attention to deliver a late message.
 * `/health` is answered here — the one route `crates/xiranite-api` serves without the bearer token and the only
 * one the entry screen touches. Nothing here contacts a developer backend.
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

describe("linku guided CLI visual capture", () => {
  test("captures the Clack guided entry screen as ANSI, HTML, and PNG artifacts", async () => {
    const baseUrl = await startHealthOnlyHost()
    const capture = await captureCliVisual({
      nodeId: "linku",
      cliPath: CLI_PATH,
      args: [],
      artifactName: "guided-entry",
      waitForText: "选择 linku 任务",
      env: { XIRANITE_BACKEND_URL: baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN },
    })

    expect(capture.plainText).toContain("Xiranite Linku")
    expect(capture.plainText).toContain("软链接管理工具")
    expect(capture.plainText).toContain("选择 linku 任务")
    expect(capture.plainText).toContain("info")
    expect(capture.plainText).toContain("create")
    expect(capture.plainText).toContain("move-link")
    expect(capture.plainText).toContain("list")
    expect(capture.plainText).toContain("recover")
    expect(capture.plainText).not.toContain("Action: info")
    expect(capture.plainText).not.toContain("linku guided")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)
})
