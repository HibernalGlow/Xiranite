export const DEFAULT_DISABLED_NODE_IDS = ["lata", "scoolp"] as const

export function getDefaultDisabledNodeIds(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return env.XIRANITE_INCLUDE_DISABLED_NODES === "1" ? [] : DEFAULT_DISABLED_NODE_IDS
}
