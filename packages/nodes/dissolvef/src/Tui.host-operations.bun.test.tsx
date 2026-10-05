/* @jsxImportSource @opentui/react */
/**
 * The TUI face runs dissolvef on the host, not in this process (ADR-0074 §5).
 *
 * `Tui.bun.test.tsx` proves the screen with a stubbed `definition.run`; `cli.test.ts` proves the
 * host-backed definition over HTTP. This file closes the gap between them: the *production* screen
 * component is given the *production* definition factory (`createDissolvefHostDefinition`) and a
 * scripted host that answers like `crates/xiranite-api`, so the path from a mouse click on
 * `execute` to `POST /nodes/dissolvef/operations` and back into the plan panel is covered in one
 * piece. The host is a real `node:http` listener for the same reason it is one in `cli.test.ts`:
 * the attach and the body encodings only count if they survive an actual round trip.
 */
import { createServer, type Server } from "node:http"
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "bun:test"
import { act } from "react"
import type { CliHost } from "@xiranite/cli-runtime"
import { createDissolvefHostDefinition } from "./cli.js"
import type { DissolvefData } from "./core.js"
import { DissolvefTui } from "./Tui.js"

const TOKEN = "tui-host-token"
const SOURCE = "/workspace/album/2026/one/pic.jpg"

/** The result document a completed plan operation answers with, shaped by `nodeRunResultSchema`. */
function planResult(): { success: boolean; message: string; data: DissolvefData } {
  const data: DissolvefData = {
    plan: [
      {
        mode: "nested",
        operation: "move",
        sourcePath: SOURCE,
        targetPath: "/workspace/album/2026/pic.jpg",
        itemKind: "file",
        status: "pending",
        similarity: 1,
      },
    ],
    history: [],
    archivePaths: [],
    nestedCount: 0,
    mediaCount: 0,
    archiveCount: 0,
    directFiles: 0,
    directDirs: 0,
    skippedCount: 0,
    totalCount: 1,
    successCount: 1,
    failedCount: 0,
    errorCount: 0,
    operationId: "dissolve-tui-probe",
    errors: [],
  }
  return { success: true, message: "Plan generated: 1 operation(s).", data }
}

interface ScriptedHost {
  baseUrl: string
  /** The raw body of the last `POST /nodes/{id}/operations`, so the input document can be read back. */
  startBody(): string | undefined
  nodeId(): string | undefined
  close(): Promise<void>
}

async function startScriptedHost(): Promise<ScriptedHost> {
  const recorded: { body?: string; nodeId?: string } = {}
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8")
      const path = request.url ?? ""
      // The face probes `/health` before it renders anything (it is the one token-free route the Rust
      // host serves), so a scripted host that does not answer it looks like a dead port.
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        recorded.body = body
        recorded.nodeId = decodeURIComponent(path.split("/")[2] ?? "")
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          operation: {
            operationId: "op-tui-1",
            nodeId: recorded.nodeId,
            phase: "completed",
            createdAt: 1,
            updatedAt: 2,
            finishedAt: 2,
            eventCount: 0,
            result: planResult(),
          },
        }))
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("scripted host did not bind a port")
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    startBody: () => recorded.body,
    nodeId: () => recorded.nodeId,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

function createHost(env: Record<string, string>): CliHost {
  // Deliberately not spreading process.env, so no attach leaks in from the machine running this test.
  const sink = { write: (_chunk: string) => true, isTTY: false, columns: 140 }
  return {
    cwd: process.cwd(),
    env,
    stdin: { isTTY: true } as CliHost["stdin"],
    stdout: sink,
    stderr: sink,
  }
}

test("the TUI face starts a dissolvef operation on the host and renders its plan", async () => {
  const host = await startScriptedHost()
  let setup!: Awaited<ReturnType<typeof testRender>>
  try {
    const definition = createDissolvefHostDefinition(
      createHost({ XIRANITE_BACKEND_URL: host.baseUrl, XIRANITE_BACKEND_TOKEN: TOKEN, NO_COLOR: "1" }),
      undefined,
      "zh",
    )
    await act(async () => {
      setup = await testRender(<DissolvefTui definition={definition} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
    })
    const click = async (id: string) => {
      const target = setup.renderer.root.findDescendantById(id)
      expect(target).toBeDefined()
      await act(async () => {
        await setup.mockMouse.click(target!.x + Math.max(0, Math.floor(target!.width / 2)), target!.y + Math.max(0, Math.floor((target!.height - 1) / 2)))
      })
      await act(async () => setup.flush())
    }

    await act(async () => setup.renderOnce())
    expect(setup.captureCharFrame()).toContain("DISSOLVEF // FOLDER FLUX")
    // Nothing has been sent yet: opening the screen must not reach the host.
    expect(host.startBody()).toBeUndefined()

    await click("field-path")
    await act(async () => {
      await setup.mockInput.typeText("/workspace/album")
    })
    await act(async () => setup.flush())

    await click("execute")

    await setup.waitFor(() => host.startBody() !== undefined)
    const sent = JSON.parse(host.startBody()!) as { input?: { action?: string; path?: string } }
    expect(host.nodeId()).toBe("dissolvef")
    expect(sent.input?.action).toBe("plan")
    expect(sent.input?.path).toBe("/workspace/album")

    // The plan the host produced is what the panel shows — the screen never computes it locally.
    await setup.waitFor(() => setup.captureCharFrame().includes("pic.jpg"))
    const frame = setup.captureCharFrame()
    expect(frame).toContain("操作流 · 1")
    expect(frame).toContain("→ nested · pending")
    expect(frame).toContain("Plan generated: 1 operation(s).")
  } finally {
    if (setup) await act(async () => setup.renderer.destroy())
    await host.close()
  }
})
