import { describe, expect, test, vi } from "vitest"
import {
  ClipmRuntimeRegistry,
  createNodeClipmRuntime,
  type ClipmPlatformDependencies,
} from "./platform.js"
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

describe("createNodeClipmRuntime environment configuration", () => {
  test("reuses the backend runtime across sequential node operations", async () => {
    const manager = fakeManager({
      environmentStatus: vi.fn(async () => SOURCE_STATUS),
      listModels: vi.fn(async () => ({ activeBundleVersion: 1, models: [] })),
      getDirectoryScores: vi.fn(async (directoryPaths: string[]) => ({
        directories: directoryPaths.map((directoryPath) => ({ directoryPath, work: null })),
      })),
    })
    const dependencies: ClipmPlatformDependencies = {
      loadWorkerOptions: vi.fn(async () => ({ runtimeRoot: "D:/source", connectionIdleTimeoutMs: 60_000 })),
      createManager: vi.fn(() => manager),
      updateConfig: vi.fn(async () => undefined),
      runtimeRegistry: new ClipmRuntimeRegistry(),
    }

    const first = createNodeClipmRuntime({ nodeId: "clipm" }, dependencies)
    const second = createNodeClipmRuntime({ nodeId: "clipm" }, dependencies)
    await first.environmentStatus()
    await second.listModels({ includeFailed: true })
    await second.getDirectoryScores(["D:/library", "D:/archive"])

    expect(first).toBe(second)
    expect(dependencies.createManager).toHaveBeenCalledTimes(1)
    expect(manager.getDirectoryScores).toHaveBeenCalledWith(["D:/library", "D:/archive"])
    await first.dispose()
  })

  test("validates a candidate worker before writing node configuration", async () => {
    const events: string[] = []
    const candidate = fakeManager({
      health: vi.fn(async () => {
        events.push("candidate-health")
        return { ...SOURCE_STATUS, runtimeRoot: "E:/ClipM", device: "cpu", cudaAvailable: false }
      }),
      dispose: vi.fn(async () => { events.push("candidate-disposed") }),
    })
    const dependencies: ClipmPlatformDependencies = {
      loadWorkerOptions: vi.fn(async () => ({ runtimeRoot: "D:/default", device: "cuda" })),
      createManager: vi.fn(() => candidate),
      updateConfig: vi.fn(async () => { events.push("config-written") }),
    }
    const runtime = createNodeClipmRuntime({ cwd: "D:/repo" }, dependencies)

    const result = await runtime.configureEnvironment({ runtimeRoot: "E:/ClipM", device: "cpu" })

    expect(result.runtimeRoot).toBe("E:/ClipM")
    expect(events).toEqual(["candidate-health", "config-written"])
    expect(dependencies.updateConfig).toHaveBeenCalledWith(
      { runtime_root: "E:/ClipM", device: "cpu" },
      { cwd: "D:/repo" },
    )
    await runtime.dispose()
    expect(events).toEqual(["candidate-health", "config-written", "candidate-disposed"])
  })

  test("preserves configuration when candidate health validation fails", async () => {
    const candidate = fakeManager({
      health: vi.fn(async () => ({
        ...SOURCE_STATUS,
        runtimeRoot: "E:/ClipM",
        device: "cuda",
        cudaAvailable: false,
      })),
      dispose: vi.fn(async () => undefined),
    })
    const dependencies: ClipmPlatformDependencies = {
      loadWorkerOptions: vi.fn(async () => ({ runtimeRoot: "D:/default", device: "cuda" })),
      createManager: vi.fn(() => candidate),
      updateConfig: vi.fn(async () => undefined),
    }
    const runtime = createNodeClipmRuntime({}, dependencies)

    await expect(runtime.configureEnvironment({ runtimeRoot: "E:/ClipM", device: "cuda" })).rejects.toThrow("CUDA is unavailable")

    expect(dependencies.updateConfig).not.toHaveBeenCalled()
    expect(candidate.dispose).toHaveBeenCalledOnce()
    await runtime.dispose()
  })
})

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
