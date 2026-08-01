import { describe, expect, test, vi } from "vitest"
import { ClipmWorkerManager } from "./worker-manager.js"
import type { ClipmMcpConnection } from "./mcp-client.js"

function fakeConnection() {
  const close = vi.fn(async () => undefined)
  const callTool = vi.fn(async () => ({ content: [], structuredContent: { healthy: true } }))
  const connection: ClipmMcpConnection = { pid: 4242, close, callTool }
  return { connection, close, callTool }
}

describe("ClipmWorkerManager", () => {
  test("starts on first lease and stops after the last lease", async () => {
    const fake = fakeConnection()
    const createConnection = vi.fn(async () => fake.connection)
    const manager = new ClipmWorkerManager({ runtimeRoot: "D:/runtime", createConnection })
    expect(manager.snapshot()).toMatchObject({ state: "stopped", leaseCount: 0, pid: null })
    expect(createConnection).not.toHaveBeenCalled()

    const first = await manager.acquire("cm-node:1")
    const second = await manager.acquire("neoview:book")
    expect(createConnection).toHaveBeenCalledTimes(1)
    expect(manager.snapshot()).toMatchObject({ state: "running", leaseCount: 2, pid: 4242 })

    await first.release()
    expect(fake.close).not.toHaveBeenCalled()
    await second.release()
    expect(fake.close).toHaveBeenCalledTimes(1)
    expect(manager.snapshot()).toMatchObject({ state: "stopped", leaseCount: 0, pid: null })
  })

  test("shares concurrent startup and releases transient tool calls", async () => {
    const fake = fakeConnection()
    let resolveConnection!: (value: ClipmMcpConnection) => void
    const pending = new Promise<ClipmMcpConnection>((resolve) => { resolveConnection = resolve })
    const createConnection = vi.fn(() => pending)
    const manager = new ClipmWorkerManager({ runtimeRoot: "D:/runtime", createConnection })
    const first = manager.acquire("first")
    const second = manager.acquire("second")
    expect(manager.snapshot()).toMatchObject({ state: "starting", leaseCount: 2 })
    await expect(manager.dispose()).rejects.toThrow("active lease")
    resolveConnection(fake.connection)
    const leases = await Promise.all([first, second])
    expect(createConnection).toHaveBeenCalledTimes(1)
    await Promise.all(leases.map((lease) => lease.release()))
    expect(fake.close).toHaveBeenCalledTimes(1)
  })

  test("clears a reserved lease when startup fails", async () => {
    const manager = new ClipmWorkerManager({
      runtimeRoot: "D:/runtime",
      createConnection: async () => { throw new Error("worker unavailable") },
    })
    await expect(manager.acquire("failed-start")).rejects.toThrow("worker unavailable")
    expect(manager.snapshot()).toMatchObject({ state: "stopped", leaseCount: 0 })
    await manager.dispose()
  })

  test("returns structured health and rejects disposal with active leases", async () => {
    const fake = fakeConnection()
    const manager = new ClipmWorkerManager({ runtimeRoot: "D:/runtime", createConnection: async () => fake.connection })
    const health = await manager.health()
    expect(health.healthy).toBe(true)
    expect(fake.callTool).toHaveBeenCalledWith("health", {}, undefined)
    expect(fake.close).toHaveBeenCalledTimes(1)

    await manager.scoreWork("D:/books/example", { dryRun: true })
    expect(fake.callTool).toHaveBeenCalledWith("score_work", {
      path: "D:/books/example",
      options: { dryRun: true },
    }, undefined)
    const controller = new AbortController()
    const onProgress = vi.fn()
    await manager.scoreLibrary("D:/books", { rename: false }, { signal: controller.signal, onProgress })
    expect(fake.callTool).toHaveBeenCalledWith("score_library", {
      path: "D:/books",
      options: { rename: false },
    }, { signal: controller.signal, onProgress })
    await manager.listReviewItems("resolved", 5)
    expect(fake.callTool).toHaveBeenCalledWith("list_review_items", { status: "resolved", limit: 5 }, undefined)
    await manager.resolveReviewItem({
      reviewId: "018f0000-0000-7000-8000-000000000001",
      resolution: "link_existing",
      existingWorkId: "018f0000-0000-7000-8000-000000000002",
    })
    expect(fake.callTool).toHaveBeenCalledWith("resolve_review_item", {
      reviewId: "018f0000-0000-7000-8000-000000000001",
      resolution: "link_existing",
      existingWorkId: "018f0000-0000-7000-8000-000000000002",
    }, undefined)
    await manager.applyFeedback({
      workId: "018f0000-0000-7000-8000-000000000001",
      classification: "N",
      source: "neoview",
    })
    expect(fake.callTool).toHaveBeenCalledWith("apply_feedback", {
      workId: "018f0000-0000-7000-8000-000000000001",
      classification: "N",
      source: "neoview",
    }, undefined)
    await manager.scanFeedback("D:/books")
    expect(fake.callTool).toHaveBeenCalledWith("scan_feedback", { path: "D:/books" }, undefined)
    await manager.trainHeads({ forceImmediate: true })
    expect(fake.callTool).toHaveBeenCalledWith("train_heads", { forceImmediate: true }, undefined)
    await manager.listModels({ includeFailed: false })
    expect(fake.callTool).toHaveBeenCalledWith("list_models", { includeFailed: false }, undefined)
    await manager.activateModel({ bundleVersion: 2, force: true })
    expect(fake.callTool).toHaveBeenCalledWith("activate_model", { bundleVersion: 2, force: true }, undefined)
    await manager.rollbackModel({ bundleVersion: 1 })
    expect(fake.callTool).toHaveBeenCalledWith("rollback_model", { bundleVersion: 1 }, undefined)
    await manager.environmentStatus()
    expect(fake.callTool).toHaveBeenCalledWith("environment_status", {}, undefined)
    expect(fake.close).toHaveBeenCalledTimes(12)

    const lease = await manager.acquire("cm-node:2")
    await expect(manager.dispose()).rejects.toThrow("active lease")
    await lease.release()
    await manager.dispose()
    await expect(manager.acquire("late")).rejects.toThrow("disposed")
  })
})
