import { watch } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export type NodeModule = Record<string, unknown>
export interface ModuleLoader {
  (): Promise<NodeModule>
  /**
   * Present only for opt-in development source reloads. The runner compares
   * this revision before reusing its module cache.
   */
  getRevision?: () => number
}

interface DevelopmentSource {
  nodeId: string
  entry: "core" | "platform"
}

let developmentSourceHotReloadEnabled = process.env.XIRANITE_NODE_SOURCE_HMR === "1"
const developmentSourceLoadingEnabled = process.env.XIRANITE_NODE_SOURCE === "1"

export function getDevelopmentSourceHotReloadEnabled(): boolean {
  return developmentSourceLoadingEnabled && developmentSourceHotReloadEnabled
}

/** Changes development source reload at runtime; production loaders ignore it. */
export function setDevelopmentSourceHotReloadEnabled(enabled: boolean): boolean {
  if (!developmentSourceLoadingEnabled) return false
  developmentSourceHotReloadEnabled = enabled
  return developmentSourceHotReloadEnabled
}

/**
 * Development nodes run from source through Bun, so first interaction does
 * not wait for a TypeScript package build. Production continues using dist.
 */
/**
 * `productionLoader` must contain a literal dynamic import at its call site.
 * Bun can then trace and embed every node in the standalone desktop backend;
 * a variable `import(moduleId)` is deliberately not analyzable by bundlers.
 */
export function createNodeModuleLoader(productionLoader: ModuleLoader, source?: DevelopmentSource): ModuleLoader {
  if (source && developmentSourceLoadingEnabled) {
    const file = resolve(import.meta.dirname, "../../..", "packages", "nodes", source.nodeId, "src", `${source.entry}.ts`)
    const sourceDirectory = resolve(import.meta.dirname, "../../..", "packages", "nodes", source.nodeId, "src")
    let revision = 0
    let watching = false

    const ensureWatcher = () => {
      if (watching || !developmentSourceHotReloadEnabled) return
      watching = true
      // Watching begins only when this particular node is first used. A file
      // change merely invalidates its next run; it never restarts the backend.
      watch(sourceDirectory, { recursive: process.platform === "win32" || process.platform === "darwin" }, () => {
        revision += 1
      }).unref()
    }

    const loader: ModuleLoader = () => {
      ensureWatcher()
      const url = pathToFileURL(file)
      if (revision > 0) url.searchParams.set("xiranite-node-revision", String(revision))
      return import(url.href) as Promise<NodeModule>
    }
    loader.getRevision = () => {
      ensureWatcher()
      return revision
    }
    return loader
  }
  return productionLoader
}
