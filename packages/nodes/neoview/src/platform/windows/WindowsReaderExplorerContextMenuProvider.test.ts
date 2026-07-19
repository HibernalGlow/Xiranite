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

  it("[neoview.file.explorer-context-menu.scheduler] admits registry queries and releases the lease", async () => {
    const release = vi.fn()
    const scheduler = { acquire: vi.fn(async () => ({ release })) }
    const provider = new WindowsReaderExplorerContextMenuProvider({
      platform: "win32",
      registration,
      resourceScheduler: scheduler,
      runReg: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    })

    await provider.status(new AbortController().signal)
    expect(scheduler.acquire).toHaveBeenCalledWith({
      resource: "io",
      kind: "reader.explorer-context-menu.status",
      priority: "interactive",
      ownerId: "neoview:explorer-context-menu",
    }, expect.any(AbortSignal))
    expect(release).toHaveBeenCalledOnce()
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

  it("[neoview.file.explorer-context-menu.rollback-enable] removes a partial registration when a later scope fails", async () => {
    const runReg = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "add" && args[1] === "HKCU\\Software\\Classes\\Directory\\shell\\xiranite") {
        return { code: 1, stdout: "", stderr: "access denied" }
      }
      return { code: 0, stdout: "", stderr: "" }
    })
    const provider = new WindowsReaderExplorerContextMenuProvider({ platform: "win32", registration, runReg })

    await expect(provider.setEnabled(true)).resolves.toMatchObject({
      available: false,
      enabled: false,
      reason: expect.stringContaining("access denied"),
    })
    expect(runReg.mock.calls.map(([args]) => args)).toEqual([
      ["add", "HKCU\\Software\\Classes\\*\\shell\\xiranite", "/ve", "/d", "Open with Xiranite", "/f"],
      ["add", "HKCU\\Software\\Classes\\*\\shell\\xiranite", "/v", "Icon", "/d", registration.icon, "/f"],
      ["add", "HKCU\\Software\\Classes\\*\\shell\\xiranite\\command", "/ve", "/d", '"C:\\Program Files\\Xiranite\\xiranite.exe" --open "%1"', "/f"],
      ["add", "HKCU\\Software\\Classes\\Directory\\shell\\xiranite", "/ve", "/d", "Open with Xiranite", "/f"],
      ["delete", "HKCU\\Software\\Classes\\*\\shell\\xiranite", "/f"],
    ])
  })

  it("[neoview.file.explorer-context-menu.rollback-disable] restores removed scopes when a later delete fails", async () => {
    let deleteCount = 0
    const runReg = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "delete") {
        deleteCount += 1
        if (deleteCount === 2) return { code: 1, stdout: "", stderr: "access denied" }
      }
      return { code: 0, stdout: "", stderr: "" }
    })
    const provider = new WindowsReaderExplorerContextMenuProvider({ platform: "win32", registration, runReg })

    await expect(provider.setEnabled(false)).resolves.toMatchObject({
      available: false,
      enabled: false,
      reason: expect.stringContaining("access denied"),
    })
    expect(runReg.mock.calls.map(([args]) => args)).toEqual([
      ["delete", "HKCU\\Software\\Classes\\*\\shell\\xiranite", "/f"],
      ["delete", "HKCU\\Software\\Classes\\Directory\\shell\\xiranite", "/f"],
      ["add", "HKCU\\Software\\Classes\\*\\shell\\xiranite", "/ve", "/d", "Open with Xiranite", "/f"],
      ["add", "HKCU\\Software\\Classes\\*\\shell\\xiranite", "/v", "Icon", "/d", registration.icon, "/f"],
      ["add", "HKCU\\Software\\Classes\\*\\shell\\xiranite\\command", "/ve", "/d", '"C:\\Program Files\\Xiranite\\xiranite.exe" --open "%1"', "/f"],
    ])
  })

  it("[neoview.file.explorer-context-menu.disable-idempotent] treats a missing registration as already disabled", async () => {
    const runReg = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "The system was unable to find the specified registry key or value.",
    }))
    const provider = new WindowsReaderExplorerContextMenuProvider({ platform: "win32", registration, runReg })

    await expect(provider.setEnabled(false)).resolves.toEqual({ available: true, enabled: false })
    expect(runReg).toHaveBeenCalledTimes(3)
  })

  it("[neoview.file.explorer-context-menu.cancel-after-command] does not report success after cancellation", async () => {
    const controller = new AbortController()
    let complete!: (result: RegistryCommandResult) => void
    const runReg = vi.fn(() => new Promise<RegistryCommandResult>((resolve) => { complete = resolve }))
    const provider = new WindowsReaderExplorerContextMenuProvider({
      platform: "win32",
      registration: { ...registration, scopes: ["file"] },
      runReg,
    })
    const pending = provider.status(controller.signal)
    await vi.waitFor(() => expect(runReg).toHaveBeenCalledOnce())
    const reason = new DOMException("cancelled", "AbortError")
    controller.abort(reason)
    complete({ code: 0, stdout: "", stderr: "" })

    await expect(pending).rejects.toBe(reason)
  })

  it("[neoview.file.explorer-context-menu.dispose] aborts pending work, releases its lease, and closes the provider", async () => {
    const release = vi.fn()
    let complete!: (result: RegistryCommandResult) => void
    let commandSignal!: AbortSignal
    const runReg = vi.fn((_args: readonly string[], signal?: AbortSignal) => {
      commandSignal = signal!
      return new Promise<RegistryCommandResult>((resolve) => { complete = resolve })
    })
    const provider = new WindowsReaderExplorerContextMenuProvider({
      platform: "win32",
      registration: { ...registration, scopes: ["file"] },
      resourceScheduler: { acquire: vi.fn(async () => ({ release })) },
      runReg,
    })
    const pending = provider.status()
    await vi.waitFor(() => expect(runReg).toHaveBeenCalledOnce())
    const disposing = provider[Symbol.asyncDispose]()
    expect(commandSignal.aborted).toBe(true)
    complete({ code: 0, stdout: "", stderr: "" })

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    await disposing
    expect(release).toHaveBeenCalledOnce()
    await expect(provider.preview()).rejects.toThrow("disposed")
    await expect(provider[Symbol.asyncDispose]()).resolves.toBeUndefined()
  })

  it("[neoview.file.explorer-context-menu.command-safety] quotes command arguments and rejects registry text injection", () => {
    const plan = buildReaderExplorerContextMenuPlan({
      ...registration,
      executable: '"C:\\Program Files\\Xiranite\\xiranite.exe"',
      arguments: ["--title", "C:\\Program Files\\books\\", 'a"b', "%1"],
      scopes: ["file"],
    })
    expect(plan[0]?.command).toContain('"C:\\Program Files\\books\\\\"')
    expect(plan[0]?.command).toContain('"a\\"b"')
    expect(() => buildReaderExplorerContextMenuPlan({ ...registration, label: "bad\r\n[HKEY_CURRENT_USER\\evil]" })).toThrow("control characters")
    expect(() => buildReaderExplorerContextMenuPlan({ ...registration, executable: 'xiranite.exe" & evil' })).toThrow("single path")
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
