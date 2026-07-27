import { describe, expect, it, vi } from "vitest"

import { PersistedReaderExplorerContextMenuProvider, type ReaderExplorerIntegrationSettings } from "./PersistedReaderExplorerContextMenuProvider.js"

describe("PersistedReaderExplorerContextMenuProvider", () => {
  it("[neoview.file.explorer-persistence] persists opt-in intent before registration and reports partial registration as repairable", async () => {
    let settings: ReaderExplorerIntegrationSettings = { explorerOpenEnabled: false, registeredExtensions: [] }
    const write = vi.fn(async (next: ReaderExplorerIntegrationSettings) => { settings = next })
    const setEnabled = vi.fn(async (enabled: boolean) => enabled
      ? { available: true, enabled: false, state: "needs-repair" as const, reason: "access denied" }
      : { available: true, enabled: false, state: "disabled" as const })
    const provider = new PersistedReaderExplorerContextMenuProvider({
      extensions: () => ["jpg", "cbz"],
      settings: { read: async () => settings, write },
      createProvider: () => ({
        preview: async () => ({ available: true, plan: [], registryFile: "" }),
        status: async () => ({ available: true, enabled: false, state: "disabled" }),
        setEnabled,
      }),
    })

    await expect(provider.setEnabled(true)).resolves.toMatchObject({ state: "needs-repair", enabled: false })
    expect(write).toHaveBeenCalledWith({ explorerOpenEnabled: true, registeredExtensions: ["jpg", "cbz"] })
    expect(settings).toEqual({ explorerOpenEnabled: true, registeredExtensions: ["jpg", "cbz"] })
  })

  it("[neoview.file.explorer-persistence] removes extensions no longer configured when disabling", async () => {
    let settings: ReaderExplorerIntegrationSettings = { explorerOpenEnabled: true, registeredExtensions: ["jpg", "legacy"] }
    const plans: readonly string[][] = []
    const provider = new PersistedReaderExplorerContextMenuProvider({
      extensions: () => ["jpg", "cbz"],
      settings: { read: async () => settings, write: async (next) => { settings = next } },
      createProvider: (extensions) => {
        plans.push(extensions)
        return {
          preview: async () => ({ available: true, plan: [], registryFile: "" }),
          status: async () => ({ available: true, enabled: true, state: "registered" }),
          setEnabled: async () => ({ available: true, enabled: false, state: "disabled" }),
        }
      },
    })

    await expect(provider.setEnabled(false)).resolves.toMatchObject({ state: "disabled" })
    expect(plans).toEqual([["jpg", "cbz", "legacy"]])
    expect(settings).toEqual({ explorerOpenEnabled: false, registeredExtensions: [] })
  })

  it("[neoview.file.explorer-persistence] identifies media-format drift without rewriting the valid media preference", async () => {
    const provider = new PersistedReaderExplorerContextMenuProvider({
      extensions: () => ["jpg", "cbz"],
      settings: { read: async () => ({ explorerOpenEnabled: true, registeredExtensions: ["jpg"] }), write: async () => undefined },
      createProvider: () => ({
        preview: async () => ({ available: true, plan: [], registryFile: "" }),
        status: async () => ({ available: true, enabled: true, state: "registered" }),
        setEnabled: async () => ({ available: true, enabled: true, state: "registered" }),
      }),
    })

    await expect(provider.status()).resolves.toMatchObject({ state: "needs-repair", enabled: false })
  })
})
