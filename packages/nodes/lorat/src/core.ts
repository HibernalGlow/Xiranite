import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export const DEFAULT_LORA_FOLDER = "D:\\1Repo\\Github\\ComfyUI\\Library\\models\\loras"
export const LORAT_MODEL_EXTS = [".safetensors", ".ckpt", ".pt"] as const

export type LoratAction = "scan" | "apply_db" | "write_triggers" | "mark_no_trigger" | "export_db"
export type LoratStatus = "missing" | "trigger" | "notrigger"
export type LoratScopeFilter = "all" | "self" | "at"
export type LoratStatusFilter = "all" | LoratStatus

export interface LoratInput {
  action?: LoratAction
  folderPath?: string
  triggerDbJson?: string
  rows?: LoratRow[]
  selectedKeys?: string[]
  search?: string
  statusFilter?: LoratStatusFilter
  scopeFilter?: LoratScopeFilter
}

export interface LoratScannedModel {
  name: string
  stem: string
  filePath: string
  relativeDir: string
  relativePath: string
  pathParts: string[]
  triggerText: string | null
  noTriggerText: string | null
  fileId?: string
}

export interface LoratRow {
  key: string
  name: string
  stem: string
  filePath: string
  relativeDir: string
  relativePath: string
  pathParts: string[]
  status: LoratStatus
  originalStatus: LoratStatus
  trigger: string
  originalTrigger: string
  source: string
  dbKey: string
  changed: boolean
  selected?: boolean
  fileId?: string
}

export interface LoratStats {
  total: number
  missing: number
  trigger: number
  notrigger: number
  changed: number
  selected: number
  dbMatched: number
}

export interface LoratData {
  folderPath: string
  rows: LoratRow[]
  stats: LoratStats
  triggerDbJson: string
  writtenCount: number
  skippedCount: number
  errors: string[]
}

export interface LoratRuntime {
  scanModels: (folderPath: string) => Promise<LoratScannedModel[]>
  writeTrigger: (row: LoratRow, trigger: string) => Promise<void>
  writeNoTrigger: (row: LoratRow) => Promise<void>
}

export type LoratResult = NodeRunResult<LoratData>
export type TriggerDb = Record<string, unknown>

