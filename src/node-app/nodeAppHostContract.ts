import type { NodeCapabilityId } from "@xiranite/contract"

export const NODE_APP_HOST_CAPABILITIES: readonly NodeCapabilityId[] = [
  "contract",
  "state",
  "runner",
  "clipboard",
  "downloads",
  "localFiles",
  "config",
  "env",
]

export function nodeAppHostHasCapability(capability: NodeCapabilityId): boolean {
  return NODE_APP_HOST_CAPABILITIES.includes(capability)
}
