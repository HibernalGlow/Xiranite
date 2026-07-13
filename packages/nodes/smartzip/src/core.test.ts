import { describe, expect, test } from "vitest"
import { actionMode, buildSmartZipCommand, buildSmartZipDatabase, buildSmartZipRunRecord, isArchivePath, normalizeSmartZipInput, parseSmartZipIni, runSmartZip, runSmartzip } from "./core.js"

describe("smartzip core", () => {
  test("parses ini sections", () => {
    const config = parseSmartZipIni("[set]\nzipDir=D:/7zip\npartSkip=1\nnesting=1\n[password]\n1=abc\n[ext]\n1=zip\n2=rar\n[renameName]\n1=sample<--->clean\n[menu]\ncontextMenu=0\n")
    expect(config.sevenZipDir).toBe("D:/7zip")
    expect(config.passwords).toEqual(["abc"])
    expect(config.contextMenu).toBe(false)
    expect(config.skipMultipart).toBe(true)
    expect(config.nestedExtraction).toBe(true)
    expect(config.renameNames).toEqual([{ match: "sample", replacement: "clean" }])
  })

  test("maps actions to SmartZip modes", () => {
    expect(actionMode("extract")).toBe("x")
    expect(actionMode("extract_codepage")).toBe("xc")
    expect(isArchivePath("a.cbz")).toBe(true)
  })

  test("builds native 7-Zip commands without SmartZip or AHK", () => {
    const command = buildSmartZipCommand({
      action: "archive",
      paths: ["D:/a"],
      path: "",
      iniPath: "",
      iniText: "",
      codePage: 0,
      databasePath: "",
      recordRun: false,
      dryRun: false,
    }, "7z.exe")
    expect(command).toMatchObject({ command: "7z.exe", args: ["a", "D:/a.zip", "D:/a", "-y", "-sccUTF-8"] })
  })

  test("builds default JSONL database path", () => {
    const database = buildSmartZipDatabase(normalizeSmartZipInput({ path: "D:/archives/a.zip" }))
    expect(database).toEqual({
      path: "D:/archives/.xiranite/smartzip-runs.jsonl",
      enabled: false,
      mode: "jsonl",
      defaultPath: true,
    })
  })

  test("summarizes run records", () => {
    const input = normalizeSmartZipInput({ action: "extract", path: "D:/archives/a.zip", dryRun: true })
    const config = parseSmartZipIni("[password]\n1=abc\n[ext]\n1=zip\n")
    const command = buildSmartZipCommand(input, "7z.exe")
    const record = buildSmartZipRunRecord("extract", input, config, input.paths, command)
    expect(record).toMatchObject({
      toolId: "smartzip",
      action: "extract",
      dryRun: true,
      archiveCount: 1,
      success: true,
    })
    expect(JSON.stringify(record)).not.toContain("abc")
  })

  test("runs dry-run without executable", async () => {
    const result = await runSmartZip({ action: "status", path: "a.zip" }, {
      readText: async () => "",
      appendRecord: async () => {},
      find7z: async () => null,
      execute: async () => [],
    })
    expect(result.success).toBe(true)
    expect(result.data?.archiveCount).toBe(1)
    expect(result.data?.database?.path).toBe(".xiranite/smartzip-runs.jsonl")
  })

  test("records status when enabled", async () => {
    const records: Array<{ path: string; record: unknown }> = []
    const result = await runSmartZip({ action: "status", path: "D:/archives/a.zip", recordRun: true }, {
      readText: async () => "",
      appendRecord: async (path, record) => {
        records.push({ path, record })
      },
      find7z: async () => null,
      execute: async () => [],
    })
    expect(result.success).toBe(true)
    expect(records).toHaveLength(1)
    expect(records[0]?.path).toBe("D:/archives/.xiranite/smartzip-runs.jsonl")
    expect(records[0]?.record).toMatchObject({ toolId: "smartzip", action: "status", archiveCount: 1 })
  })

  test("exports generated runner alias", () => {
    expect(runSmartzip).toBe(runSmartZip)
  })

  test("redacts configured passwords from node results", async () => {
    const result = await runSmartZip({ action: "status", iniText: "[password]\n1=secret-value" }, {
      readText: async () => "",
      appendRecord: async () => {},
      find7z: async () => null,
      execute: async () => [],
    })
    expect(result.data?.config.passwords).toEqual(["••••"])
    expect(JSON.stringify(result)).not.toContain("secret-value")
  })

  test.each([936, 950, 932, 949, 65001])("passes filename code page CP%s to 7-Zip", (codePage) => {
    const command = buildSmartZipCommand(normalizeSmartZipInput({ action: "extract_codepage", path: "D:/多言語.zip", codePage }), "7z.exe")
    expect(command.args).toContain(`-mcp=${codePage}`)
  })

  test("delegates the source-compatible workflow to the TypeScript platform", async () => {
    const requests: Array<{ paths: string[]; cli: string }> = []
    const result = await runSmartZip({ action: "extract", paths: ["D:/a.zip", "D:/b.7z"], dryRun: false }, {
      readText: async () => "",
      appendRecord: async () => {},
      find7z: async () => ({ cli: "C:/Program Files/7-Zip/7z.exe", fileManager: "C:/Program Files/7-Zip/7zFM.exe" }),
      execute: async (request) => {
        requests.push({ paths: request.paths, cli: request.tools.cli })
        return request.paths.map((sourcePath) => ({ action: "extract", sourcePath, outputPath: sourcePath.replace(/\.[^.]+$/, ""), status: "completed", message: "Extracted.", commandResult: { code: 0, stdout: "ok", stderr: "" } }))
      },
    })
    expect(result.success).toBe(true)
    expect(requests).toEqual([{ paths: ["D:/a.zip", "D:/b.7z"], cli: "C:/Program Files/7-Zip/7z.exe" }])
    expect(result.data?.operations).toHaveLength(2)
  })
})
