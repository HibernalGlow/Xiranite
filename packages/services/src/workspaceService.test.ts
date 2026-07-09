import { describe, expect, test } from "vitest"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMemoryNodeRunHistoryRepository, createMemoryWorkspaceRepository } from "@xiranite/repository"
import { ConfigService, NodeRunHistoryService, NodeRunnerService, WorkspaceService } from "./index.js"

describe("WorkspaceService", () => {
  test("creates and renames workspaces through the repository contract", async () => {
    const repository = createMemoryWorkspaceRepository()
    const service = new WorkspaceService({
      repository,
      now: fixedClock([100, 200]),
      createId: () => "alpha",
    })

    const created = await service.createWorkspace({ label: "Alpha" })
    expect(created).toEqual({
      id: "ws-alpha",
      label: "Alpha",
      icon: undefined,
      createdAt: 100,
      updatedAt: 100,
    })

    const renamed = await service.renameWorkspace("ws-alpha", { label: "Beta" })
    expect(renamed.label).toBe("Beta")
    expect(renamed.createdAt).toBe(100)
    expect(renamed.updatedAt).toBe(200)
  })

  test("loads and saves complete workspace snapshots", async () => {
    const snapshot = {
      workspaces: [{ id: "ws-alpha", label: "Alpha", createdAt: 100, updatedAt: 100 }],
      lanes: [
        {
          id: "lane-alpha",
          label: "Alpha lane",
          workspaceId: "ws-alpha",
          widthRatio: 1,
          collapsed: false,
          hidden: false,
          cardOrder: ["comp-alpha"],
          createdAt: 100,
          updatedAt: 100,
        },
      ],
      components: [
        {
          id: "comp-alpha",
          moduleId: "scratch",
          workspaceId: "ws-alpha",
          data: { text: "hello" },
          laneId: "lane-alpha",
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    }
    const repository = createMemoryWorkspaceRepository(snapshot)
    const service = new WorkspaceService({ repository })

    expect(await service.getSnapshot()).toEqual(snapshot)

    const nextSnapshot = { workspaces: [], lanes: [], components: [] }
    expect(await service.saveSnapshot(nextSnapshot)).toEqual(nextSnapshot)
    expect(await service.getSnapshot()).toEqual(nextSnapshot)
  })

  test("records workspace write operations into runtime history", async () => {
    const repository = createMemoryWorkspaceRepository()
    const historyRepository = createMemoryNodeRunHistoryRepository()
    const history = new NodeRunHistoryService({ repository: historyRepository, createId: fixedIds(["hist-create", "hist-save"]) })
    const service = new WorkspaceService({
      repository,
      history,
      now: fixedClock([100, 101, 200, 201]),
      createId: () => "alpha",
    })

    await service.createWorkspace({ label: "Alpha" })
    await service.saveSnapshot({
      workspaces: [{ id: "ws-alpha", label: "Alpha", createdAt: 100, updatedAt: 100 }],
      lanes: [],
      components: [],
    })

    const list = await history.listRuntime({})
    expect(list.items.map((item) => [item.id, item.kind, item.operation])).toEqual([
      ["hist-save", "workspace", "workspace.snapshot.save"],
      ["hist-create", "workspace", "workspace.create"],
    ])
  })
})

describe("NodeRunnerService", () => {
  test("cancels an operation and ignores late runner completion", async () => {
    let releaseRunner!: () => void
    const runnerGate = new Promise<void>((resolve) => {
      releaseRunner = resolve
    })
    const service = new NodeRunnerService({
      now: fixedClock([100, 110, 120, 130, 140, 150, 160]),
      createOperationId: () => "op-cancel",
      runner: {
        async runNode(_nodeId, _input, onEvent) {
          onEvent?.({ type: "log", message: "started" })
          await runnerGate
          onEvent?.({ type: "log", message: "late event" })
          return { success: true, message: "late success" }
        },
      },
    })

    const started = service.startOperation("slow", { value: 1 })
    await sleep(1)
    const cancelled = service.cancelOperation(started.operationId, "Stop requested.")
    const result = await service.waitForOperation(started.operationId)

    releaseRunner()
    await sleep(1)

    const final = service.getOperation(started.operationId)
    const events = service.getOperationEvents(started.operationId)

    expect(cancelled?.phase).toBe("cancelled")
    expect(result).toEqual({ success: false, message: "Stop requested." })
    expect(final?.phase).toBe("cancelled")
    expect(final?.result).toEqual({ success: false, message: "Stop requested." })
    expect(events?.events.map((entry) => entry.event.message)).toEqual(["started", "Stop requested."])
  })

  test("paginates operation events and cleans up expired terminal operations", async () => {
    let now = 100
    let id = 0
    const service = new NodeRunnerService({
      now: () => now,
      createOperationId: () => `op-${id += 1}`,
      runner: {
        async runNode(_nodeId, _input, onEvent) {
          onEvent?.({ type: "log", message: "one" })
          onEvent?.({ type: "log", message: "two" })
          onEvent?.({ type: "log", message: "three" })
          return { success: true, message: "done" }
        },
      },
    })

    const operation = service.startOperation("logs", {})
    const result = await service.waitForOperation(operation.operationId)
    const page = service.getOperationEvents(operation.operationId, { fromEventIndex: 1, limit: 1 })

    now = 10_000
    const cleanup = service.cleanupOperations({ maxAgeMs: 0 })

    expect(result).toEqual({ success: true, message: "done" })
    expect(page).toMatchObject({
      from: 1,
      limit: 1,
      next: 2,
      total: 3,
    })
    expect(page?.events.map((entry) => [entry.index, entry.event.message])).toEqual([[1, "two"]])
    expect(cleanup).toEqual({ removedCount: 1, remainingCount: 0 })
    expect(service.getOperation(operation.operationId)).toBeUndefined()
  })
})

describe("ConfigService", () => {
  test("uses database path as the config location fallback", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xiranite-services-db-"))
    const service = new ConfigService({
      databasePath: join(tempDir, "xiranite.db"),
      env: {
        APPDATA: join(tempDir, "Roaming"),
        LOCALAPPDATA: join(tempDir, "Local"),
      },
      platform: "win32",
      homeDir: tempDir,
    })

    try {
      expect(service.getConfigPath()).toBe(join(tempDir, "xiranite.config.toml"))
      const ensured = await service.ensureConfigFile()
      expect(ensured.path).toBe(join(tempDir, "xiranite.config.toml"))
      expect(ensured.created).toBe(true)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("migrates legacy Roaming config and artifacts into the database directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xiranite-services-migrate-"))
    const legacyDataDir = join(tempDir, "Roaming", "Xiranite")
    const targetDataDir = join(tempDir, "Local", "Xiranite")
    const legacyConfigPath = join(legacyDataDir, "xiranite.config.toml")
    const targetConfigPath = join(targetDataDir, "xiranite.config.toml")
    const legacyArtifactPath = join(legacyDataDir, "artifacts", "undo", "migratef.undo.json")
    const targetArtifactPath = join(targetDataDir, "artifacts", "undo", "migratef.undo.json")

    try {
      await mkdir(join(legacyDataDir, "artifacts", "undo"), { recursive: true })
      await mkdir(targetDataDir, { recursive: true })
      await writeFile(legacyConfigPath, [
        "[nodes.enginev]",
        "workshopPath = \"E:/SteamLibrary\"",
        "",
        "[nodes.enginev.ui]",
        "galleryColumns = 3",
        "",
        "[nodes.repacku]",
        "deleteAfter = true",
      ].join("\n"), "utf8")
      await writeFile(targetConfigPath, [
        "[app.ui]",
        "version = 1",
        "",
        "[nodes.enginev.ui]",
        "galleryColumns = 5",
      ].join("\n"), "utf8")
      await writeFile(legacyArtifactPath, "{\"items\":[]}", "utf8")

      const service = new ConfigService({
        databasePath: join(targetDataDir, "xiranite.db"),
        env: {
          APPDATA: join(tempDir, "Roaming"),
          LOCALAPPDATA: join(tempDir, "Local"),
        },
        platform: "win32",
        homeDir: tempDir,
      })
      const ensured = await service.ensureConfigFile()
      const merged = await readFile(targetConfigPath, "utf8")
      const backup = await readFile(join(targetDataDir, "migration-backups", "xiranite.config.legacy.toml"), "utf8")
      const artifact = await readFile(targetArtifactPath, "utf8")

      expect(ensured).toEqual({ path: targetConfigPath, created: false })
      expect(merged).toContain("workshopPath = \"E:/SteamLibrary\"")
      expect(merged).toContain("galleryColumns = 5")
      expect(merged).toContain("deleteAfter = true")
      expect(backup).toContain("galleryColumns = 3")
      expect(artifact).toBe("{\"items\":[]}")
      await expect(readFile(legacyConfigPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
      await expect(readFile(legacyArtifactPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("reads and merges app config sections", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xiranite-services-app-"))
    const configPath = join(tempDir, "xiranite.config.toml")
    const service = new ConfigService({ configPath })

    try {
      await service.updateAppConfig("ui", { theme: "spatial", colorMode: "light" })
      const result = await service.updateAppConfig("ui", { colorMode: "dark" })
      const loaded = await service.getAppConfig("ui")

      expect(result.config).toEqual({ theme: "spatial", colorMode: "dark" })
      expect(loaded.config).toEqual({ theme: "spatial", colorMode: "dark" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("imports legacy JSON files into node config", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xiranite-services-json-"))
    const configPath = join(tempDir, "xiranite.config.toml")
    const legacyPath = join(tempDir, "legacy.json")
    const service = new ConfigService({ configPath })

    try {
      await writeFile(legacyPath, JSON.stringify({ nodes: { enginev: { workshop_root: "E:/Steam" } } }), "utf8")
      const imported = await service.importLegacy(legacyPath, "enginev")
      const loaded = await service.getNodeConfig("enginev")

      expect(imported.imported).toBe(true)
      expect(imported.config).toEqual({ workshop_root: "E:/Steam" })
      expect(loaded.config).toEqual({ workshop_root: "E:/Steam" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  test("creates the明文 config file before opening it through the injected opener", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "xiranite-services-"))
    const configPath = join(tempDir, "xiranite.config.toml")
    const openedPaths: string[] = []
    const service = new ConfigService({
      configPath,
      openPath: (path) => {
        openedPaths.push(path)
      },
    })

    try {
      const result = await service.openConfigFile()
      const content = await readFile(configPath, "utf8")

      expect(result).toEqual({ opened: true, path: configPath })
      expect(openedPaths).toEqual([configPath])
      expect(content.trim()).toBe("")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

function fixedClock(values: number[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]!
}

function fixedIds(values: string[]) {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]!
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
