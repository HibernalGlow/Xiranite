import type { ReaderDirectoryRoot, ReaderDirectoryRootProvider } from "../../ports/ReaderDirectoryRootProvider.js"

export interface PlatformDirectoryRootProviderOptions {
  platform?: NodeJS.Platform
  listWindowsRoots?: () => Promise<readonly NativeWindowsVolumeRoot[]>
}

interface NativeWindowsVolumeRoot {
  path: string
  label?: string
  driveType: string
  available: boolean
}

export class PlatformDirectoryRootProvider implements ReaderDirectoryRootProvider {
  readonly #platform: NodeJS.Platform
  readonly #listWindowsRoots: () => Promise<readonly NativeWindowsVolumeRoot[]>

  constructor(options: PlatformDirectoryRootProviderOptions = {}) {
    this.#platform = options.platform ?? process.platform
    this.#listWindowsRoots = options.listWindowsRoots ?? listNativeWindowsRoots
  }

  async list(signal?: AbortSignal): Promise<readonly ReaderDirectoryRoot[]> {
    signal?.throwIfAborted()
    if (this.#platform !== "win32") return [{ path: "/", label: "/", kind: "system", available: true }]
    const roots = await this.#listWindowsRoots()
    signal?.throwIfAborted()
    return roots.map((root) => ({
      path: root.path,
      label: root.label ? `${root.label} (${root.path.slice(0, 2)})` : root.path.slice(0, 2),
      kind: rootKind(root.driveType),
      available: root.available,
    }))
  }
}

async function listNativeWindowsRoots(): Promise<readonly NativeWindowsVolumeRoot[]> {
  return (await import("@xiranite/arcthumb-native")).listWindowsVolumeRoots()
}

function rootKind(kind: string): ReaderDirectoryRoot["kind"] {
  return kind === "fixed" || kind === "removable" || kind === "network" || kind === "optical" || kind === "ramdisk"
    ? kind
    : "unknown"
}
