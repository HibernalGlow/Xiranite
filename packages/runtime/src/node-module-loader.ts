import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export type NodeModule = Record<string, unknown>
export type ModuleLoader = () => Promise<NodeModule>

interface DevelopmentSource {
  nodeId: string
  entry: "core" | "platform"
}

/**
 * Development nodes run from source through Bun, so first interaction does
 * not wait for a TypeScript package build. Production continues using dist.
 */
export function createNodeModuleLoader(moduleId: string, source?: DevelopmentSource): ModuleLoader {
  if (source && process.env.XIRANITE_NODE_SOURCE === "1") {
    const file = resolve(import.meta.dirname, "../../..", "packages", "nodes", source.nodeId, "src", `${source.entry}.ts`)
    return () => import(pathToFileURL(file).href) as Promise<NodeModule>
  }
  return () => import(moduleId) as Promise<NodeModule>
}
