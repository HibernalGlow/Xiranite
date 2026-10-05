/* @jsxImportSource @opentui/react */
/**
 * The TUI face runs linedup on the host, not in this process (ADR-0074 §5).
 *
 * The screen is given the *production* definition factory (`createLinedupHostDefinition`) and a
 * scripted host that answers like `crates/xiranite-api`, so the path from a mouse click on
 * `run-filter` to `POST /nodes/linedup/operations` and back into the output panel is covered in one
 * piece. The host is a real `node:http` listener on 127.0.0.1 for the same reason it is one in
 * `cli.test.ts`: the attach and the body encoding only count if they survive an actual round trip. No
 * developer backend is contacted — the listener is created and closed by this file, and its answer is
 * a literal document rather than a call into `core.ts`.
 */
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { testRender } from "@opentui/react/test-utils"
import { expect, test } from "vitest"
import { act } from "react"
import type { CliHost } from "@xiranite/cli-runtime"
import { createLinedupHostDefinition } from "./cli.js"
import type { LinedupFilterResult } from "./core.js"
import { createLinedupInteractionSchema } from "./interaction.js"
import { LinedupTui } from "./Tui.js"

const TOKEN = "tui-host-token"

/** What the host's `filterLines` entry answers for the source below minus the `DEBUG` token. */
const HOST_ANSWER: LinedupFilterResult = {
  filteredLines: ["ERROR failed", "INFO started"],
  removedLines: ["DEBUG loading"],
  removedCount: 1,
  keptCount: 2,
}

interface ScriptedHost {
  baseUrl: string
  /** The raw body of the last `POST /nodes/{id}/operations`, so the wire document can be read back. */
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
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== TOKEN && path !== "/health") {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
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
            result: { success: true, message: "Filtered lines.", data: HOST_ANSWER },
          },
        }))
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("scripted host did not bind a port")
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    startBody: () => recorded.body,
    nodeId: () => recorded.nodeId,
    close: () => new Promise<void>((resolveClose, rejectClose) => server.close((error) => (error ? rejectClose(error) : resolveClose()))),
  }
}

function createHost(env: Record<string, string>): CliHost {
  // Deliberately not spreading process.env, so no attach leaks in from the machine running this test.
  const sink = { write: (_chunk: string) => true, isTTY: false, columns: 142 }
  return {
    cwd: process.cwd(),
    env,
    stdin: { isTTY: true } as CliHost["stdin"],
    stdout: sink,
    stderr: sink,
  }
}

test("LinedUp filters through the host with one direct button", async () => {
  const host = await startScriptedHost()
  // The production host-backed `run`/control calls, with the node's own schema factory seeding the
  // two text fields so the screen does not have to be typed into.
  const definition = {
    ...createLinedupHostDefinition(
      createHost({ XIRANITE_BACKEND_URL: host.baseUrl, XIRANITE_BACKEND_TOKEN: TOKEN, NO_COLOR: "1", XIRANITE_CLI_COLUMNS: "142" }),
      {},
      "zh",
    ),
    schema: createLinedupInteractionSchema({ sourceText: "INFO started\nDEBUG loading\nERROR failed", filterText: "DEBUG" }, "zh"),
  }
  const screen = await testRender(<LinedupTui definition={definition} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
  try {
    await act(async () => screen.renderOnce())
    expect(screen.captureCharFrame()).toContain("LINEDUP // TEXT FILTER")
    expect(screen.renderer.root.findDescendantById("field-action")).toBeUndefined()
    const button = screen.renderer.root.findDescendantById("run-filter")
    expect(button).toBeDefined()
    // Opening the screen must not have reached the host.
    expect(host.startBody()).toBeUndefined()

    await act(async () => screen.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))

    // The request and its answer both land on later ticks than the click, and `screen.waitFor`
    // advances frames rather than the socket. Polling inside `act` waits for the round trip for real
    // and keeps the state update it triggers in an act scope.
    await act(async () => {
      for (let attempt = 0; attempt < 100 && !screen.captureCharFrame().includes("× DEBUG loading"); attempt += 1) {
        await new Promise((done) => setTimeout(done, 10))
      }
    })

    const body = host.startBody()
    expect(body).toBeDefined()
    const sent = JSON.parse(body!) as { input?: Record<string, unknown> }
    expect(host.nodeId()).toBe("linedup")
    // The face sends line arrays: splitting text is wire encoding, normalising and matching is the
    // host entry's job.
    expect(sent.input?.sourceLines).toEqual(["INFO started", "DEBUG loading", "ERROR failed"])
    expect(sent.input?.filterLines).toEqual(["DEBUG"])
    expect(sent.input?.caseSensitive).toBe(true)
    expect(sent.input?.sort).toBe(true)
    expect(sent.input).not.toHaveProperty("sourceText")

    // The kept and removed lines the host produced are what the panel shows — the screen never
    // computes them locally, and the line it prints as its status is the host's own message.
    const frame = screen.captureCharFrame()
    expect(frame).toContain("× DEBUG loading")
    expect(frame).toContain("✓ ERROR failed")
    expect(frame).toContain("✓ INFO started")
    expect(frame).toContain("Filtered lines.")
    expect(frame).toContain("原文 · 3 行")
  } finally {
    await act(async () => screen.renderer.destroy())
    await host.close()
  }
})
