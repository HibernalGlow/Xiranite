import { describe, expect, it, vi } from "vitest"

import { PlatformDirectoryRootProvider } from "./PlatformDirectoryRootProvider.js"

describe("PlatformDirectoryRootProvider", () => {
  it("[neoview.folder.tree-roots-platform] maps actual Windows volumes without probing drive letters", async () => {
    const listWindowsRoots = vi.fn(async () => [
      { path: "C:\\", label: "System", driveType: "fixed", available: true },
      { path: "E:", driveType: "removable", available: false },
      { path: "Z:\\", label: "Archive", driveType: "network", available: true },
    ])
    const provider = new PlatformDirectoryRootProvider({ platform: "win32", listWindowsRoots })

    await expect(provider.list()).resolves.toEqual([
      { path: "C:\\", label: "System (C:)", kind: "fixed", available: true },
      { path: "E:\\", label: "E:", kind: "removable", available: false },
      { path: "Z:\\", label: "Archive (Z:)", kind: "network", available: true },
    ])
    expect(listWindowsRoots).toHaveBeenCalledOnce()
  })

  it("[neoview.folder.tree-roots-platform] exposes the POSIX system root without native loading", async () => {
    const listWindowsRoots = vi.fn()
    const provider = new PlatformDirectoryRootProvider({ platform: "linux", listWindowsRoots })
    await expect(provider.list()).resolves.toEqual([{ path: "/", label: "/", kind: "system", available: true }])
    expect(listWindowsRoots).not.toHaveBeenCalled()
  })
})
