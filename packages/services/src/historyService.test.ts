import { describe, expect, test } from "vitest"
import { createMemoryNodeRunHistoryRepository } from "@xiranite/repository"
import {
  NodeRunnerService,
  NodeRunHistoryService,
  sanitizeInput,
  summarizeInput,
} from "./index.js"

describe("NodeRunHistoryService", () => {
  test("records a successful run with sanitized input and summary", async () => {
    const repository = createMemoryNodeRunHistoryRepository()
    const history = new NodeRunHistoryService({ repository, createId: () => "hist-1" })

    await history.recordFromOperation({
      nodeId: "repacku",
      componentId: "comp-1",
      workspaceId: "ws-1",
      input: { path: "D:/media", dryRun: true, token: "secret" },
      status: "success",
      result: { success: true, message: "OK", stats: { files: 12 } },
      eventCount: 3,
      startedAt: 1_000,
      finishedAt: 1_500,
    })

    const list = await history.list({ nodeId: "repacku" })
    expect(list.items).toHaveLength(1)
    const item = list.items[0]!
    expect(item.id).toBe("hist-1")
    expect(item.durationMs).toBe(500)
    expect(item.inputSummary).toContain("path: D:/media")
    expect(item.inputSummary).toContain("dryRun: true")
    expect(item.input).toMatchObject({ path: "D:/media", dryRun: true, token: "[REDACTED]" })
  })

  test("deletes and clears items through the repository contract", async () => {
    const repository = createMemoryNodeRunHistoryRepository({
      items: [
        historyItem({ id: "h1", nodeId: "repacku", finishedAt: 100 }),
        historyItem({ id: "h2", nodeId: "repacku", finishedAt: 200 }),
        historyItem({ id: "h3", nodeId: "trename", finishedAt: 300 }),
      ],
    })
    const history = new NodeRunHistoryService({ repository })

    await history.delete("h1")
    expect((await history.list({})).items.map((i) => i.id)).toEqual(["h3", "h2"])

    const result = await history.clear({ nodeId: "repacku" })
    expect(result.deletedCount).toBe(1)
    expect((await history.list({})).items.map((i) => i.id)).toEqual(["h3"])
  })

  test("swallows record failures so the runner chain is unaffected", async () => {
    const failingRepository = {
      ...createMemoryNodeRunHistoryRepository(),
      async createRuntimeHistory() {
        throw new Error("disk full")
      },
    }
    const history = new NodeRunHistoryService({ repository: failingRepository })

    await expect(history.recordFromOperation({
      nodeId: "x",
      input: {},
      status: "success",
      result: { success: true, message: "ok" },
      eventCount: 0,
      startedAt: 0,
      finishedAt: 1,
    })).resolves.toBeUndefined()
  })

  test("records non-node runtime operations through the generic API", async () => {
    const repository = createMemoryNodeRunHistoryRepository()
    const history = new NodeRunHistoryService({ repository, createId: () => "hist-runtime" })

    await history.record({
      kind: "workspace",
      operation: "workspace.snapshot.save",
      message: "Saved workspace snapshot.",
      inputSummary: "1 workspaces, 0 lanes, 2 components",
      metadata: { componentCount: 2 },
      startedAt: 10,
      finishedAt: 15,
    })

    const list = await history.listRuntime({ kind: "workspace" })
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({
      id: "hist-runtime",
      kind: "workspace",
      operation: "workspace.snapshot.save",
      status: "success",
      durationMs: 5,
      metadata: { componentCount: 2 },
    })
    expect((await history.list({})).items).toHaveLength(0)
  })
})

