export type FrontendDisposition = "converted" | "adapter-needed" | "manual" | "replaced" | "blocked"

export interface SourceRevision {
  vcs: "git" | "none"
  commit: string | null
  dirty: boolean
  dirtyDiffHash: string | null
}

export interface SourceImport {
  source: string
  names: string[]
  typeOnly: boolean
}

export interface TauriCall {
  api: string
  importedFrom: string
  command: string | null
  line: number
}

export interface ComponentInventoryEntry {
  file: string
  hash: string
  disposition: FrontendDisposition
  classificationSource: "heuristic" | "config-override" | "parse-error"
  classificationReasons: string[]
  imports: SourceImport[]
  componentImports: string[]
  dynamicComponentImports: string[]
  tauriCalls: TauriCall[]
  runes: string[]
  props: string[]
  events: string[]
  contexts: string[]
  registrations: string[]
  templateFeatures: Record<string, number>
  scriptLanguages: string[]
  styleBlocks: number
  parseErrors: string[]
}

export interface StoreInventoryEntry {
  file: string
  hash: string
  imports: SourceImport[]
  exports: string[]
  primitives: string[]
  subscriptions: string[]
  storageKeys: string[]
  writes: string[]
  tauriCalls: TauriCall[]
  disposition: FrontendDisposition
  classificationReasons: string[]
  parseErrors: string[]
}

export interface ComponentGraphEdge {
  from: string
  to: string | null
  specifier: string
  kind: "static" | "dynamic"
}

export interface TauriUsageEntry {
  file: string
  imports: SourceImport[]
  calls: TauriCall[]
}

export interface FrontendInventorySummary {
  sourceFiles: number
  components: number
  stores: number
  graphEdges: number
  unresolvedComponentImports: number
  tauriFiles: number
  tauriCalls: number
  dispositions: Record<FrontendDisposition, number>
}

export interface SvelteFrontendInventory {
  schemaVersion: 1
  generator: { name: "@xiranite/svelte-migrate"; version: string }
  sourceRevision: SourceRevision
  sourceRoot: string
  summary: FrontendInventorySummary
  components: ComponentInventoryEntry[]
  stores: StoreInventoryEntry[]
  graph: { nodes: string[]; entries: string[]; edges: ComponentGraphEdge[]; cycles: string[][] }
  tauriUsage: TauriUsageEntry[]
}

export interface ClassificationOverride {
  pattern: string
  disposition: FrontendDisposition
  reason: string
}

export interface SvelteMigrationConfig {
  sourceRoot?: string
  classificationOverrides?: ClassificationOverride[]
}

export interface AnalyzeSvelteFrontendOptions extends SvelteMigrationConfig {
  projectRoot: string
}

export interface GenerateSvelteMigrationOptions extends AnalyzeSvelteFrontendOptions {
  outputDir: string
  force?: boolean
}
