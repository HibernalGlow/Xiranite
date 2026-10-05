import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, test } from "vitest"
import { OperationsClientError, createOperationsClient, type OperationRecord } from "./operationsClient.js"

const TOKEN = "instance-token-1"

interface FakeRequest {
  method: string
  /** The request target, query string included. */
  target: string
  path: string
  search: URLSearchParams
  headers: IncomingHttpHeaders
  body: string
}

interface FakeHost {
  baseUrl: string
  requests: FakeRequest[]
  close(): Promise<void>
}

const hosts: FakeHost[] = []

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()))
})

/**
 * A scripted stand-in for `crates/xiranite-api`: a real listener on an ephemeral 127.0.0.1
 * port, because the client is only interesting if it survives an actual HTTP round trip. The
 * host binary is still being wired, so the bodies below are the documented ones
 * (`crates/xiranite-core/src/operation/dto.rs`), not invented shapes.
 */
async function startHost(script: (request: FakeRequest, response: ServerResponse) => void): Promise<FakeHost> {
  const requests: FakeRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const target = request.url ?? ""
      const fake: FakeRequest = {
        method: request.method ?? "GET",
        target,
        path: target.split("?")[0] ?? target,
        search: new URLSearchParams(target.split("?")[1] ?? ""),
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }
      requests.push(fake)
      script(fake, response)
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function answer(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

function queuedRecord(operationId = "op-1"): OperationRecord {
  return {
    operationId,
    nodeId: "dissolvef",
    phase: "queued",
    createdAt: 1,
    updatedAt: 1,
    eventCount: 0,
  }
}

function terminalRecord<T>(result: { success: boolean; message: string; data?: T }): OperationRecord<T> {
  return { ...queuedRecord(), phase: "completed", updatedAt: 4, finishedAt: 4, eventCount: 1, result }
}

/** Rejects anything without the token header, the way the `authorize()` middleware does. */
function requireToken(request: FakeRequest, response: ServerResponse): boolean {
  if (request.headers["x-xiranite-token"] === TOKEN) return true
  response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
  response.end("Unauthorized")
  return false
}

describe("createOperationsClient", () => {
  test("sends the bearer token as a header and starts the documented operation route", async () => {
    const host = await startHost((request, response) => {
      if (!requireToken(request, response)) return
      answer(response, 200, { operation: queuedRecord("op-42") })
    })
    const client = createOperationsClient({ baseUrl: host.baseUrl, token: TOKEN })

    const started = await client.startOperation("dissolvef", { action: "plan" }, { workspaceId: "ws-1" })

    expect(started.operationId).toBe("op-42")
    expect(started.phase).toBe("queued")
    const recorded = host.requests[0]
    expect(`${recorded?.method} ${recorded?.path}`).toBe("POST /nodes/dissolvef/operations")
    expect(recorded?.headers["x-xiranite-token"]).toBe(TOKEN)
    expect(JSON.parse(recorded?.body ?? "")).toEqual({ input: { action: "plan" }, context: { workspaceId: "ws-1" } })
  })

  test("names a rejected token instead of hiding it behind a generic failure", async () => {
    const host = await startHost((request, response) => {
      requireToken(request, response)
    })
    const client = createOperationsClient({ baseUrl: host.baseUrl, token: "wrong-token" })

    const error = await client.getOperation("op-1").then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(OperationsClientError)
    expect((error as OperationsClientError).name).toBe("OperationsClientError")
    expect((error as OperationsClientError).kind).toBe("unauthorized")
    expect((error as OperationsClientError).status).toBe(401)
    expect((error as OperationsClientError).message).toContain("/node-operations/op-1: 401")
  })

  test("reads the result document off the NDJSON stream, across a split frame", async () => {
    const frames = [
      { type: "operation", operation: { ...queuedRecord(), phase: "running" as const, startedAt: 2 } },
      { type: "event", index: 0, event: { type: "progress" as const, progress: 50, message: "scanning" } },
      { type: "result", operation: terminalRecord({ success: true, message: "done", data: { nestedCount: 3 } }), result: { success: true, message: "done", data: { nestedCount: 3 } } },
    ]
    const payload = `${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`
    // Splitting inside a frame is what a chunked host body really looks like.
    const cut = payload.indexOf('"event"') + 4
    const host = await startHost((request, response) => {
      if (!requireToken(request, response)) return
      if (!request.path.endsWith("/stream")) {
        answer(response, 200, { operation: { ...queuedRecord(), phase: "running", startedAt: 2 } })
        return
      }
      response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
      response.write(payload.slice(0, cut))
      setTimeout(() => response.end(payload.slice(cut)), 5)
    })
    const client = createOperationsClient({ baseUrl: host.baseUrl, token: TOKEN })
    const events: string[] = []

    const result = await client.runOperation<{ nestedCount: number }>("dissolvef", { action: "nested" }, (event) => {
      events.push(`${event.type}:${event.message}`)
    })

    expect(events).toEqual(["progress:scanning"])
    expect(result).toEqual({ success: true, message: "done", data: { nestedCount: 3 } })
    expect(host.requests.map((request) => request.path)).toEqual([
      "/nodes/dissolvef/operations",
      "/node-operations/op-1/stream",
    ])
  })

  test("falls back to /events polling when the stream cannot be held open", async () => {
    const pages = [
      { operation: { ...queuedRecord(), phase: "running" as const, startedAt: 2 }, events: [{ index: 0, event: { type: "log" as const, message: "flattening outer" } }], from: 0, limit: 100, next: 1, total: 1 },
      { operation: terminalRecord({ success: true, message: "3 dissolved", data: { totalCount: 3 } }), events: [], from: 1, limit: 100, total: 1 },
    ]
    let page = 0
    const host = await startHost((request, response) => {
      if (!requireToken(request, response)) return
      if (request.path.endsWith("/stream")) {
        answer(response, 500, { error: "stream unavailable" })
        return
      }
      if (request.path.endsWith("/operations")) {
        answer(response, 200, { operation: { ...queuedRecord(), phase: "running", startedAt: 2 } })
        return
      }
      answer(response, 200, pages[Math.min(page++, pages.length - 1)])
    })
    const client = createOperationsClient({ baseUrl: host.baseUrl, token: TOKEN, pollIntervalMs: 1 })
    const messages: string[] = []

    const result = await client.runOperation<{ totalCount: number }>("dissolvef", { action: "nested" }, (event) => {
      messages.push(event.message)
    })

    expect(messages).toEqual(["flattening outer"])
    expect(result.data).toEqual({ totalCount: 3 })
    const polled = host.requests.filter((request) => request.path.endsWith("/events"))
    expect(polled.length).toBeGreaterThanOrEqual(2)
    expect(polled[1]?.search.get("from")).toBe("1")
  })

  test("carries a node input with absolute paths through unchanged", async () => {
    const input = {
      action: "dissolve",
      path: "D:\\Media\\示例\\outer",
      historyPath: "/tmp/历史/dissolve.json",
      mediaTypes: ["video", "archive"],
      exclude: ["@eaDir"],
    }
    const host = await startHost((request, response) => {
      if (!requireToken(request, response)) return
      answer(response, 200, { operation: terminalRecord({ success: true, message: "ok" }) })
    })
    const client = createOperationsClient({ baseUrl: host.baseUrl, token: TOKEN })

    // The scripted host answers the start with an already-terminal record, which is the
    // branch a host that finished during registration produces.
    const result = await client.runOperation("dissolvef", input)

    expect(result.success).toBe(true)
    const recorded = host.requests[0]
    expect(JSON.parse(recorded?.body ?? "").input).toEqual(input)
    // The wire text keeps the backslashes doubled and the CJK bytes as they are: no
    // re-serialisation through a model, and no base64 or path-token rewriting.
    expect(recorded?.body).toContain(String.raw`"path":"D:\\Media\\示例\\outer"`)
    expect(recorded?.body).toContain(String.raw`"historyPath":"/tmp/历史/dissolve.json"`)
  })

  test("reports a missing operation with the host's own message and pauses what exists", async () => {
    const host = await startHost((request, response) => {
      if (!requireToken(request, response)) return
      if (request.method === "POST") {
        answer(response, 200, { operation: { ...queuedRecord(), phase: "paused", updatedAt: 3 } })
        return
      }
      answer(response, 404, { error: "Node operation not found." })
    })
    const client = createOperationsClient({ baseUrl: host.baseUrl, token: TOKEN })

    const paused = await client.pauseOperation("op-1")
    expect(paused.phase).toBe("paused")
    expect(host.requests[0]).toMatchObject({ method: "POST", path: "/node-operations/op-1/pause" })

    const error = await client.getOperation("gone").then(() => undefined, (cause: unknown) => cause)
    expect((error as OperationsClientError).kind).toBe("notFound")
    expect((error as OperationsClientError).message).toContain("Node operation not found.")
  })

  test("cancel and resume are separate control routes", async () => {
    const host = await startHost((request, response) => {
      if (!requireToken(request, response)) return
      answer(response, 200, { operation: { ...queuedRecord(), phase: request.path.endsWith("/cancel") ? "cancelled" as const : "running" as const } })
    })
    const client = createOperationsClient({ baseUrl: host.baseUrl, token: TOKEN })

    expect((await client.resumeOperation("op-9")).phase).toBe("running")
    expect((await client.cancelOperation("op-9")).phase).toBe("cancelled")
    expect(host.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /node-operations/op-9/resume",
      "POST /node-operations/op-9/cancel",
    ])
  })
})
