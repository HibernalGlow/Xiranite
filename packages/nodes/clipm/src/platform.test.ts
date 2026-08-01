import { describe, expect, test, vi } from "vitest"
import { createNodeClipmRuntime, type ClipmPlatformDependencies } from "./platform.js"
import type { ClipmWorkerManager } from "./worker-manager.js"

const SOURCE_STATUS = {
  healthy: true,
  serviceVersion: "0.1.0",
  runtimeRoot: "D:/source",
  pythonVersion: "3.11.9",
  device: "cpu" as const,
  cudaAvailable: false,
  modelAvailable: true,
  modelResidency: "idle-10m" as const,
  activeBundleVersion: 1,
  databaseOk: true,
  sevenZipAvailable: true,
  rarAvailable: true,
}

describe("createNodeClipmRuntime environment migration", () => {
  test("validates the target MCP worker before switching node configuration", async () => {
    const events: string[] = []
    const source = fakeManager({
      migrateEnvironment: vi.fn(async () => ({
        sourceRuntimeRoot: "D:/source",
        targetRuntimeRoot: "E:/target",
        sourceStatus: SOURCE_STATUS,
        targetStatus: { ...SOURCE_STATUS, runtimeRoot: "E:/target" },
        pythonEnvironmentRecreated: true,
      })),
      dispose: vi.fn(async () => { events.push("source-disposed") }),
    })
    const target = fakeManager({
      health: vi.fn(async () => {
        events.push("target-health")
        return { ...SOURCE_STATUS, runtimeRoot: "E:/target" }
      }),
    })
    const dependencies = migrationDependencies(source, target, events)
    const runtime = createNodeClipmRuntime({ cwd: "D:/repo" }, dependencies)

    const result = await runtime.migrateEnvironment({ targetRuntimeRoot: "E:/target" })

    expect(result.targetStatus.runtimeRoot).toBe("E:/target")
    expect(events).toEqual(["target-health", "source-disposed", "config-switched"])
    expect(dependencies.updateConfig).toHaveBeenCalledWith({ runtime_root: "E:/target" }, { cwd: "D:/repo" })
    await runtime.dispose()
  })

  test("keeps the source configuration when target validation fails", async () => {
    const events: string[] = []
    const source = fakeManager({
      migrateEnvironment: vi.fn(async () => ({
        sourceRuntimeRoot: "D:/source",
        targetRuntimeRoot: "E:/target",
        sourceStatus: SOURCE_STATUS,
        targetStatus: { ...SOURCE_STATUS, runtimeRoot: "E:/target" },
        pythonEnvironmentRecreated: true,
      })),
      dispose: vi.fn(async () => { events.push("source-disposed") }),
    })
    const target = fakeManager({
      health: vi.fn(async () => ({ ...SOURCE_STATUS, runtimeRoot: "E:/target", databaseOk: false, healthy: false })),
      dispose: vi.fn(async () => { events.push("target-disposed") }),
    })
    const dependencies = migrationDependencies(source, target, events)
    const runtime = createNodeClipmRuntime({}, dependencies)

    await expect(runtime.migrateEnvironment({ targetRuntimeRoot: "E:/target" })).rejects.toThrow("database health")
    expect(dependencies.updateConfig).not.toHaveBeenCalled()
    expect(events).toEqual(["target-disposed"])
    await runtime.dispose()
    expect(events).toEqual(["target-disposed", "source-disposed"])
  })

  test("releases the prepared target and reloads the old config when the atomic config write fails", async () => {
    const events: string[] = []
    const source = fakeManager({
      migrateEnvironment: vi.fn(async () => ({
        sourceRuntimeRoot: "D:/source",
        targetRuntimeRoot: "E:/target",
        sourceStatus: SOURCE_STATUS,
        targetStatus: { ...SOURCE_STATUS, runtimeRoot: "E:/target" },
        pythonEnvironmentRecreated: true,
      })),
      dispose: vi.fn(async () => { events.push("source-disposed") }),
    })
    const target = fakeManager({
      health: vi.fn(async () => ({ ...SOURCE_STATUS, runtimeRoot: "E:/target" })),
      dispose: vi.fn(async () => { events.push("target-disposed") }),
    })
    const dependencies = migrationDependencies(source, target, events)
    dependencies.updateConfig.mockRejectedValueOnce(new Error("config disk unavailable"))
    const runtime = createNodeClipmRuntime({}, dependencies)

    await expect(runtime.migrateEnvironment({ targetRuntimeRoot: "E:/target" })).rejects.toThrow("config disk unavailable")
    expect(events).toEqual(["source-disposed", "target-disposed"])
    await runtime.dispose()
  })
})

function migrationDependencies(
  source: ClipmWorkerManager,
  target: ClipmWorkerManager,
  events: string[],
): ClipmPlatformDependencies & { updateConfig: ReturnType<typeof vi.fn> } {
  let created = 0
  return {
    loadWorkerOptions: vi.fn(async () => ({ runtimeRoot: "D:/source", device: "cpu" })),
    createManager: vi.fn(() => created++ === 0 ? source : target),
    updateConfig: vi.fn(async () => { events.push("config-switched") }),
  }
}

function fakeManager(overrides: Record<string, unknown>): ClipmWorkerManager {
  return {
    migrateEnvironment: vi.fn(),
    health: vi.fn(),
    dispose: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ClipmWorkerManager
}
