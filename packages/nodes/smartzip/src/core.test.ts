import { describe, expect, test } from "vitest"
import { actionMode, buildSmartZipCommand, buildSmartZipDatabase, buildSmartZipRunRecord, isArchivePath, normalizeSmartZipInput, parseSmartZipIni, runSmartZip, runSmartzip } from "./core.js"

describe("smartzip core", () => {
  test("parses ini sections", () => {
    const config = parseSmartZipIni("[set]\n7zipDir=D:/7zip\n[password]\n1=abc\n[ext]\n1=zip\n2=rar\n[menu]\ncontextMenu=0\n")
    expect(config.sevenZipDir).toBe("D:/7zip")
    expect(config.passwords).toEqual(["abc"])
    expect(config.contextMenu).toBe(false)
  })

  test("maps actions to SmartZip modes", () => {
    expect(actionMode("extract")).toBe("x")
    expect(actionMode("extract_codepage")).toBe("xc")
    expect(isArchivePath("a.cbz")).toBe(true)
  })

  test("builds ahk command", () => {
    const command = buildSmartZipCommand({
      action: "archive",
      paths: ["D:/a"],
      path: "",
      smartZipExe: "",
      smartZipAhk: "SmartZip.ahk",
      autohotkeyExe: "AutoHotkey.exe",
      iniPath: "",
      iniText: "",
      databasePath: "",
      recordRun: false,
      dryRun: false,
    }, "AutoHotkey.exe")
    expect(command.args).toEqual(["SmartZip.ahk", "a", "D:/a"])
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
    const config = parseSmartZipIni("[ext]\n1=zip\n")
    const command = buildSmartZipCommand(input, "SmartZip.exe")
    const record = buildSmartZipRunRecord("extract", input, config, input.paths, command)
    expect(record).toMatchObject({
      toolId: "smartzip",
      action: "extract",
      dryRun: true,
      archiveCount: 1,
      success: true,
    })
  })

  test("runs dry-run without executable", async () => {
    const result = await runSmartZip({ action: "status", path: "a.zip" }, {
      readText: async () => "",
      appendRecord: async () => {},
      pathExists: async () => false,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
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
      pathExists: async () => false,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    })
    expect(result.success).toBe(true)
    expect(records).toHaveLength(1)
    expect(records[0]?.path).toBe("D:/archives/.xiranite/smartzip-runs.jsonl")
    expect(records[0]?.record).toMatchObject({ toolId: "smartzip", action: "status", archiveCount: 1 })
  })

  test("exports generated runner alias", () => {
    expect(runSmartzip).toBe(runSmartZip)
  })
})
