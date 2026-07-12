export type NodeModule = Record<string, unknown>
export type ModuleLoader = () => Promise<NodeModule>

/** Keep node packages out of the desktop host build graph until first use. */
export function createNodeModuleLoader(moduleId: string): ModuleLoader {
  return () => import(moduleId) as Promise<NodeModule>
}