describe("NodeRunnerService history integration", () => {
  test("writes history after finishOperation regardless of phase", async () => {
    const repository = createMemoryNodeRunHistoryRepository()
    const history = new NodeRunHistoryService({ repository, createId: () => "hist-x" })

    const service = new NodeRunnerService({
      now: () => 1_000,
      createOperationId: () => "op-1",
      history,
      runner: {
        async runNode() {
          return { success: true, message: "done" }
        },
      },
    })

    const op = service.startOperation("repacku", { path: "D:/foo" }, { componentId: "comp-1" })
    await service.waitForOperation(op.operationId)

    const list = await history.list({ componentId: "comp-1" })
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({
      nodeId: "repacku",
      status: "success",
      message: "done",
      componentId: "comp-1",
    })
    const runtimeList = await history.listRuntime({ kind: "node", componentId: "comp-1" })
    expect(runtimeList.items[0]).toMatchObject({
      kind: "node",
      operation: "node.run",
      nodeId: "repacku",
      componentId: "comp-1",
    })
  })

  test("records cancelled runs with status 'cancelled'", async () => {
    const repository = createMemoryNodeRunHistoryRepository()
    const history = new NodeRunHistoryService({ repository, createId: () => "hist-c" })

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const service = new NodeRunnerService({
      now: () => 500,
      createOperationId: () => "op-c",
      history,
      runner: {
        async runNode(_id, _input, onEvent) {
          onEvent?.({ type: "log", message: "started" })
          await gate
          return { success: true, message: "late" }
        },
      },
    })

    const op = service.startOperation("repacku", { path: "D:/foo" })
    await new Promise((r) => setTimeout(r, 5))
    service.cancelOperation(op.operationId, "user cancelled")
    release()
    await service.waitForOperation(op.operationId)

    const list = await history.list({})
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.status).toBe("cancelled")
    expect(list.items[0]!.message).toBe("user cancelled")
  })

  test("skips history recording when no history service is configured", async () => {
    const service = new NodeRunnerService({
      now: () => 1,
      createOperationId: () => "op-noop",
      runner: {
        async runNode() {
          return { success: true, message: "ok" }
        },
      },
    })

    const op = service.startOperation("repacku", {})
    await expect(service.waitForOperation(op.operationId)).resolves.toEqual({ success: true, message: "ok" })
  })
})

describe("sanitizeInput", () => {
  test("redacts sensitive keys recursively and returns a copy", () => {
    const input = {
      path: "D:/foo",
      token: "abc",
      apiKey: "xxx",
      nested: { password: "p", safe: 1 },
      list: [{ secret: "s" }, { ok: true }],
    }
    const sanitized = sanitizeInput(input) as Record<string, unknown>
    expect(sanitized.token).toBe("[REDACTED]")
    expect(sanitized.apiKey).toBe("[REDACTED]")
    expect((sanitized.nested as Record<string, unknown>).password).toBe("[REDACTED]")
    expect((sanitized.nested as Record<string, unknown>).safe).toBe(1)
    expect((sanitized.list as Array<Record<string, unknown>>)[0]!.secret).toBe("[REDACTED]")
    expect((sanitized.list as Array<Record<string, unknown>>)[1]!.ok).toBe(true)
    // original input untouched
    expect(input.token).toBe("abc")
  })

  test("returns primitives as-is", () => {
    expect(sanitizeInput(null)).toBeNull()
    expect(sanitizeInput(undefined)).toBeUndefined()
    expect(sanitizeInput(42)).toBe(42)
    expect(sanitizeInput("str")).toBe("str")
  })
})

describe("summarizeInput", () => {
  test("extracts known useful keys joined with ·", () => {
    expect(summarizeInput({ path: "D:/foo", mode: "scan", dryRun: true })).toBe(
      "path: D:/foo · mode: scan · dryRun: true",
    )
  })

  test("returns empty string for non-object inputs", () => {
    expect(summarizeInput(null)).toBe("")
    expect(summarizeInput("string")).toBe("")
    expect(summarizeInput(undefined)).toBe("")
  })

  test("truncates to 240 characters", () => {
    const long = "x".repeat(300)
    const summary = summarizeInput({ path: long })
    expect(summary.length).toBeLessThanOrEqual(240)
  })

  test("joins array values with comma", () => {
    expect(summarizeInput({ sourcePaths: ["a", "b", "c"] })).toBe("sourcePaths: a,b,c")
  })
})

function historyItem(overrides: Partial<{
  id: string
  nodeId: string
  finishedAt: number
}>): import("@xiranite/shared").NodeRunHistoryItemDTO {
  const finishedAt = overrides.finishedAt ?? 0
  return {
    id: overrides.id ?? "h",
    nodeId: overrides.nodeId ?? "repacku",
    input: {},
    inputSummary: "",
    status: "success",
    message: "ok",
    eventCount: 0,
    startedAt: finishedAt,
    finishedAt,
    durationMs: 0,
  }
}
