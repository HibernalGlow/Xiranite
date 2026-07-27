import { describe, expect, it } from "vitest"
import {
  applyWindowsShellPlan,
  buildWindowsShellCommand,
  legacyWindowsShellRegistryPath,
  quoteWindowsCommandArgument,
  type WindowsRegistryAdapter,
} from "./index.js"

describe("Windows Shell Integration", () => {
  it("quotes a desktop argv command without cmd interpolation", () => {
    expect(buildWindowsShellCommand("C:\\Program Files\\Xiranite\\Xiranite.exe", ["--launch-node", "neoview", "--", "%V"]))
      .toBe('"C:\\Program Files\\Xiranite\\Xiranite.exe" --launch-node neoview -- "%V"')
  })

  it("uses HKCU classes for legacy user registrations", () => {
    expect(legacyWindowsShellRegistryPath("HKCU", "Xiranite.NeoView.Open", "background"))
      .toBe("HKCU\\Software\\Classes\\Directory\\Background\\shell\\Xiranite.NeoView.Open")
  })

  it("escapes embedded quotes according to Windows argv rules", () => {
    expect(quoteWindowsCommandArgument('C:\\A "book"')).toBe('"C:\\A \\"book\\""')
  })

  it("uses the native registry adapter for all registration values", async () => {
    const calls: string[] = []
    const adapter: WindowsRegistryAdapter = {
      async createKey(target) {
        calls.push(`create ${target.hive}\\${target.subkey}`)
      },
      async setStringValue(target, name, value) {
        calls.push(`set ${target.hive}\\${target.subkey} ${name || "(Default)"}=${value}`)
      },
      async deleteKey() {
        return { code: 0, stdout: "", stderr: "" }
      },
    }

    const result = await applyWindowsShellPlan(adapter, [{
      registryPath: "HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open",
      label: "Open with Xiranite",
      icon: "C:\\Xiranite.exe",
      command: '"C:\\Xiranite.exe" "%1"',
    }], "register")

    expect(result).toEqual({ successCount: 1, failedCount: 0, errors: [] })
    expect(calls).toEqual([
      "create HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open",
      "set HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open (Default)=Open with Xiranite",
      "set HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open Icon=C:\\Xiranite.exe",
      "create HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open\\command",
      "set HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open\\command (Default)=\"C:\\Xiranite.exe\" \"%1\"",
    ])
  })

  it("attributes native write failures to the planned registry path", async () => {
    const adapter: WindowsRegistryAdapter = {
      async createKey() {},
      async setStringValue(_target, name) {
        if (name === "Icon") throw new Error("Access denied")
      },
      async deleteKey() {
        return { code: 0, stdout: "", stderr: "" }
      },
    }

    const result = await applyWindowsShellPlan(adapter, [{
      registryPath: "HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open",
      label: "Open with Xiranite",
      icon: "C:\\Xiranite.exe",
      command: '"C:\\Xiranite.exe" "%1"',
    }], "register")

    expect(result).toEqual({
      successCount: 0,
      failedCount: 1,
      errors: ["HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open: Access denied"],
    })
  })

  it("keeps removal idempotent when reg.exe reports an absent key", async () => {
    const adapter: WindowsRegistryAdapter = {
      async createKey() {},
      async setStringValue() {},
      async deleteKey() {
        return { code: 1, stdout: "ERROR: The system was unable to find the specified registry key or value.", stderr: "" }
      },
    }

    const result = await applyWindowsShellPlan(adapter, [{
      registryPath: "HKCU\\Software\\Classes\\*\\shell\\Xiranite.Open",
      label: "Open with Xiranite",
      icon: "C:\\Xiranite.exe",
      command: '"C:\\Xiranite.exe" "%1"',
    }], "unregister")

    expect(result).toEqual({ successCount: 1, failedCount: 0, errors: [] })
  })
})
