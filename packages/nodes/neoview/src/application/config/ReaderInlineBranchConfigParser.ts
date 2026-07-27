import type { NeoviewFolderPenetrationConfig } from "./ReaderFolderPenetrationConfig.js"

type InlineBranchConfig = Pick<
  NeoviewFolderPenetrationConfig,
  "expandBranchesInline" | "inlineBranchLimitsEnabled" | "inlineBranchMaxDirectories" | "inlineBranchMaxFiles" | "inlineBranchMaxItems"
>

export function parseInlineBranchConfigPatch(penetration: Record<string, unknown>): {
  patch: Partial<InlineBranchConfig>
  tomlPatch: Record<string, boolean | number>
} {
  const patch: Partial<InlineBranchConfig> = {}
  const tomlPatch: Record<string, boolean | number> = {}
  if (penetration.expandBranchesInline !== undefined) {
    patch.expandBranchesInline = optionalBoolean(penetration.expandBranchesInline, "reader folder view patch.penetration.expandBranchesInline")
    tomlPatch.expand_branches_inline = patch.expandBranchesInline
  }
  if (penetration.inlineBranchLimitsEnabled !== undefined) {
    patch.inlineBranchLimitsEnabled = optionalBoolean(penetration.inlineBranchLimitsEnabled, "reader folder view patch.penetration.inlineBranchLimitsEnabled")
    tomlPatch.inline_branch_limits_enabled = patch.inlineBranchLimitsEnabled
  }
  addLimit(penetration.inlineBranchMaxDirectories, "inlineBranchMaxDirectories", "inline_branch_max_directories", patch, tomlPatch)
  addLimit(penetration.inlineBranchMaxFiles, "inlineBranchMaxFiles", "inline_branch_max_files", patch, tomlPatch)
  addLimit(penetration.inlineBranchMaxItems, "inlineBranchMaxItems", "inline_branch_max_items", patch, tomlPatch)
  return { patch, tomlPatch }
}

export function readInlineBranchConfig(source: Record<string, unknown> | undefined, defaults: InlineBranchConfig): InlineBranchConfig {
  return {
    expandBranchesInline: readBoolean(source, "expand_branches_inline", "expandBranchesInline", defaults.expandBranchesInline),
    inlineBranchLimitsEnabled: readBoolean(source, "inline_branch_limits_enabled", "inlineBranchLimitsEnabled", defaults.inlineBranchLimitsEnabled),
    inlineBranchMaxDirectories: readLimit(source, "inline_branch_max_directories", "inlineBranchMaxDirectories", defaults.inlineBranchMaxDirectories),
    inlineBranchMaxFiles: readLimit(source, "inline_branch_max_files", "inlineBranchMaxFiles", defaults.inlineBranchMaxFiles),
    inlineBranchMaxItems: readLimit(source, "inline_branch_max_items", "inlineBranchMaxItems", defaults.inlineBranchMaxItems),
  }
}

function addLimit(
  value: unknown,
  property: Exclude<keyof InlineBranchConfig, "expandBranchesInline" | "inlineBranchLimitsEnabled">,
  tomlProperty: string,
  patch: Partial<InlineBranchConfig>,
  tomlPatch: Record<string, boolean | number>,
): void {
  if (value === undefined) return
  const parsed = boundedInlineBranchLimit(value, `reader folder view patch.penetration.${property}`)
  patch[property] = parsed
  tomlPatch[tomlProperty] = parsed
}

function readLimit(source: Record<string, unknown> | undefined, snakeCase: string, camelCase: string, fallback: number): number {
  const value = source?.[snakeCase] ?? source?.[camelCase]
  return value === undefined ? fallback : boundedInlineBranchLimit(value, `[nodes.neoview.folder.penetration].${snakeCase}`)
}

function readBoolean(source: Record<string, unknown> | undefined, snakeCase: string, camelCase: string, fallback: boolean): boolean {
  const value = source?.[snakeCase] ?? source?.[camelCase]
  return value === undefined ? fallback : optionalBoolean(value, `[nodes.neoview.folder.penetration].${snakeCase}`)
}

function optionalBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`)
  return value
}

function boundedInlineBranchLimit(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new Error(`${path} must be an integer between 0 and 100.`)
  }
  return value
}
