/* @jsxImportSource @opentui/react */
/**
 * The TUI face runs samea on the host, not in this process (ADR-0074 §5).
 *
 * These tests give the *production* screen the *production* definition factory (`createSameaHostDefinition`)
 * and a scripted host that answers like `crates/xiranite-api`, so the path from a click on a command button
 * to `POST /nodes/samea/operations` and back into the analysis chamber is covered in one piece. The host is
 * a real `node:http` listener because the attach and the body encodings only count if they survive an actual
 * round trip. No archive directory is opened anywhere: the paths are strings that travel, and the only thing
 * that ever writes is the host this fixture stands in for.
 */
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "vitest"
import { act } from "react"
import type { CliHost } from "@xiranite/cli-runtime"
import { createSameaHostDefinition } from "./cli.js"
import type { SameaData, SameaResult } from "./core.js"
import { SameaTui } from "./Tui.js"

const TOKEN = "tui-host-token"
const ROOT = "D:/archives/示例"

interface ScriptedHost {
  baseUrl: string
  /** The raw body of the last `POST /nodes/{id}/operations`; `undefined` while nothing has been sent. */
  startBody(): string | undefined
  nodeId(): string | undefined
  close(): Promise<void>
}

/** Answers every start in the `completed` phase, so the face reads its result without holding a stream. */
async function startScriptedHost(result: SameaResult): Promise<ScriptedHost> {
  const recorded: { body?: string; nodeId?: string } = {}
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      // The face probes `/health` (the host's one token-free route) before it renders anything, so a
      // scripted host that did not answer it would look like a dead port.
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const match = /^\/nodes\/([^/]+)\/operations$/.exec(path)
      if (request.method === "POST" && match?.[1]) {
        recorded.body = Buffer.concat(chunks).toString("utf8")
        recorded.nodeId = decodeURIComponent(match[1])
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: { operationId: "op-tui-1", nodeId: recorded.nodeId, phase: "completed", createdAt: 1, updatedAt: 2, finishedAt: 2, eventCount: 0, result } }))
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    startBody: () => recorded.body,
    nodeId: () => recorded.nodeId,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

function data(partial: Partial<SameaData> = {}): SameaData {
  return {
    action: "plan", centralize: false, minOccurrences: 1,
    items: [{ rootPath: ROOT, sourcePath: `${ROOT}/[Alice] set.zip`, targetPath: `${ROOT}/Alice/[Alice] set.zip`, sourceName: "[Alice] set.zip", artistKey: "alice", artistName: "Alice", status: "ready" }],
    groups: [{ key: "alice", name: "Alice", targetDir: `${ROOT}/Alice`, count: 1, status: "ready" }],
    scannedCount: 1, detectedCount: 1, readyCount: 1, movedCount: 0, ignoredCount: 0, skippedCount: 0, conflictCount: 0, errorCount: 0, errors: [],
    ...partial,
  }
}

/** A face host carrying only this test's attach, never one inherited from the machine running it. */
function faceHost(baseUrl: string): CliHost {
  const sink = { write: (_chunk: string) => true, isTTY: false, columns: 150 }
  return { cwd: process.cwd(), env: { XIRANITE_BACKEND_URL: baseUrl, XIRANITE_BACKEND_TOKEN: TOKEN, NO_COLOR: "1" }, stdin: { isTTY: true } as CliHost["stdin"], stdout: sink, stderr: sink }
}

async function openScreen(host: ScriptedHost, config: { dry_run?: boolean } = {}) {
  const definition = createSameaHostDefinition(faceHost(host.baseUrl), config, "zh")
  const screen = await testRender(<SameaTui definition={definition} language="zh" onExit={() => undefined} />, { width: 150, height: 42, useMouse: true })
  const click = async (id: string) => {
    const target = screen.renderer.root.findDescendantById(id)
    expect(target).toBeDefined()
    await act(async () => {
      await screen.mockMouse.click(target!.x + 2, target!.y + Math.max(0, Math.floor((target!.height - 1) / 2)))
    })
    await frameWith(screen, () => true)
  }
  await act(async () => screen.renderOnce())
  return { screen, click }
}

