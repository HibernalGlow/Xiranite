import { describe, expect, test } from "vitest"
import { clusterBySignature, planSimiuGroups, runSimiu } from "./core.js"
import type { SimiuRuntime } from "./core.js"

describe("simiu core", () => {
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

  test("scans through runtime", async () => {
    const runtime: SimiuRuntime = {
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
    }
    const result = await runSimiu({ root: "D:/img" }, runtime)
    expect(result.success).toBe(true)
    expect(result.data?.imageCount).toBe(1)
  })
})
