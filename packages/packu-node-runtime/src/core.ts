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
}

export interface PackuToolData {
  spec: PackuToolSpec
  command: PackuCommandPlan
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
  return {
    action: input.action ?? "status",
    paths: uniqueClean([input.path, ...(input.paths ?? [])]),
    path: clean(input.path),
    args: input.args ?? [],
    configPath: clean(input.configPath),
    configText: input.configText ?? "",
    databasePath: clean(input.databasePath),
    python: clean(input.python) || "python",
    sourceRoot: clean(input.sourceRoot) || spec.sourceRoot,
    moduleName: clean(input.moduleName) || spec.moduleName,
    dryRun: input.dryRun ?? false,
    recordRun: input.recordRun ?? Boolean(input.databasePath),
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
    const database = normalized.databasePath
      ? { toolId: spec.id, databasePath: normalized.databasePath, enabled: normalized.recordRun, mode: "jsonl" as const }
      : undefined

    if (normalized.action !== "run" || normalized.dryRun) {
      return success(`PackU ${spec.id} planned.`, spec, { command, config, database, selectedPaths: normalized.paths })
    }

    onEvent({ type: "progress", progress: 65, message: `Running ${spec.id}.` })
    const commandResult = await runtime.runCommand(command)
    if (database?.enabled) {
      await runtime.appendRecord(database.databasePath, {
        toolId: spec.id,
        command,
        selectedPaths: normalized.paths,
        success: commandResult.code === 0,
        code: commandResult.code,
        at: new Date().toISOString(),
      })
    }
    return {
      success: commandResult.code === 0,
      message: commandResult.code === 0 ? `PackU ${spec.id} completed.` : `PackU ${spec.id} failed.`,
      data: data(spec, {
        command,
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
