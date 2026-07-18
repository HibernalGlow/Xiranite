import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type PackuToolAction = "status" | "plan" | "run"

export interface PackuToolSpec {
  id: string
  moduleName: string
  sourceRoot: string
  defaultArgs?: string[]
  configFiles?: string[]
  databaseLabel?: string
}

export interface PackuToolInput {
  action?: PackuToolAction
  paths?: string[]
  path?: string
  args?: string[]
  configPath?: string
  configText?: string
  databasePath?: string
  python?: string
  sourceRoot?: string
  moduleName?: string
  dryRun?: boolean
  recordRun?: boolean
}

export interface PackuCommandPlan {
  label: string
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export interface PackuConfigSummary {
  path: string
  keys: string[]
  tables: string[]
}

export interface PackuDatabaseRecord {
  toolId: string
  databasePath: string
  enabled: boolean
  mode: "jsonl"
  label?: string
  defaultPath: boolean
}

export interface PackuIntegrationProfile {
  sourceRoot: string
  moduleName: string
  configCandidates: string[]
  databasePath?: string
  databaseLabel?: string
  recordRun: boolean
  recordFormat: "jsonl"
}

export interface PackuToolData {
  spec: PackuToolSpec
  command: PackuCommandPlan
  integration: PackuIntegrationProfile
  config?: PackuConfigSummary
  database?: PackuDatabaseRecord
  commandResult?: CommandResult
  selectedPaths: string[]
  errors: string[]
}

export interface PackuToolRuntime {
  readText: (path: string) => Promise<string>
  runCommand: (plan: PackuCommandPlan) => Promise<CommandResult>
  appendRecord: (path: string, record: unknown) => Promise<void>
}

export type PackuToolResult = NodeRunResult<PackuToolData>

export function normalizePackuToolInput(input: PackuToolInput, spec: PackuToolSpec): Required<PackuToolInput> {
  const explicitDatabasePath = clean(input.databasePath)
  return {
    action: input.action ?? "status",
    paths: uniqueClean([input.path, ...(input.paths ?? [])]),
    path: clean(input.path),
    args: input.args ?? [],
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    databasePath: explicitDatabasePath,
    python: clean(input.python) || "python",
    sourceRoot: clean(input.sourceRoot) || spec.sourceRoot,
    moduleName: clean(input.moduleName) || spec.moduleName,
    dryRun: input.dryRun ?? false,
    recordRun: input.recordRun ?? Boolean(explicitDatabasePath),
  }
}

export async function runPackuTool(
  spec: PackuToolSpec,
  input: PackuToolInput,
  runtime: PackuToolRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<PackuToolResult> {
  const normalized = normalizePackuToolInput(input, spec)
  try {
    onEvent({ type: "progress", progress: 20, message: `Planning ${spec.id}.` })
    const config = await loadConfigSummary(normalized, runtime)
    const command = buildPackuCommand(spec, normalized)
    const integration = buildPackuIntegrationProfile(spec, normalized)
    const database = integration.databasePath
      ? {
          toolId: spec.id,
          databasePath: integration.databasePath,
          enabled: normalized.recordRun,
          mode: "jsonl" as const,
          label: spec.databaseLabel,
          defaultPath: !normalized.databasePath,
        }
      : undefined

    if (normalized.action !== "run" || normalized.dryRun) {
      return success(`PackU ${spec.id} planned.`, spec, { command, integration, config, database, selectedPaths: normalized.paths })
    }

    onEvent({ type: "progress", progress: 65, message: `Running ${spec.id}.` })
    const commandResult = await runtime.runCommand(command)
    if (database?.enabled) {
      await runtime.appendRecord(database.databasePath, buildPackuRunRecord(spec, normalized, command, commandResult, config, database))
    }
    return {
      success: commandResult.code === 0,
      message: commandResult.code === 0 ? `PackU ${spec.id} completed.` : `PackU ${spec.id} failed.`,
      data: data(spec, {
        command,
        integration,
        config,
        database,
        commandResult,
        selectedPaths: normalized.paths,
        errors: commandResult.code === 0 ? [] : [commandResult.stderr || commandResult.stdout],
      }),
    }
  } catch (error) {
    return failure(spec, error instanceof Error ? error.message : String(error))
  }
}

export function buildPackuIntegrationProfile(spec: PackuToolSpec, input: Required<PackuToolInput>): PackuIntegrationProfile {
  const databasePath = input.databasePath || defaultPackuDatabasePath(spec, input)
  return {
    sourceRoot: input.sourceRoot,
    moduleName: input.moduleName,
    configCandidates: configCandidates(spec, input),
    databasePath,
    databaseLabel: spec.databaseLabel,
    recordRun: input.recordRun,
    recordFormat: "jsonl",
  }
}

export function defaultPackuDatabasePath(spec: PackuToolSpec, input: Required<Pick<PackuToolInput, "sourceRoot">>): string | undefined {
  if (!spec.databaseLabel) return undefined
  return joinPath(input.sourceRoot, ".xiranite", `${spec.id}-runs.jsonl`)
}

export function configCandidates(spec: PackuToolSpec, input: Required<Pick<PackuToolInput, "sourceRoot">>): string[] {
  return (spec.configFiles ?? []).map((path) => isAbsolutePathLike(path) ? path : joinPath(input.sourceRoot, path))
}

export function buildPackuRunRecord(
  spec: PackuToolSpec,
  input: Required<PackuToolInput>,
  command: PackuCommandPlan,
  commandResult: CommandResult,
  config: PackuConfigSummary | undefined,
  database: PackuDatabaseRecord,
): Record<string, unknown> {
  return {
    toolId: spec.id,
    databaseLabel: database.label,
    command,
    config,
    selectedPaths: input.paths,
    success: commandResult.code === 0,
    code: commandResult.code,
    stdoutLength: commandResult.stdout.length,
    stderrLength: commandResult.stderr.length,
    at: new Date().toISOString(),
  }
}

export function joinPath(...parts: string[]): string {
  const cleaned = parts.map((part, index) => {
    const value = clean(part)
    if (!value) return ""
    if (index === 0) return value.replace(/[\\/]+$/g, "")
    return value.replace(/^[\\/]+|[\\/]+$/g, "")
  }).filter(Boolean)
  if (cleaned.length === 0) return ""
  return cleaned.join("/")
}

function isAbsolutePathLike(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]/.test(path)
}

export function buildPackuCommand(spec: PackuToolSpec, input: Required<PackuToolInput>): PackuCommandPlan {
  const args = ["-m", input.moduleName, ...(spec.defaultArgs ?? []), ...input.args, ...input.paths]
  return {
    label: `python -m ${input.moduleName}`,
    command: input.python,
    args,
    cwd: input.sourceRoot,
    env: { PYTHONPATH: input.sourceRoot },
  }
}

export async function loadConfigSummary(input: Required<PackuToolInput>, runtime: Pick<PackuToolRuntime, "readText">): Promise<PackuConfigSummary | undefined> {
  const text = input.configText || (input.configPath ? await runtime.readText(input.configPath) : "")
  if (!text.trim()) return undefined
  const parsed = parseTomlLikeKeys(text)
  return { path: input.configPath, keys: parsed.keys, tables: parsed.tables }
}

export function parseTomlLikeKeys(text: string): { keys: string[]; tables: string[] } {
  const keys = new Set<string>()
  const tables = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const table = /^\[+([^\]]+)\]+$/.exec(line)
    if (table) {
      tables.add(table[1]!.trim())
      continue
    }
    const index = line.indexOf("=")
    if (index > 0) keys.add(line.slice(0, index).trim())
  }
  return { keys: [...keys].sort(), tables: [...tables].sort() }
}

function data(spec: PackuToolSpec, partial: Partial<PackuToolData>): PackuToolData {
  return {
    spec,
    command: partial.command ?? { label: "", command: "", args: [] },
    integration: partial.integration ?? {
      sourceRoot: spec.sourceRoot,
      moduleName: spec.moduleName,
      configCandidates: [],
      databaseLabel: spec.databaseLabel,
      recordRun: false,
      recordFormat: "jsonl",
    },
    selectedPaths: [],
    errors: [],
    ...partial,
  }
}

function success(message: string, spec: PackuToolSpec, partial: Partial<PackuToolData>): PackuToolResult {
  return { success: true, message, data: data(spec, partial) }
}

function failure(spec: PackuToolSpec, message: string): PackuToolResult {
  return { success: false, message, data: data(spec, { errors: [message] }) }
}

function uniqueClean(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}
