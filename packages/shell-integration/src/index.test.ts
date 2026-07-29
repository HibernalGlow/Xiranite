import { describe, expect, it } from "vitest"
import {
  applyWindowsShellPlan,
  buildWindowsManagedShellPlan,
  buildWindowsShellCommand,
  inspectWindowsManagedShellPlan,
  legacyWindowsShellRegistryPath,
  quoteWindowsCommandArgument,
  setWindowsManagedShellPlanEnabled,
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

  it("builds a managed plan for effective extensions plus directory scopes", () => {
    const plan = buildWindowsManagedShellPlan({
      registrationId: "xiranite.neoview.open",
      nodeId: "neoview",
      intent: "open",
      key: "Xiranite.NeoView.Open",
      label: "Open with NeoView",
      executable: "C:\\Xiranite.exe",
      arguments: ["--launch-node", "neoview", "--", "%1"],
      extensions: ["jpg", ".cbz", "jpg"],
      scopes: ["file", "directory", "background"],
      hives: ["HKCU"],
    })

    expect(plan).toEqual([
      expect.objectContaining({ extension: "jpg", registryPath: "HKCU\\Software\\Classes\\SystemFileAssociations\\.jpg\\shell\\Xiranite.NeoView.Open" }),
      expect.objectContaining({ extension: "cbz", registryPath: "HKCU\\Software\\Classes\\SystemFileAssociations\\.cbz\\shell\\Xiranite.NeoView.Open" }),
      expect.objectContaining({ scope: "directory", command: "C:\\Xiranite.exe --launch-node neoview -- \"%V\"" }),
      expect.objectContaining({ scope: "background", command: "C:\\Xiranite.exe --launch-node neoview -- \"%V\"" }),
    ])
  })

  it("preserves an unmarked visible verb as a conflict", async () => {
    const [item] = buildWindowsManagedShellPlan({
      registrationId: "xiranite.neoview.open",
      nodeId: "neoview",
      intent: "open",
      key: "Xiranite.NeoView.Open",
      label: "Open with NeoView",
      executable: "C:\\Xiranite.exe",
      hives: ["HKCU"],
    })
    const runner = async (args: readonly string[]) => {
      if (args[0] === "query") return { code: 0, stdout: "External registration", stderr: "" }
      return { code: 1, stdout: "", stderr: "not found" }
    }

    await expect(inspectWindowsManagedShellPlan(runner, [item!])).resolves.toEqual({
      state: "conflict",
      reason: `${item!.registryPath} is owned by another registration and cannot be repaired automatically.`,
    })
  })

  it("treats a marked registration with an old command fingerprint as repairable drift", async () => {
    const [item] = buildWindowsManagedShellPlan({
      registrationId: "xiranite.neoview.open",
      nodeId: "neoview",
      intent: "open",
      key: "Xiranite.NeoView.Open",
      label: "Open with NeoView",
      executable: "C:\\Xiranite.exe",
      hives: ["HKCU"],
    })
    const runner = async (args: readonly string[]) => {
      if (args[0] !== "query") return { code: 0, stdout: "", stderr: "" }
      const valueName = args[3]
      if (args[2] === "/v" && valueName) {
        if (valueName === "Xiranite.Fingerprint") return { code: 0, stdout: "old-fingerprint", stderr: "" }
        return { code: 0, stdout: String({
          "Xiranite.ManagedBy": "xiranite.shell-integration/v1",
          "Xiranite.NodeId": "neoview",
          "Xiranite.Intent": "open",
          "Xiranite.RegistrationId": "xiranite.neoview.open",
        }[valueName]), stderr: "" }
      }
      if (String(args[1]).endsWith("\\command")) return { code: 0, stdout: '"C:\\Previous\\Xiranite.exe" "%1"', stderr: "" }
      return { code: 0, stdout: `${item!.label} ${item!.icon}`, stderr: "" }
    }

    await expect(inspectWindowsManagedShellPlan(runner, [item!])).resolves.toMatchObject({
      state: "needs-repair",
    })
  })

  it("rolls back already-created managed keys when a later write fails", async () => {
    const plan = buildWindowsManagedShellPlan({
      registrationId: "xiranite.neoview.open",
      nodeId: "neoview",
      intent: "open",
      key: "Xiranite.NeoView.Open",
      label: "Open with NeoView",
      executable: "C:\\Xiranite.exe",
      scopes: ["file", "directory"],
      hives: ["HKCU"],
    })
    const calls: readonly string[][] = []
    const runner = async (args: readonly string[]) => {
      calls.push([...args])
      if (args[0] === "add" && args[1] === plan[1]?.registryPath) return { code: 1, stdout: "", stderr: "access denied" }
      return { code: 0, stdout: "", stderr: "" }
    }

    await expect(setWindowsManagedShellPlanEnabled(runner, plan, true)).resolves.toMatchObject({
      state: "needs-repair",
      reason: expect.stringContaining("access denied"),
    })
    expect(calls).toContainEqual(["delete", plan[0]!.registryPath, "/f"])
  })
})
