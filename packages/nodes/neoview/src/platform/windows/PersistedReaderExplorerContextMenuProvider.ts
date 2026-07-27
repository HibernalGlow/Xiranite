import type { ResolveConfigPathOptions } from "@xiranite/config"

import type {
  ReaderExplorerContextMenuPreview,
  ReaderExplorerContextMenuProvider,
  ReaderExplorerContextMenuStatus,
} from "../../ports/ReaderExplorerContextMenuProvider.js"

export interface ReaderExplorerIntegrationSettings {
  explorerOpenEnabled: boolean
  registeredExtensions: readonly string[]
}

export interface ReaderExplorerIntegrationSettingsStore {
  read(): Promise<ReaderExplorerIntegrationSettings>
  write(settings: ReaderExplorerIntegrationSettings): Promise<void>
}

export interface PersistedReaderExplorerContextMenuProviderOptions {
  createProvider(extensions: readonly string[]): ReaderExplorerContextMenuProvider
  extensions(): readonly string[]
  settings: ReaderExplorerIntegrationSettingsStore
}

/**
 * Binds the user's requested Shell state to the registry adapter. This keeps
 * desired configuration distinct from a mutable HKCR merged view.
 */
export class PersistedReaderExplorerContextMenuProvider implements ReaderExplorerContextMenuProvider {
  constructor(private readonly options: PersistedReaderExplorerContextMenuProviderOptions) {}

  async preview(signal?: AbortSignal): Promise<ReaderExplorerContextMenuPreview> {
    return this.#provider(this.#currentExtensions()).preview(signal)
  }

  async status(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    const settings = await this.options.settings.read()
    const extensions = this.#currentExtensions()
    const actual = await this.#provider(extensions).status(signal)
    if (!actual.available) return actual
    if (!settings.explorerOpenEnabled) return { ...actual, enabled: false, state: "disabled" }
    if (!sameExtensions(settings.registeredExtensions, extensions)) {
      return {
        ...actual,
        enabled: false,
        state: "needs-repair",
        reason: "Supported file types changed. Repair Explorer integration to reconcile its registrations.",
      }
    }
    if (actual.enabled) return { ...actual, state: "registered" }
    return { ...actual, state: actual.state === "conflict" ? "conflict" : "needs-repair" }
  }

  async setEnabled(enabled: boolean, signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    const settings = await this.options.settings.read()
    const extensions = this.#currentExtensions()
    if (!enabled) {
      const removalExtensions = uniqueExtensions([...extensions, ...settings.registeredExtensions])
      const result = await this.#provider(removalExtensions).setEnabled(false, signal)
      if (!result.available || result.state === "needs-repair") return { ...result, state: "needs-repair" }
      await this.options.settings.write({ explorerOpenEnabled: false, registeredExtensions: [] })
      return { ...result, enabled: false, state: "disabled" }
    }

    // Persist the desired state before touching the registry. A partial write
    // is then reported as repairable state instead of being silently lost.
    await this.options.settings.write({ explorerOpenEnabled: true, registeredExtensions: extensions })
    return this.#registerAndPrune(settings.registeredExtensions, extensions, signal)
  }

  async reconcile(signal?: AbortSignal): Promise<ReaderExplorerContextMenuStatus> {
    const settings = await this.options.settings.read()
    if (!settings.explorerOpenEnabled) return this.status(signal)
    return this.#registerAndPrune(settings.registeredExtensions, this.#currentExtensions(), signal)
  }

  async #registerAndPrune(
    previousExtensions: readonly string[],
    extensions: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReaderExplorerContextMenuStatus> {
    const registered = await this.#provider(extensions).setEnabled(true, signal)
    if (!registered.available || registered.state === "needs-repair" || registered.state === "conflict") {
      return { ...registered, enabled: false, state: registered.state === "conflict" ? "conflict" : "needs-repair" }
    }
    const obsolete = previousExtensions.filter((extension) => !extensions.includes(extension))
    if (obsolete.length) {
      const removed = await this.#provider(obsolete).setEnabled(false, signal)
      if (!removed.available || removed.state === "needs-repair") {
        return { ...removed, enabled: false, state: "needs-repair" }
      }
    }
    await this.options.settings.write({ explorerOpenEnabled: true, registeredExtensions: extensions })
    return { available: true, enabled: true, state: "registered" }
  }

  #provider(extensions: readonly string[]): ReaderExplorerContextMenuProvider {
    return this.options.createProvider(uniqueExtensions(extensions))
  }

  #currentExtensions(): readonly string[] {
    return uniqueExtensions(this.options.extensions())
  }
}

export function createNeoviewExplorerIntegrationSettingsStore(
  options: ResolveConfigPathOptions = {},
): ReaderExplorerIntegrationSettingsStore {
  return {
    async read() {
      const { readNeoviewConfig } = await import("../config/NeoviewConfigStore.js")
      return parseSettings(await readNeoviewConfig(options))
    },
    async write(settings) {
      const { commitNeoviewConfig } = await import("../config/NeoviewConfigStore.js")
      await commitNeoviewConfig({
        system_integration: {
          explorer_open_enabled: settings.explorerOpenEnabled,
          explorer_open_registered_extensions: settings.registeredExtensions,
        },
      }, { ...options, strategy: "merge" })
    },
  }
}

function parseSettings(config: Record<string, unknown>): ReaderExplorerIntegrationSettings {
  const raw = asRecord(config.system_integration)
  return {
    explorerOpenEnabled: raw?.explorer_open_enabled === true,
    registeredExtensions: uniqueExtensions(asStringArray(raw?.explorer_open_registered_extensions)),
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function uniqueExtensions(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.map((value) => value.trim().replace(/^\.+/u, "").toLowerCase()).filter(Boolean))])
}

function sameExtensions(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((extension, index) => extension === right[index])
}
