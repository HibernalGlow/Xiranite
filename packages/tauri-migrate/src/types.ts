export type MigrationDisposition = "typescript-portable" | "native-required" | "manual-review"

export interface SourceLocation {
  file: string
  line: number
  column: number
}

export interface RustParameter {
  name: string
  rustType: string
  tsType: string
  tauriInjected: boolean
}

export interface TauriEvent {
  name: string | null
  expression: string
  location: SourceLocation
}

export interface TauriCommand {
  name: string
  rustPath: string
  parameters: RustParameter[]
  returnType: string
  tsReturnType: string
  async: boolean
  registered: boolean
  stateTypes: string[]
  usesAppHandle: boolean
  events: TauriEvent[]
  calls: string[]
  nativeReasons: string[]
  disposition: MigrationDisposition
  classificationSource: "ast-evidence" | "default" | "config-override"
  location: SourceLocation
}

export interface TauriMigrationInventory {
  schemaVersion: 2
  generator: {
    name: "@xiranite/tauri-migrate"
    version: string
  }
  sourceRevision: {
    vcs: "git" | "none"
    commit: string | null
    dirty: boolean
    dirtyDiffHash: string | null
  }
  projectRoot: string
  sourceRoots: string[]
  analyzedAt: string
  rustFiles: number
  commands: TauriCommand[]
  registeredCommands: string[]
  unannotatedRegistrations: string[]
  summary: Record<MigrationDisposition, number>
}

export interface AnalyzeTauriProjectOptions {
  projectRoot: string
  sourceRoots?: string[]
  nativeMarkers?: string[]
  commandOverrides?: Record<string, MigrationDisposition>
}

export interface TauriMigrationConfig {
  sourceRoots?: string[]
  nativeMarkers?: string[]
  commandOverrides?: Record<string, MigrationDisposition>
}

export interface GenerateMigrationOptions extends AnalyzeTauriProjectOptions {
  outputDir: string
  force?: boolean
}
