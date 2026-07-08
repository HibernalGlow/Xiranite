import { describe, expect, test } from "vitest"
import { buildBackupOperations, classifyEnvuFiles, runEnvuConfig } from "./core.js"

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

  test("runs scan through runtime", async () => {
    const result = await runEnvuConfig({ root: "D:/EnvU" }, {
      listFiles: async () => [{ path: "D:/EnvU/config/a.reg", relativePath: "config/a.reg", size: 1, modifiedMs: 0 }],
      copyFile: async () => {},
      writeText: async () => {},
      makeDir: async () => {},
      join: (...parts) => parts.join("/"),
      dirname: (path) => path.slice(0, path.lastIndexOf("/")),
    })
    expect(result.success).toBe(true)
    expect(result.data?.fileCount).toBe(1)
  })
})
