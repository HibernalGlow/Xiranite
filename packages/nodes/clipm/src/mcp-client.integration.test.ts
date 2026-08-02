import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, test } from "vitest"
import { ClipmWorkerManager } from "./worker-manager.js"

const runtimeRoots: string[] = []
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const pythonEnvironmentRoot = process.env.XIRANITE_CLIPM_TEST_PYTHON_ENVIRONMENT_ROOT
  ?? join(packageRoot, "python", ".venv")

afterAll(async () => {
  for (const root of runtimeRoots) await rm(root, { recursive: true, force: true })
})

describe("ClipM MCP stdio", () => {
  test("runs the agent correction and recovery workflow over official stdio", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "xiranite-clipm-mcp-"))
    runtimeRoots.push(runtimeRoot)
    const libraryRoot = join(runtimeRoot, "library")
    const firstPath = await createPortableWork(
      libraryRoot,
      "Alpha",
      "018f0000-0000-7000-8000-000000000001",
      1,
      "FWTX",
      "P",
      873,
    )
    await createPortableWork(
      libraryRoot,
      "Beta",
      "018f0000-0000-7000-8000-000000000002",
      2,
      "1EH9",
      "N",
      342,
    )
    const stderr: string[] = []
    const manager = new ClipmWorkerManager({
      runtimeRoot,
      pythonEnvironmentRoot,
      device: "cpu",
      syncEnvironment: false,
      onStderr: (message) => stderr.push(message),
    })
    const status = await manager.health()
    expect(status).toMatchObject({
      healthy: true,
      databaseOk: true,
      device: "cpu",
      modelAvailable: true,
      activeBundleVersion: 1,
    })
    expect(status.runtimeRoot.toLowerCase()).toBe(runtimeRoot.toLowerCase())
    expect(manager.snapshot()).toMatchObject({ state: "stopped", leaseCount: 0, pid: null })

    const progress: string[] = []
    const scored = await manager.scoreLibrary(libraryRoot, undefined, {
      onProgress: (event) => progress.push(event.message ?? ""),
    })
    expect(scored).toMatchObject({
      discoveredWorkCount: 2,
      succeededWorkCount: 2,
      failedWorkCount: 0,
    })
    expect(progress.length).toBeGreaterThanOrEqual(1)
    expect(progress.every((message) => message.startsWith("scored: "))).toBe(true)
    const recovery = await manager.getPerceptualRecoveryStatus()
    expect(recovery).toMatchObject({
      candidateGenerationEnabled: false,
      threshold: null,
      calibrationStatus: "collecting_telemetry",
      embeddedWorkCount: 0,
      observationCount: 0,
    })
    const calibration = await manager.calibratePerceptualRecovery({ maxWorks: 12 })
    expect(calibration).toMatchObject({
      status: "rejected",
      candidateGenerationEnabled: false,
      evidenceWorkCount: 0,
      evaluatedWorkCount: 0,
      positiveSampleCount: 0,
      negativeSampleCount: 0,
      threshold: null,
    })

    const lookup = await manager.getWorkScore(firstPath)
    expect(lookup.work).toMatchObject({
      workId: "018f0000-0000-7000-8000-000000000001",
      label: "P",
      score: 873,
    })
    const corrected = await manager.applyFeedback({
      workId: "018f0000-0000-7000-8000-000000000001",
      classification: "N",
      ranking: 901,
      source: "gui",
    })
    expect(corrected.work).toMatchObject({ label: "N", score: 901, renamed: true })
    const history = await manager.listFeedbackEvents({
      workId: "018f0000-0000-7000-8000-000000000001",
    })
    expect(history.events).toHaveLength(1)
    expect(history.events?.[0]).toMatchObject({
      classificationAfter: "N",
      rankingAfter: 901,
      undoApplicable: true,
    })
    const restored = await manager.undoFeedback({
      eventId: history.events![0]!.eventId,
      source: "gui",
    })
    expect(restored.work).toMatchObject({ label: "P", score: 873, renamed: true })
    const removed = await manager.removeWorkMetadata(restored.work.path)
    expect(removed).toMatchObject({
      workId: "018f0000-0000-7000-8000-000000000001",
      databaseRemoved: true,
      metadataRemoved: true,
      renamed: true,
    })
    expect(stderr.join("\n")).not.toContain("Traceback")
    await manager.dispose()
  }, 180_000)
})

async function createPortableWork(
  libraryRoot: string,
  title: string,
  workId: string,
  recordNumber: number,
  shortCode: string,
  label: "P" | "N",
  score: number,
): Promise<string> {
  const workPath = join(libraryRoot, `${title} [CM1${label}${String(score).padStart(4, "0")}-${shortCode}]`)
  await mkdir(workPath, { recursive: true })
  await writeFile(join(workPath, "01.jpg"), "portable test page")
  await writeFile(join(workPath, "xiranite.cm-score.json"), JSON.stringify({
    schemaVersion: 1,
    work: {
      workId,
      recordNumber,
      shortCode,
      firstSeenName: title,
      currentBaseName: title,
      nameRevision: 0,
    },
    score: {
      bundleVersion: 1,
      classification: { predicted: label, current: label, source: "model" },
      ranking: { predicted: score, current: score, source: "model" },
      probability: score / 1000,
      scoredAt: "2026-08-01T00:00:00Z",
    },
    embedding: {
      encoder: "google/siglip2-base-patch16-224",
      preprocess: "white-letterbox-224/four-of-twelve/color-mono-v1",
      dtype: "float16",
      shape: [768],
      encoding: "base64",
      data: Buffer.alloc(1536).toString("base64"),
    },
    archive: { format: "directory", metadataWriteStatus: "written" },
    nameHistory: [],
    feedbackHistory: [],
  }))
  return workPath
}
