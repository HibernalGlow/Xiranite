import { nodeHelpLoaders } from "@/components/modules/packageModules.generated"

export function hasNodeHelp(moduleId: string | null | undefined): boolean {
  return Boolean(moduleId && nodeHelpLoaders[moduleId])
}

export function getNodeHelpLoader(moduleId: string) {
  return nodeHelpLoaders[moduleId]
}
