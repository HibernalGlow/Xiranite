import { describe, expect, test, vi } from "vitest"
import { runClipm, type ClipmGateway } from "./core.js"
import type { ClipmCallOptions } from "./mcp-client.js"

const WORK = {
  workId: "018f0000-0000-7000-8000-000000000001",
  path: "D:/Comics/example [CM-abc-P-S0873].cbz",
  label: "P" as const,
  score: 873,
  bundleVersion: 2,
  shortCode: "abc",
}

function fakeGateway(): ClipmGateway {
  return {
    scoreLibrary: vi.fn(async (_path, _scoreOptions, callOptions) => {
      callOptions?.onProgress?.({ progress: 1, total: 2, message: "scored: first.cbz" })
      return {
        path: "D:/Comics",
        discoveredWorkCount: 1,
        succeededWorkCount: 1,
        failedWorkCount: 0,
        feedback: {
          path: "D:/Comics",
          scannedWorkCount: 1,
          synchronizedWorkCount: 0,
          importedFeedbackCount: 0,
        },
        works: [WORK],
      }
    }),
    scoreWork: vi.fn(async () => WORK),
    scanFeedback: vi.fn(async (path) => ({
      path,
      scannedWorkCount: 1,
      synchronizedWorkCount: 1,
      importedFeedbackCount: 1,
    })),
    applyFeedback: vi.fn(async () => ({ work: WORK })),
    listReviewItems: vi.fn(async () => ({ items: [] })),
    resolveReviewItem: vi.fn(async () => WORK),
    trainHeads: vi.fn(async () => ({
      runId: "run-1",
      dataRevision: 4,
      classification: { status: "accepted", bundleVersion: 2 },
      ranking: { status: "skipped", reasons: ["not enough corrections"] },
      activeBundleVersion: 2,
    })),
    listModels: vi.fn(async () => ({ models: [], activeBundleVersion: 2 })),
    activateModel: vi.fn(async () => ({ previousBundleVersion: 1, activeBundleVersion: 2 })),
    rollbackModel: vi.fn(async () => ({ previousBundleVersion: 2, activeBundleVersion: 1 })),
    environmentStatus: vi.fn(async () => ({
      healthy: true,
      serviceVersion: "0.1.0",
      runtimeRoot: "D:/runtime",
      pythonVersion: "3.11",
      device: "cpu",
      cudaAvailable: false,
      modelAvailable: true,
      modelResidency: "idle-10m",
      activeBundleVersion: 2,
      databaseOk: true,
      sevenZipAvailable: true,
      rarAvailable: false,
    })),
  }
}

describe("ClipM gateway core", () => {
  test("routes library scoring through MCP and maps progress to node events", async () => {
    const gateway = fakeGateway()
    const events: Array<{ progress?: number; message: string }> = []
    const controller = new AbortController()
    const result = await runClipm({
      action: "score",
      path: " D:/Comics ",
      scoreOptions: { dryRun: true },
    }, gateway, (event) => events.push(event), controller.signal)

    expect(result).toMatchObject({
      success: true,
      data: { action: "score", result: { succeededWorkCount: 1, failedWorkCount: 0 } },
    })
    expect(gateway.scoreLibrary).toHaveBeenCalledWith(
      "D:/Comics",
      { dryRun: true },
      expect.objectContaining({
        signal: controller.signal,
        timeoutMs: 1_800_000,
        maxTotalTimeoutMs: 86_400_000,
      }),
    )
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ progress: 50, message: "scored: first.cbz" }),
      expect.objectContaining({ progress: 100 }),
    ]))
  })

  test("routes every management action through the shared gateway", async () => {
    const gateway = fakeGateway()
    await runClipm({ action: "feedback-scan", path: "D:/Comics" }, gateway)
    await runClipm({ action: "feedback-apply", workId: WORK.workId, classification: "N", source: "neoview" }, gateway)
    await runClipm({ action: "review-list", reviewStatus: "resolved", reviewLimit: 5 }, gateway)
    await runClipm({ action: "review-resolve", reviewId: "review-1", resolution: "new_work" }, gateway)
    await runClipm({ action: "train", forceImmediate: true }, gateway)
    await runClipm({ action: "model-list", includeFailed: false }, gateway)
    await runClipm({ action: "model-activate", bundleVersion: 3, force: true }, gateway)
    await runClipm({ action: "model-rollback", bundleVersion: 2 }, gateway)
    await runClipm({ action: "env-status" }, gateway)

    expect(gateway.scanFeedback).toHaveBeenCalledWith("D:/Comics", expect.any(Object))
    expect(gateway.applyFeedback).toHaveBeenCalledWith({
      workId: WORK.workId,
      classification: "N",
      ranking: undefined,
      source: "neoview",
    }, expect.any(Object))
    expect(gateway.listReviewItems).toHaveBeenCalledWith("resolved", 5, expect.any(Object))
    expect(gateway.resolveReviewItem).toHaveBeenCalledWith({
      reviewId: "review-1",
      resolution: "new_work",
      existingWorkId: undefined,
    }, expect.any(Object))
    expect(gateway.trainHeads).toHaveBeenCalledWith({ forceImmediate: true }, expect.any(Object))
    expect(gateway.listModels).toHaveBeenCalledWith({ includeFailed: false }, expect.any(Object))
    expect(gateway.activateModel).toHaveBeenCalledWith({ bundleVersion: 3, force: true }, expect.any(Object))
    expect(gateway.rollbackModel).toHaveBeenCalledWith({ bundleVersion: 2 }, expect.any(Object))
    expect(gateway.environmentStatus).toHaveBeenCalledWith(expect.any(Object))
  })

  test("returns validation failures without starting the worker", async () => {
    const gateway = fakeGateway()
    const missingPath = await runClipm({ action: "score" }, gateway)
    const missingCorrection = await runClipm({ action: "feedback-apply", workId: WORK.workId }, gateway)
    const invalidVersion = await runClipm({ action: "model-activate", bundleVersion: 0 }, gateway)

    expect(missingPath).toMatchObject({ success: false, message: "A comic work or library path is required." })
    expect(missingCorrection).toMatchObject({ success: false, message: expect.stringContaining("Classification") })
    expect(invalidVersion).toMatchObject({ success: false, message: "A model bundle version is required." })
    expect(gateway.scoreLibrary).not.toHaveBeenCalled()
    expect(gateway.applyFeedback).not.toHaveBeenCalled()
    expect(gateway.activateModel).not.toHaveBeenCalled()
  })

  test("preserves the abort signal in long-running calls", async () => {
    let observed: ClipmCallOptions | undefined
    const gateway = fakeGateway()
    vi.mocked(gateway.scoreLibrary).mockImplementation(async (_path, _scoreOptions, options) => {
      observed = options
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" })
    })
    const controller = new AbortController()
    controller.abort()
    const result = await runClipm({ action: "score", path: "D:/Comics" }, gateway, undefined, controller.signal)
    expect(observed?.signal).toBe(controller.signal)
    expect(result).toMatchObject({ success: false, message: "This operation was aborted" })
  })
})
