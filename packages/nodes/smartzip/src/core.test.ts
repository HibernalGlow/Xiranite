import { describe, expect, test } from "vitest"
import { actionMode, buildSmartZipCommand, isArchivePath, parseSmartZipIni, runSmartZip } from "./core.js"

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
      dryRun: false,
    }, "AutoHotkey.exe")
    expect(command.args).toEqual(["SmartZip.ahk", "a", "D:/a"])
  })

  test("runs dry-run without executable", async () => {
    const result = await runSmartZip({ action: "status", path: "a.zip" }, {
      readText: async () => "",
      pathExists: async () => false,
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    })
    expect(result.success).toBe(true)
    expect(result.data?.archiveCount).toBe(1)
  })
})