export async function runLorat(
  input: LoratInput,
  runtime: LoratRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<LoratResult> {
  const action = input.action ?? "scan"
  const folderPath = cleanPath(input.folderPath) || DEFAULT_LORA_FOLDER

  try {
    if (action === "scan") {
      onEvent({ type: "progress", progress: 5, message: `Scanning ${folderPath}` })
      const scanned = await runtime.scanModels(folderPath)
      const rows = buildLoratRows(scanned, parseTriggerDb(input.triggerDbJson))
      onEvent({ type: "progress", progress: 100, message: `Found ${rows.length} LoRA model(s).` })
      return success(`Found ${rows.length} LoRA model(s).`, { folderPath, rows })
    }

    if (action === "apply_db") {
      const rows = applyTriggerDb(input.rows ?? [], parseTriggerDb(input.triggerDbJson))
      return success(`Applied TriggerDB to ${rows.filter((row) => row.dbKey).length} row(s).`, { folderPath, rows })
    }

    if (action === "export_db") {
      const db = collectTriggerDb(input.rows ?? [], parseTriggerDb(input.triggerDbJson))
      return success(`Exported ${Object.keys(db).length} TriggerDB entrie(s).`, {
        folderPath,
        rows: input.rows ?? [],
        triggerDbJson: `${JSON.stringify(db, null, 2)}\n`,
      })
    }

    const rows = selectedRows(input.rows ?? [], input.selectedKeys)
    if (!rows.length) return failure("No selected rows.", folderPath, input.rows ?? [])

    let writtenCount = 0
    let skippedCount = 0
    const errors: string[] = []
    for (const [index, row] of rows.entries()) {
      onEvent({
        type: "progress",
        progress: Math.round((index / Math.max(rows.length, 1)) * 100),
        message: row.relativePath,
      })
      try {
        if (action === "mark_no_trigger") {
          await runtime.writeNoTrigger(row)
        } else {
          const trigger = row.trigger.trim()
          if (!trigger) {
            skippedCount += 1
            continue
          }
          await runtime.writeTrigger(row, trigger)
        }
        writtenCount += 1
      } catch (error) {
        errors.push(`${row.relativePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const updatedRows = applyWriteResult(input.rows ?? [], rows, action)
    onEvent({ type: "progress", progress: 100, message: `Updated ${writtenCount} row(s).` })
    return {
      success: errors.length === 0,
      message: errors.length ? `Updated ${writtenCount} row(s), ${errors.length} failed.` : `Updated ${writtenCount} row(s).`,
      data: data({ folderPath, rows: updatedRows, writtenCount, skippedCount, errors }),
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error), folderPath, input.rows ?? [])
  }
}

export function buildLoratRows(models: LoratScannedModel[], db: TriggerDb = {}): LoratRow[] {
  const rows = models.map((model) => {
    const guess = inferTrigger(model.name, model.pathParts)
    const sidecarTrigger = model.triggerText?.trim() ?? ""
    const status: LoratStatus = sidecarTrigger ? "trigger" : model.noTriggerText !== null ? "notrigger" : "missing"
    const trigger = sidecarTrigger || guess.trigger
    return {
      key: rowKey(model.relativeDir, model.stem),
      name: model.name,
      stem: model.stem,
      filePath: model.filePath,
      relativeDir: model.relativeDir,
      relativePath: model.relativePath,
      pathParts: model.pathParts,
      status,
      originalStatus: status,
      trigger,
      originalTrigger: trigger,
      source: sidecarTrigger ? "sidecar" : model.noTriggerText !== null ? "notrigger" : guess.source,
      dbKey: "",
      changed: false,
      fileId: model.fileId,
    } satisfies LoratRow
  })
  return applyTriggerDb(rows, db)
}

export function applyTriggerDb(rows: LoratRow[], db: TriggerDb = {}): LoratRow[] {
  return rows.map((row) => {
    const hit = findDbEntry(row, db)
    const trigger = hit ? normalizeDbTrigger(hit.entry) : ""
    if (!hit || !trigger) return { ...row, dbKey: hit?.key ?? row.dbKey }
    return {
      ...row,
      dbKey: hit.key,
      trigger,
      originalTrigger: trigger,
      status: "trigger",
      originalStatus: "trigger",
      source: "json",
      changed: false,
    }
  })
}

export function collectTriggerDb(rows: LoratRow[], baseDb: TriggerDb = {}): TriggerDb {
  const db: TriggerDb = { ...baseDb }
  for (const row of rows) {
    const key = row.dbKey || row.key
    const trigger = row.trigger.trim()
    if (row.status === "trigger" && trigger) {
      const old = db[key] && typeof db[key] === "object" && !Array.isArray(db[key]) ? db[key] as Record<string, unknown> : {}
      db[key] = {
        ...old,
        all_triggers: trigger,
        active_triggers: trigger,
        ...(row.fileId || old.file_id ? { file_id: old.file_id || row.fileId } : {}),
      }
    } else if (row.dbKey) {
      delete db[row.dbKey]
    }
  }
  return db
}

export function filterLoratRows(
  rows: LoratRow[],
  options: { search?: string; statusFilter?: LoratStatusFilter; scopeFilter?: LoratScopeFilter } = {},
): LoratRow[] {
  const query = (options.search ?? "").trim().toLowerCase()
  const statusFilter = options.statusFilter ?? "all"
  const scopeFilter = options.scopeFilter ?? "all"
  return rows.filter((row) => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false
    if (scopeFilter === "self" && !row.pathParts.some((part) => part.toLowerCase() === "self")) return false
    if (scopeFilter === "at" && !row.pathParts.some((part) => part.startsWith("@"))) return false
    if (!query) return true
    return `${row.name} ${row.relativeDir} ${row.trigger}`.toLowerCase().includes(query)
  })
}

export function summarizeLoratRows(rows: LoratRow[]): LoratStats {
  const stats: LoratStats = {
    total: rows.length,
    missing: 0,
    trigger: 0,
    notrigger: 0,
    changed: 0,
    selected: 0,
    dbMatched: 0,
  }
  for (const row of rows) {
    stats[row.status] += 1
    if (row.changed) stats.changed += 1
    if (row.selected) stats.selected += 1
    if (row.dbKey) stats.dbMatched += 1
  }
  return stats
}

export function parseTriggerDb(json?: string): TriggerDb {
  const text = (json ?? "").trim()
  if (!text) return {}
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("TriggerDB JSON must be an object.")
  return parsed as TriggerDb
}

export function inferTrigger(fileName: string, pathParts: string[]): { trigger: string; source: string } {
  const stem = basenameNoExt(fileName)
  const atInFile = stem.match(/@[A-Za-z0-9_ -]*[A-Za-z0-9_]/)
  if (atInFile) return { trigger: cleanToken(atInFile[0]), source: "filename @" }
  for (let index = pathParts.length - 1; index >= 0; index -= 1) {
    const part = pathParts[index]
    if (part?.startsWith("@")) return { trigger: cleanToken(part), source: "folder @" }
  }
  const parent = pathParts.at(-1) || ""
  if (parent && !["loras", "artist", "anima", "self"].includes(parent.toLowerCase())) {
    return { trigger: cleanToken(parent), source: "folder" }
  }
  return { trigger: cleanToken(stem), source: "filename" }
}

export function rowKey(relativeDir: string, stem: string): string {
  return [normalizePathKey(relativeDir), stem].filter(Boolean).join("/")
}

export function normalizePathKey(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
}

function findDbEntry(row: LoratRow, db: TriggerDb): { key: string; entry: unknown } | null {
  const direct = row.key
  if (Object.hasOwn(db, direct)) return { key: direct, entry: db[direct] }
  const keys = Object.keys(db)
  const suffixMatches = keys.filter((key) => normalizePathKey(key).endsWith(`/${direct}`))
  if (suffixMatches.length === 1) return { key: suffixMatches[0]!, entry: db[suffixMatches[0]!] }
  const stemMatches = keys.filter((key) => normalizePathKey(key).split("/").pop() === row.stem)
  return stemMatches.length === 1 ? { key: stemMatches[0]!, entry: db[stemMatches[0]!] } : null
}

function normalizeDbTrigger(entry: unknown): string {
  if (typeof entry === "string") return entry.trim()
  if (!entry || typeof entry !== "object") return ""
  const record = entry as Record<string, unknown>
  return String(record.active_triggers || record.all_triggers || "").trim()
}

function applyWriteResult(rows: LoratRow[], writtenRows: LoratRow[], action: LoratAction): LoratRow[] {
  const written = new Set(writtenRows.map((row) => row.key))
  return rows.map((row) => {
    if (!written.has(row.key)) return row
    if (action === "mark_no_trigger") {
      return { ...row, status: "notrigger", originalStatus: "notrigger", source: "written", changed: false }
    }
    const trigger = row.trigger.trim()
    return { ...row, trigger, originalTrigger: trigger, status: "trigger", originalStatus: "trigger", source: "written", changed: false }
  })
}

function selectedRows(rows: LoratRow[], selectedKeys?: string[]): LoratRow[] {
  const keys = new Set(selectedKeys?.filter(Boolean) ?? [])
  if (keys.size) return rows.filter((row) => keys.has(row.key))
  return rows.filter((row) => row.selected)
}

function basenameNoExt(name: string): string {
  const lower = name.toLowerCase()
  const ext = LORAT_MODEL_EXTS.find((item) => lower.endsWith(item))
  return ext ? name.slice(0, -ext.length) : name
}

function cleanToken(value: string): string {
  let text = stripTrainingSuffix(String(value).trim().replace(/\.(safetensors|ckpt|pt)$/i, ""))
  text = text.replace(/\b(anima|lora|loras|self|artist|style)\b/ig, (match) => (
    match.toLowerCase() === "style" && /@.*style/i.test(text) ? match : ""
  ))
  return text.replace(/[()[\]{}]/g, " ").replace(/\s+/g, " ").trim()
}

function stripTrainingSuffix(value: string): string {
  return value
    .replace(/[-_ ]?step\d{3,}$/i, "")
    .replace(/[-_ ]?\d{3,}$/i, "")
    .replace(/[-_ ]?epoch\d+$/i, "")
    .replace(/[-_ ]?v\d+(\.\d+)?$/i, "")
    .replace(/[-_ ]?final$/i, "")
    .replace(/[-_ ]?merged$/i, "")
    .trim()
}

function cleanPath(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function data(partial: Partial<LoratData>): LoratData {
  const rows = partial.rows ?? []
  const stats = partial.stats ?? summarizeLoratRows(rows)
  return {
    folderPath: "",
    rows,
    stats,
    triggerDbJson: "",
    writtenCount: 0,
    skippedCount: 0,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<LoratData>): LoratResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string, folderPath = "", rows: LoratRow[] = []): LoratResult {
  return { success: false, message, data: data({ folderPath, rows, errors: [message] }) }
}
