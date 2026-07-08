import { describe, expect, test } from "vitest"
import {
  buildBackupOperations,
  buildEnvuDatabase,
  buildInventoryRecord,
  classifyEnvuFiles,
  runEnvuConfig,
  runEnvuconfig,
} from "./core.js"

function runtime(overrides: Partial<Parameters<typeof runEnvuConfig>[1]> = {}): Parameters<typeof runEnvuConfig>[1] {
  return {
    listFiles: async () => [{ path: "D:/EnvU/config/a.reg", relativePath: "config/a.reg", size: 1, modifiedMs: 0 }],
    copyFile: async () => {},
    writeText: async () => {},
    appendRecord: async () => {},
    makeDir: async () => {},
    join: (...parts) => parts.join("/"),
    dirname: (path) => path.slice(0, path.lastIndexOf("/")),
    ...overrides,
  }
}

describe("envuconfig core", () => {
  test("classifies EnvU config files", () => {
    const files = classifyEnvuFiles([
      { path: "root/config/a.reg", relativePath: "config/a.reg", size: 1, modifiedMs: 0 },
      { path: "root/src/scoolp/config.toml", relativePath: "src/scoolp/config.toml", size: 2, modifiedMs: 0 },
      { path: "root/tmp.bin", relativePath: "tmp.bin", size: 3, modifiedMs: 0 },
    ], ["config/", "src/scoolp/*.toml"])
    expect(files.map((file) => file.relativePath)).toEqual(["config/a.reg", "src/scoolp/config.toml"])
  })

  test("builds backup targets", () => {
    const operations = buildBackupOperations([
      { path: "root/config/a.reg", relativePath: "config/a.reg", group: "config", size: 1, modifiedMs: 0 },
    ], { backupDir: "bak" }, { join: (...parts) => parts.join("/") })
    expect(operations[0]?.targetPath).toBe("bak/config/a.reg")
  })

  test("builds default JSONL inventory database", () => {
    const database = buildEnvuDatabase({
      root: "D:/EnvU",
      databasePath: "",
      recordRun: false,
    }, { join: (...parts) => parts.join("/") })
    expect(database).toEqual({
      path: "D:/EnvU/.xiranite/envu-config-inventory.jsonl",
      enabled: false,
      mode: "jsonl",
      defaultPath: true,
    })
  })

  test("summarizes inventory records", () => {
    const record = buildInventoryRecord("backup", {
      root: "D:/EnvU",
      backupDir: "D:/Backup",
      manifestName: "manifest.json",
      dryRun: false,
    }, [
      { path: "D:/EnvU/config/a.reg", relativePath: "config/a.reg", group: "config", size: 2, modifiedMs: 0 },
      { path: "D:/EnvU/dotfile/.gitconfig", relativePath: "dotfile/.gitconfig", group: "dotfile", size: 3, modifiedMs: 0 },
    ], [
      { sourcePath: "a", targetPath: "b", status: "success" },
    ])
    expect(record).toMatchObject({
      toolId: "envuconfig",
      action: "backup",
      root: "D:/EnvU",
      backupDir: "D:/Backup",
      fileCount: 2,
      totalSize: 5,
      groups: { config: 1, dotfile: 1 },
      operationCount: 1,
      failedCount: 0,
      success: true,
    })
  })

  test("runs scan through runtime", async () => {
    const result = await runEnvuConfig({ root: "D:/EnvU" }, runtime())
    expect(result.success).toBe(true)
    expect(result.data?.fileCount).toBe(1)
    expect(result.data?.database?.path).toBe("D:/EnvU/.xiranite/envu-config-inventory.jsonl")
  })

  test("records scan inventory when enabled", async () => {
    const records: Array<{ path: string; record: unknown }> = []
    const result = await runEnvuConfig({ root: "D:/EnvU", recordRun: true }, runtime({
      appendRecord: async (path, record) => {
        records.push({ path, record })
      },
    }))
    expect(result.success).toBe(true)
    expect(records).toHaveLength(1)
    expect(records[0]?.path).toBe("D:/EnvU/.xiranite/envu-config-inventory.jsonl")
    expect(records[0]?.record).toMatchObject({ toolId: "envuconfig", action: "scan", fileCount: 1 })
  })

  test("does not record dry-run backup plans", async () => {
    const records: unknown[] = []
    const result = await runEnvuConfig({ action: "backup", root: "D:/EnvU", backupDir: "D:/Backup", recordRun: true, dryRun: true }, runtime({
      appendRecord: async (_path, record) => {
        records.push(record)
      },
    }))
    expect(result.success).toBe(true)
    expect(records).toHaveLength(0)
  })

  test("exports generated runner alias", () => {
    expect(runEnvuconfig).toBe(runEnvuConfig)
  })
})
