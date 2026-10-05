/* @jsxImportSource @opentui/react */
/**
 * The LogX workbench renders from a definition, and the production definition talks to a host
 * (`cli.ts`'s `createLogxHostDefinition`). The first test below proves the screen; the second hands the
 * same screen the production definition against a scripted `/operations` listener, so the path from the
 * action button to `POST /nodes/logx/operations` and back into the event stream is covered in one piece.
 * The host is real HTTP for the same reason it is one in `cli.test.ts`: the attach and the encodings only
 * count if they survive a round trip. No test here depends on a backend that happens to be running.
 */
import { createServer, type AddressInfo } from "node:http"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { expect, test, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { createLogEnvelope, createLogSession } from "@xiranite/logging"
import { createLogxHostDefinition } from "./cli.js"
import { createLogxInteractionSchema } from "./interaction.js"
import { LogxTui } from "./Tui.js"

test("LogX OpenTUI renders query controls and shared results", async () => {
  const session = createLogSession()
  const event = createLogEnvelope({ severityText: "error", eventName: "reader.failed", resource: { serviceName: "xiranite", processType: "frontend" }, scope: { name: "neoview.reader" }, session, error: { name: "Error", message: "decode failed" } })
  const definition = { schema: createLogxInteractionSchema({}, "en"), run: async () => ({ success: true, message: "ok", data: { action: "query" as const, directory: "D:/logs", files: [], issues: [], matchedCount: 1, returnedCount: 1, events: [event], aggregate: { total: 1, bySeverity: { error: 1 }, byScope: { "neoview.reader": 1 }, byEvent: { "reader.failed": 1 }, bySession: { [session.id]: 1 }, errors: [] }, sessions: [] } }) }
  const view = await testRender(<LogxTui definition={definition} language="en" onExit={() => undefined} />, { width: 150, height: 40 })
  try {
    await act(async () => view.renderOnce())
    const frame = view.captureCharFrame()
    expect(frame).toContain("LOGX // STRUCTURED LOG WORKBENCH")
    expect(frame).toContain("STRUCTURED FILTERS")
    expect(frame).toContain("EVENT STREAM")
  } finally {
    await act(async () => view.renderer.destroy())
  }
})

test("LogX OpenTUI runs its workbench on the host instead of in this process", async () => {
  const session = createLogSession("2026-07-23T00:00:00.000Z")
  const event = createLogEnvelope({ id: "one", timestamp: "2026-07-23T00:00:01.000Z", severityText: "warn", eventName: "reader.slow", body: "decode took 4s", resource: { serviceName: "xiranite", processType: "frontend" }, scope: { name: "neoview.reader" }, session })
  const result = {
    success: true,
    message: "Matched 1 log event(s).",
    data: {
      action: "query" as const,
      directory: "D:/日志",
      files: ["D:/日志/current.jsonl"],
      issues: [],
      matchedCount: 1,
      returnedCount: 1,
      events: [event],
      aggregate: { total: 1, bySeverity: { warn: 1 }, byScope: { "neoview.reader": 1 }, byEvent: { "reader.slow": 1 }, bySession: { [session.id]: 1 }, errors: [] },
      sessions: [{ id: session.id, startedAt: session.startedAt, eventCount: 1, errorCount: 0, processTypes: ["frontend"], scopes: ["neoview.reader"] }],
      telemetry: { durationMs: 0, eventsPerSecond: 1, stormIntensity: 0.2, anomalyCells: Array.from({ length: 16 }, (unused, index) => ({ index, eventCount: index === 15 ? 1 : 0, weightedScore: 2, intensity: index === 15 ? 1 : 0 })) },
    },
  }

  const starts: { nodeId: string; input: Record<string, unknown> }[] = []
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
      if (request.headers["x-xiranite-token"] !== "tui-host-token") {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8")).input as Record<string, unknown>
        starts.push({ nodeId: decodeURIComponent(path.split("/")[2] ?? ""), input })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: { operationId: "op-tui-1", nodeId: "logx", phase: "queued", createdAt: 1, updatedAt: 2, eventCount: 0 } }))
        return
      }
      if (path === "/node-operations/op-tui-1/stream") {
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" })
        response.end(`${[
          JSON.stringify({ type: "operation", operation: { operationId: "op-tui-1", nodeId: "logx", phase: "running", createdAt: 1, updatedAt: 2, eventCount: 0 } }),
          JSON.stringify({ type: "result", operation: { operationId: "op-tui-1", nodeId: "logx", phase: "completed", createdAt: 1, updatedAt: 4, eventCount: 0, result }, result }),
        ].join("\n")}\n`)
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  const sink = { isTTY: false, columns: 150, write: vi.fn(() => true) }
  let setup!: Awaited<ReturnType<typeof testRender>>

  try {
    const definition = createLogxHostDefinition(
      // Deliberately not spreading process.env, so no attach leaks in from the machine running this test.
      { cwd: process.cwd(), env: { XIRANITE_BACKEND_URL: `http://127.0.0.1:${port}`, XIRANITE_BACKEND_TOKEN: "tui-host-token", NO_COLOR: "1" }, stdin: sink, stdout: sink, stderr: sink } as unknown as CliHost,
      { directory: "D:/日志" },
      "en",
    )
    // Constructing the definition proves nothing about the transport; the screen must still reach no host.
    await act(async () => { setup = await testRender(<LogxTui definition={definition} language="en" onExit={() => undefined} />, { width: 150, height: 40, useMouse: true }) })
    await act(async () => setup.renderOnce())
    expect(setup.captureCharFrame()).toContain("READY")
    expect(starts.length).toBe(0)

    const launcher = setup.renderer.root.findDescendantById("logx-action-query")
    expect(launcher).toBeDefined()
    await act(async () => { await setup.mockMouse.click(launcher!.x + Math.max(1, Math.floor(launcher!.width / 2)), launcher!.y + Math.max(0, Math.floor((launcher!.height - 1) / 2))) })

    // The wait is on wall-clock time and not on `setup.waitFor`, because `/operations` is a real socket:
    // the renderer goes idle while the request is still in flight, and a frame-passer gives up right there.
    const settle = async () => { await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 25) }) }) }
    for (let attempt = 0; attempt < 40 && starts.length === 0; attempt += 1) await settle()
    // The click became one operation on the host, with the schema's own input document.
    expect(starts.length).toBe(1)
    expect(starts[0]?.nodeId).toBe("logx")
    expect(starts[0]?.input).toMatchObject({ action: "query", directory: "D:/日志", minimumSeverity: "info", limit: 500, order: "desc" })

    for (let attempt = 0; attempt < 40 && !setup.captureCharFrame().includes("1 MATCHED"); attempt += 1) await settle()
    // and what the workbench shows is the document the host produced, never a locally computed one.
    const frame = setup.captureCharFrame()
    expect(frame).toContain("D:/日志")
    expect(frame).toContain("reader.slow")
    expect(frame).toContain("Matched 1 log event(s).")
  } finally {
    if (setup) await act(async () => setup.renderer.destroy())
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => resolve()) })
  }
})
