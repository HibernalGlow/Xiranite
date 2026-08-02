import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test, expect, vi } from "vitest"
import {
  loadClipmWorkerOptions,
  perceptualCalibrationDue,
  runClipmIdleMaintenanceAttempt,
} from "./platform.js"
import type { ClipmWorkerManager } from "./worker-manager.js"

test("enables unattended training by default while preserving an explicit opt-out", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "xiranite-clipm-config-"))
  const configPath = join(cwd, "xiranite.config.toml")
  try {
    const defaults = await loadClipmWorkerOptions({ cwd, env: { XIRANITE_CONFIG_PATH: configPath } })
    expect(defaults.autoTrain).toBe(true)
    expect(defaults.autoTrainBatchSize).toBe(20)
    expect(defaults.autoCalibrateRecovery).toBe(true)

    const optedOut = await loadClipmWorkerOptions({
      cwd,
      env: { XIRANITE_CONFIG_PATH: configPath, XIRANITE_CLIPM_AUTO_TRAIN: "false" },
    })
    expect(optedOut.autoTrain).toBe(false)
    expect(optedOut.autoCalibrateRecovery).toBe(true)

    const calibrationOptOut = await loadClipmWorkerOptions({
      cwd,
      env: {
        XIRANITE_CONFIG_PATH: configPath,
        XIRANITE_CLIPM_AUTO_CALIBRATE_RECOVERY: "false",
      },
    })
    expect(calibrationOptOut.autoCalibrateRecovery).toBe(false)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("loads configurable scoring throughput limits", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "xiranite-clipm-performance-"))
  const configPath = join(cwd, "xiranite.config.toml")
  try {
    await writeFile(configPath, [
      "[nodes.clipm]",
      "scoring_work_batch_size = 2",
      "scoring_page_batch_size = 8",
      "scoring_batch_pause_ms = 250",
      "",
    ].join("\n"))

    const options = await loadClipmWorkerOptions({ cwd, env: { XIRANITE_CONFIG_PATH: configPath } })

    expect(options.scoringWorkBatchSize).toBe(2)
    expect(options.scoringPageBatchSize).toBe(8)
    expect(options.scoringBatchPauseMs).toBe(250)
    expect(options.configPath).toBe(configPath)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test("recalibrates only after enough new page evidence", () => {
  const base = {
    candidateGenerationEnabled: false,
    threshold: null,
    calibrationStatus: "collecting_telemetry" as const,
    observationCount: 0,
    observations: [],
  }
  expect(perceptualCalibrationDue({ ...base, embeddedWorkCount: 11 })).toBe(false)
  expect(perceptualCalibrationDue({ ...base, embeddedWorkCount: 12 })).toBe(true)
  expect(perceptualCalibrationDue({
    ...base,
    embeddedWorkCount: 31,
    lastCalibration: calibration("rejected", 20),
  })).toBe(false)
  expect(perceptualCalibrationDue({
    ...base,
    embeddedWorkCount: 32,
    lastCalibration: calibration("rejected", 20),
  })).toBe(true)
  expect(perceptualCalibrationDue({
    ...base,
    embeddedWorkCount: 20,
    lastCalibration: calibration("failed", 20, 20),
  })).toBe(true)
  expect(perceptualCalibrationDue({
    ...base,
    embeddedWorkCount: 12,
    lastCalibration: calibration("rejected", 12, 8),
  })).toBe(false)
  expect(perceptualCalibrationDue({
    ...base,
    embeddedWorkCount: 125,
    lastCalibration: calibration("rejected", 125, 100),
  })).toBe(false)
  expect(perceptualCalibrationDue({
    ...base,
    embeddedWorkCount: 157,
    lastCalibration: calibration("rejected", 125, 100),
  })).toBe(true)
})

test("runs unattended recovery calibration independently of automatic training", async () => {
  const manager = {
    runAutoTraining: vi.fn(),
    getPerceptualRecoveryStatus: vi.fn(async () => ({
      candidateGenerationEnabled: false,
      threshold: null,
      calibrationStatus: "collecting_telemetry",
      embeddedWorkCount: 12,
      observationCount: 0,
      observations: [],
    })),
    calibratePerceptualRecovery: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } as unknown as ClipmWorkerManager

  await runClipmIdleMaintenanceAttempt(
    { runtimeRoot: "D:/runtime", autoTrain: false, autoCalibrateRecovery: true },
    () => manager,
    20,
  )

  expect(manager.runAutoTraining).not.toHaveBeenCalled()
  expect(manager.getPerceptualRecoveryStatus).toHaveBeenCalledWith(1)
  expect(manager.calibratePerceptualRecovery).toHaveBeenCalledWith({ maxWorks: 100 })
  expect(manager.dispose).toHaveBeenCalledOnce()
})

test("attempts recovery calibration when independent automatic training fails", async () => {
  const manager = {
    runAutoTraining: vi.fn(async () => { throw new Error("training unavailable") }),
    getPerceptualRecoveryStatus: vi.fn(async () => ({
      candidateGenerationEnabled: false,
      threshold: null,
      calibrationStatus: "collecting_telemetry",
      embeddedWorkCount: 12,
      observationCount: 0,
      observations: [],
    })),
    calibratePerceptualRecovery: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } as unknown as ClipmWorkerManager

  await expect(runClipmIdleMaintenanceAttempt(
    { runtimeRoot: "D:/runtime", autoTrain: true, autoCalibrateRecovery: true },
    () => manager,
    20,
  )).rejects.toThrow("training unavailable")

  expect(manager.calibratePerceptualRecovery).toHaveBeenCalledWith({ maxWorks: 100 })
  expect(manager.dispose).toHaveBeenCalledOnce()
})

function calibration(
  status: "rejected" | "failed",
  evidenceWorkCount: number,
  evaluatedWorkCount = evidenceWorkCount,
) {
  return {
    runId: "018f0000-0000-7000-8000-000000000001",
    status,
    candidateGenerationEnabled: false,
    threshold: null,
    evidenceWorkCount,
    evaluatedWorkCount,
    positiveSampleCount: 0,
    negativeSampleCount: 0,
    safetyMargin: 0.01,
    reasons: [],
  }
}
