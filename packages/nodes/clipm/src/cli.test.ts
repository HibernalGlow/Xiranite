import { PassThrough } from "node:stream"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import { parseClipmCliArgs, runProgram } from "./cli.js"
import type { ClipmGateway } from "./core.js"

afterEach(() => {
  process.exitCode = undefined
})

describe("xclipm CLI", () => {
  test("parses score, feedback, model, training, and environment commands", () => {
    expect(parseClipmCliArgs(["score", "D:/Comics", "--work", "--dry-run", "--no-rename"])).toEqual({
      action: "score",
      path: "D:/Comics",
      scope: "work",
      scoreOptions: { rescore: false, rename: false, writeMetadata: true, dryRun: true },
    })
    expect(parseClipmCliArgs([
      "feedback", "apply", "work-1", "--classification", "N", "--ranking", "731", "--source", "neoview",
    ])).toEqual({
      action: "feedback-apply",
      workId: "work-1",
      classification: "N",
      ranking: 731,
      source: "neoview",
    })
    expect(parseClipmCliArgs(["feedback", "review", "--status", "resolved", "--limit", "25"])).toMatchObject({
      action: "review-list",
      reviewStatus: "resolved",
      reviewLimit: 25,
    })
    expect(parseClipmCliArgs(["recovery", "status", "--limit", "25"])).toEqual({
      action: "recovery-status",
      recoveryLimit: 25,
    })
    expect(parseClipmCliArgs(["recovery", "calibrate", "--max-works", "50"])).toEqual({
      action: "recovery-calibrate",
      calibrationMaxWorks: 50,
    })
    expect(parseClipmCliArgs(["feedback", "history", "--work-id", "work-1", "--active-only", "--limit", "10", "--before-time", "2026-08-01T00:00:00Z", "--before-event-id", "event-2"])).toEqual({
      action: "feedback-list",
      workId: "work-1",
      includeUndone: false,
      feedbackLimit: 10,
      feedbackBeforeOccurredAt: "2026-08-01T00:00:00Z",
      feedbackBeforeEventId: "event-2",
    })
    expect(parseClipmCliArgs(["feedback", "undo", "event-1"])).toEqual({
      action: "feedback-undo",
      eventId: "event-1",
      source: "gui",
    })
    expect(parseClipmCliArgs(["work", "remove-metadata", "D:/Comics/book.cbz"])).toEqual({
      action: "work-remove-metadata",
      path: "D:/Comics/book.cbz",
    })
    expect(parseClipmCliArgs(["train", "--allow-insufficient-ranking-corrections"])).toEqual({
      action: "train",
      allowInsufficientRankingCorrections: true,
    })
    expect(parseClipmCliArgs(["train", "auto", "--batch-size", "30"])).toEqual({
      action: "train-auto",
      batchSize: 30,
    })
    expect(parseClipmCliArgs(["model", "activate", "3", "--force"])).toEqual({
      action: "model-activate",
      bundleVersion: 3,
      force: true,
    })
    expect(parseClipmCliArgs(["env", "status", "--json"])).toEqual({ action: "env-status" })
    expect(parseClipmCliArgs(["env", "configure", "E:/ClipM", "--device", "cpu"])).toEqual({
      action: "env-configure",
      targetRuntimeRoot: "E:/ClipM",
      device: "cpu",
    })
    expect(parseClipmCliArgs(["env", "migrate", "E:/ClipM", "--json"])).toEqual({
      action: "env-migrate",
      targetRuntimeRoot: "E:/ClipM",
    })
  })

  test("emits one JSON result and disposes the transient gateway", async () => {
    const { host, stdout, stderr } = memoryHost()
    const gateway = fakeGateway()
    const dispose = vi.fn(async () => undefined)
    await runProgram(["env", "--json"], host, {
      createGateway: vi.fn(async () => Object.assign(gateway, { dispose })),
    })

    expect(JSON.parse(stdout.text())).toMatchObject({
      success: true,
      data: { action: "env-status", result: { healthy: true, runtimeRoot: "D:/runtime" } },
    })
    expect(stderr.text()).toBe("")
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("prints help without starting a worker", async () => {
    const { host, stdout } = memoryHost()
    const createGateway = vi.fn()
    await runProgram(["--help"], host, { createGateway })
    expect(stdout.text()).toContain("xclipm feedback")
    expect(createGateway).not.toHaveBeenCalled()
  })

  test("rejects invalid correction values before starting a worker", async () => {
    const { host, stderr } = memoryHost()
    const createGateway = vi.fn()
    await runProgram(["feedback", "apply", "work-1", "--ranking", "1001"], host, { createGateway })
    expect(stderr.text()).toContain("ranking must be an integer from 0 to 1000")
    expect(createGateway).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })
})

function fakeGateway(): ClipmGateway {
  return {
    environmentStatus: vi.fn(async () => ({
      healthy: true,
      serviceVersion: "0.1.0",
      runtimeRoot: "D:/runtime",
      pythonVersion: "3.11",
      device: "cpu",
      cudaAvailable: false,
      modelAvailable: false,
      modelResidency: "idle-10m",
      databaseOk: true,
      sevenZipAvailable: true,
      rarAvailable: false,
    })),
    configureEnvironment: vi.fn(),
    scoreLibrary: vi.fn(),
    scoreWork: vi.fn(),
    getWorkScore: vi.fn(),
    getDirectoryScores: vi.fn(),
    scanFeedback: vi.fn(),
    applyFeedback: vi.fn(),
    listFeedbackEvents: vi.fn(),
    undoFeedback: vi.fn(),
    listReviewItems: vi.fn(),
    getPerceptualRecoveryStatus: vi.fn(),
    calibratePerceptualRecovery: vi.fn(),
    resolveReviewItem: vi.fn(),
    trainHeads: vi.fn(),
    runAutoTraining: vi.fn(),
    listModels: vi.fn(),
    activateModel: vi.fn(),
    rollbackModel: vi.fn(),
    migrateEnvironment: vi.fn(),
    removeWorkMetadata: vi.fn(),
  }
}

function memoryHost(): { host: CliHost; stdout: PassThrough & { text(): string }; stderr: PassThrough & { text(): string } } {
  const stdin = new PassThrough()
  const stdout = captureStream()
  const stderr = captureStream()
  return {
    host: { cwd: "D:/repo", env: {}, stdin, stdout, stderr },
    stdout,
    stderr,
  }
}

function captureStream(): PassThrough & { text(): string } {
  const chunks: Buffer[] = []
  const stream = new PassThrough() as PassThrough & { text(): string }
  stream.on("data", (chunk: Buffer) => chunks.push(chunk))
  stream.text = () => Buffer.concat(chunks).toString("utf8")
  return stream
}
