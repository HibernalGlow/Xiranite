import type { AppNodeEntry, HeadlessNodePackage } from "@xiranite/contract"
import type { MainWindowAction } from "@/backend/runtime/runtime"
import { packageModuleLoaders } from "./packageModules.generated"

type PackageModuleEntry = AppNodeEntry | HeadlessNodePackage
type PackageModuleLoader = () => Promise<{ default: PackageModuleEntry }>

const packageNodeLoaders = packageModuleLoaders as Readonly<Record<string, PackageModuleLoader>>

export function resolveNodeMaximizeAction(entry: PackageModuleEntry): MainWindowAction {
  return "window" in entry && entry.window?.maximizeBehavior === "fullscreen"
    ? "toggle-fullscreen"
    : "maximize"
}

export async function loadNodeMaximizeAction(moduleId: string): Promise<MainWindowAction> {
  const loader = packageNodeLoaders[moduleId]
  if (!loader) return "maximize"
  return resolveNodeMaximizeAction((await loader()).default)
}
