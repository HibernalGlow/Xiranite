import { describe, expect, it, vi } from "vitest"

import {
  buildReaderExplorerContextMenuPlan,
  renderReaderExplorerContextMenuRegistryFile,
  WindowsReaderExplorerContextMenuProvider,
  type RegistryCommandResult,
} from "./WindowsReaderExplorerContextMenuProvider.js"

const registration = {
  key: "xiranite",
  label: "Open with Xiranite",
  executable: "C:\\Program Files\\Xiranite\\xiranite.exe",
  arguments: ["--open", "%1"],
  icon: "C:\\Program Files\\Xiranite\\xiranite.exe",
  scopes: ["file", "directory", "background"] as const,
  hives: ["HKCU"] as const,
}

describe("WindowsReaderExplorerContextMenuProvider", () => {
  it("[neoview.file.explorer-context-menu.preview] reuses owithu registry path and command semantics", async () => {
    const runReg = vi.fn<(...args: never[]) => Promise<RegistryCommandResult>>()
    const provider = new WindowsReaderExplorerContextMenuProvider({ platform: "win32", registration, runReg })

    const preview = await provider.preview()

    expect(runReg).not.toHaveBeenCalled()
    expect(preview.available).toBe(true)
    expect(preview.plan).toEqual([
      {
        entryKey: "xiranite",
        hive: "HKCU",
        scope: "file",
        registryPath: "HKCU\\Software\\Classes\\*\\shell\\xiranite",
        label: "Open with Xiranite",
        icon: registration.icon,
        command: '"C:\\Program Files\\Xiranite\\xiranite.exe" --open "%1"',
        enabled: true,
      },
      expect.objectContaining({ scope: "directory", registryPath: "HKCU\\Software\\Classes\\Directory\\shell\\xiranite", command: '"C:\\Program Files\\Xiranite\\xiranite.exe" --open "%V"' }),
      expect.objectContaining({ scope: "background", registryPath: "HKCU\\Software\\Classes\\Directory\\Background\\shell\\xiranite", command: '"C:\\Program Files\\Xiranite\\xiranite.exe" --open "%V"' }),
    ])
    expect(preview.registryFile).toContain("Windows Registry Editor Version 5.00")
    expect(preview.registryFile).toContain("[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\xiranite]")
    expect(preview.registryFile).toContain('@="\\\"C:\\\\Program Files\\\\Xiranite\\\\xiranite.exe\\\" --open \\\"%1\\\""')
  })

  it("[neoview.file.explorer-context-menu.status] reports all registry scopes enabled only when every key exists", async () => {
    const runReg = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }))
    const provider = new WindowsReaderExplorerContextMenuProvider({ platform: "win32", registration, runReg })

    await expect(provider.status()).resolves.toEqual({ available: true, enabled: true })
    expect(runReg).toHaveBeenCalledTimes(3)

    runReg.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "not found" })
    await expect(provider.status()).resolves.toEqual({ available: true, enabled: false })
  })

  it("[neoview.file.explorer-context-menu.set-enabled] applies add/delete through reg.exe semantics", async () => {
    const runReg = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }))
    const provider = new WindowsReaderExplorerContextMenuProvider({ platform: "win32", registration, runReg })

    await expect(provider.setEnabled(true)).resolves.toEqual({ available: true, enabled: true })
    expect(runReg).toHaveBeenCalledTimes(9)
    expect(runReg.mock.calls[0]?.[0]).toEqual(["add", "HKCU\\Software\\Classes\\*\\shell\\xiranite", "/ve", "/d", "Open with Xiranite", "/f"])

    runReg.mockClear()
    await expect(provider.setEnabled(false)).resolves.toEqual({ available: true, enabled: false })
    expect(runReg).toHaveBeenCalledTimes(3)
    expect(runReg.mock.calls[0]?.[0]).toEqual(["delete", "HKCU\\Software\\Classes\\*\\shell\\xiranite", "/f"])
  })

  it("[neoview.file.explorer-context-menu.unavailable] does not load reg.exe off Windows", async () => {
    const runReg = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }))
    const provider = new WindowsReaderExplorerContextMenuProvider({ platform: "linux", registration, runReg })

    await expect(provider.preview()).resolves.toMatchObject({ available: false, plan: [], registryFile: "", reason: expect.stringContaining("Windows") })
    await expect(provider.status()).resolves.toMatchObject({ available: false, enabled: false, reason: expect.stringContaining("Windows") })
    await expect(provider.setEnabled(true)).resolves.toMatchObject({ available: false, enabled: false, reason: expect.stringContaining("Windows") })
    expect(runReg).not.toHaveBeenCalled()
  })

  it("[neoview.file.explorer-context-menu.plan-portable] builds a plan without constructing a provider", () => {
    const plan = buildReaderExplorerContextMenuPlan({ ...registration, hives: ["HKCU", "HKCR"] })
    expect(plan).toHaveLength(6)
    expect(plan[3]?.registryPath).toBe("HKCR\\*\\shell\\xiranite")
    expect(renderReaderExplorerContextMenuRegistryFile(plan)).toContain("HKEY_CLASSES_ROOT")
  })
})
