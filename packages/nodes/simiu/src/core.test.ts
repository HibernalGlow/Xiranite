import { describe, expect, test } from "vitest"
import { buildSimiuDatabase, buildSimiuRunRecord, clusterBySignature, parseSimiuTomlConfig, planSimiuGroups, runSimiu } from "./core.js"
import type { SimiuRuntime } from "./core.js"

describe("simiu core", () => {
  function runtime(overrides: Partial<SimiuRuntime> = {}): SimiuRuntime {
    return {
      readText: async () => "",
      appendRecord: async () => {},
      pathInfo: async (path) => ({ path, exists: true, isFile: false, isDirectory: true, size: 0 }),
      listDir: async (path) => [
        { name: "a.jpg", path: `${path}/a.jpg`, isFile: true, isDirectory: false, size: 10 },
        { name: "b.txt", path: `${path}/b.txt`, isFile: true, isDirectory: false, size: 1 },
      ],
      makeDir: async () => {},
      moveFile: async () => {},
      copyFile: async () => {},
      linkFile: async () => {},
      join: (...parts) => parts.join("/"),
      dirname: (path) => path.slice(0, path.lastIndexOf("/")),
      basename: (path) => path.slice(path.lastIndexOf("/") + 1),
      ...overrides,
    }
  }

  test("clusters images by injected signatures", () => {
    const groups = clusterBySignature([
      { path: "a.jpg", size: 10, signature: "10:.jpg" },
      { path: "b.jpg", size: 10, signature: "10:.jpg" },
      { path: "c.png", size: 11, signature: "11:.png" },
    ], 0)
    expect(groups[0]?.map((item) => item.path)).toEqual(["a.jpg", "b.jpg"])
  })

  test("plans groups without all-in-one folders", () => {
    const groups = planSimiuGroups([
      {
        folder: "D:/img",
        images: [
          { path: "D:/img/a.jpg", size: 10, signature: "10:.jpg" },
          { path: "D:/img/b.jpg", size: 10, signature: "10:.jpg" },
          { path: "D:/img/c.png", size: 11, signature: "11:.png" },
        ],
      },
    ], { minGroupSize: 2, namePrefix: "simiu_set", sizeToleranceBytes: 0 }, { join: (...parts) => parts.join("/") })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.name).toContain("__set_001")
  })

  test("parses TOML-like config", () => {
    expect(parseSimiuTomlConfig('roots = ["D:/a", "D:/b"]\nmode = "copy"\nminGroupSize = 3\nrecordRun = true\n')).toMatchObject({
      roots: ["D:/a", "D:/b"],
      mode: "copy",
      minGroupSize: 3,
      recordRun: true,
    })
  })

  test("builds default JSONL database path", () => {
    const database = buildSimiuDatabase({
      action: "scan",
      root: "D:/img",
      roots: ["D:/img"],
      configPath: "",
      configText: "",
      databasePath: "",
      recordRun: false,
      recursive: true,
      scanOrder: "path",
      namePrefix: "simiu_set",
      minGroupSize: 2,
      sizeToleranceBytes: 0,
      mode: "move",
      dryRun: true,
    }, { join: (...parts) => parts.join("/") })
    expect(database).toEqual({
      path: "D:/img/.xiranite/simiu-runs.jsonl",
      enabled: false,
      mode: "jsonl",
      defaultPath: true,
    })
  })

  test("summarizes run records", () => {
    const record = buildSimiuRunRecord("plan", {
      roots: ["D:/img"],
      recursive: true,
      scanOrder: "path",
      namePrefix: "simiu_set",
      minGroupSize: 2,
      sizeToleranceBytes: 0,
      mode: "move",
      dryRun: true,
    }, [
      { folder: "D:/img", images: [{ path: "D:/img/a.jpg", size: 1, signature: "1:.jpg" }] },
    ], [
      { parentDir: "D:/img", name: "simiu_set__set_001", files: ["D:/img/a.jpg"] },
    ], [
      { mode: "move", sourcePath: "D:/img/a.jpg", targetPath: "D:/img/s/a.jpg", status: "planned" },
    ])
    expect(record).toMatchObject({
      toolId: "simiu",
      action: "plan",
      roots: ["D:/img"],
      folderCount: 1,
      imageCount: 1,
      groupCount: 1,
      operationCount: 1,
    })
  })

  test("scans through runtime", async () => {
    const result = await runSimiu({ root: "D:/img" }, runtime())
    expect(result.success).toBe(true)
    expect(result.data?.imageCount).toBe(1)
    expect(result.data?.database?.path).toBe("D:/img/.xiranite/simiu-runs.jsonl")
  })

  test("loads config and records plan output", async () => {
    const records: Array<{ path: string; record: unknown }> = []
    const result = await runSimiu({ action: "plan", configText: 'root = "D:/img"\nrecordRun = true\n' }, runtime({
      appendRecord: async (path, record) => {
        records.push({ path, record })
      },
    }))
    expect(result.success).toBe(true)
    expect(result.data?.config?.keys).toEqual(["recordRun", "root"])
    expect(records).toHaveLength(1)
    expect(records[0]?.path).toBe("D:/img/.xiranite/simiu-runs.jsonl")
    expect(records[0]?.record).toMatchObject({ toolId: "simiu", action: "plan", imageCount: 1 })
  })
})