/**
 * Renders until this condition holds and returns the frame.
 *
 * `screen.waitFor` only inspects frames the renderer produces on its own, and a result that arrives from
 * outside that loop — an HTTP round trip, a keystroke the editor has not committed yet — can settle while
 * no further frame is scheduled, which times the probe out on a screen that is already showing the right
 * thing. Flushing each round keeps the assertion about the product rather than about the frame clock.
 */
async function frameWith(screen: Awaited<ReturnType<typeof testRender>>, matches: (frame: string) => boolean, attempts = 60): Promise<string> {
  let frame = ""
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await screen.flush()
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    frame = screen.captureCharFrame()
    if (matches(frame)) return frame
  }
  throw new Error(`the screen never reached the expected state; last frame:\n${frame}`)
}

test("SameA plans through a host operation and renders the archive rows the host returned", async () => {
  const host = await startScriptedHost({ success: true, message: "SameA planned 1 archive transfer(s).", data: data() })
  const { screen, click } = await openScreen(host)
  try {
    expect(screen.captureCharFrame()).toContain("SAMEA // EXTRACTOR PROTOCOL")
    // Opening the screen must not reach the host.
    expect(host.startBody()).toBeUndefined()

    await click("field-pathsText")
    await act(async () => screen.mockInput.typeText(ROOT))
    // The root has to be on screen before the command button is meaningful: an empty `pathsText` fails the
    // schema's own validation and the run never starts.
    await frameWith(screen, (frame) => frame.includes("示例"))

    await click("samea-command-plan")

    await frameWith(screen, (frame) => frame.includes("[Alice] set.zip"))
    const sent = JSON.parse(host.startBody()!) as { input?: { action?: string; paths?: string[]; dryRun?: boolean } }
    expect(host.nodeId()).toBe("samea")
    expect(sent.input?.action).toBe("plan")
    // What the operator typed is what the host is asked about, CJK and all; the screen computed nothing.
    expect(sent.input?.paths).toEqual([ROOT])
    expect(sent.input?.dryRun).toBe(true)

    const frame = screen.captureCharFrame()
    expect(frame).toContain("Alice")
    expect(frame).toContain("SameA planned 1 archive transfer(s).")
    // The target column wraps long paths, so the row is matched by its prefix rather than the whole string.
    expect(frame).toContain(`${ROOT}/Alice/[Alice] set.`)
  } finally {
    await act(async () => screen.renderer.destroy())
    await host.close()
  }
})

test("live classification asks for confirmation before any byte reaches the host", async () => {
  const host = await startScriptedHost({ success: true, message: "SameA organized 1 archive(s).", data: data({ action: "classify", readyCount: 0, movedCount: 1 }) })
  // `dry_run: false` is the node config the face forwards into the schema, and that is what makes classify
  // dangerous. The gate itself belongs to the schema and the session, not to a face-side switch: the HTTP
  // move did not add a `--yes`, and nothing is sent until the operator presses the confirm button.
  const { screen, click } = await openScreen(host, { dry_run: false })
  try {
    await click("field-pathsText")
    await act(async () => screen.mockInput.typeText(ROOT))
    await frameWith(screen, (frame) => frame.includes("示例"))

    await click("samea-command-classify")
    await frameWith(screen, (frame) => frame.includes("确认移动"))
    expect(host.startBody()).toBeUndefined()

    await click("confirm-execute")

    const frame = await frameWith(screen, (candidate) => candidate.includes("SameA organized 1 archive(s)."))
    const sent = JSON.parse(host.startBody()!) as { input?: { action?: string; dryRun?: boolean; paths?: string[] } }
    expect(sent.input?.action).toBe("classify")
    expect(sent.input?.dryRun).toBe(false)
    expect(sent.input?.paths).toEqual([ROOT])
    expect(frame).toContain("SAMEA // EXTRACTOR PROTOCOL")
  } finally {
    await act(async () => screen.renderer.destroy())
    await host.close()
  }
})
