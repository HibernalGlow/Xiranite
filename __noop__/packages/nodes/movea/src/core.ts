import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type MoveaAction = "scan" | "match" | "move_single" | "move"

export interface MoveaInput {
  action?: MoveaAction
  rootPath?: string
  regexPatterns?: string[]
  priorityKeywords?: string[]
  blacklist?: string[]
  allowMoveToUnnumbered?: boolean
  enableFolderMoving?: boolean
  level1Name?: string
  archiveName?: string
  subfolders?: string[]
  movePlan?: Record<string, string | null | undefined>
  dryRun?: boolean
}

export interface MoveaDirEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface MoveaScanItem {
  name: string
  path: string
  subfolders: string[]
  archives: string[]
  movableFolders: string[]
  warning?: string
}

export interface MoveaMoveItem {
  level1Name: string
  itemName: string
  itemType: "file" | "folder"
  sourcePath: string
  targetFolder: string
  targetPath: string
  success: boolean
  error?: string
}

export interface MoveaData {
  scanResults: Record<string, MoveaScanItem>
  matchedFolders: string[]
  moveItems: MoveaMoveItem[]
  totalFolders: number
  totalArchives: number
  totalMovableFolders: number
  moveSuccess: number
  moveFailed: number
  errors: string[]
}

export interface MoveaRuntime {
  exists: (path: string) => Promise<boolean>
  listDir: (path: string) => Promise<MoveaDirEntry[]>
  ensureDir: (path: string) => Promise<void>
  movePath: (source: string, target: string) => Promise<void>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
}

export type MoveaResult = NodeRunResult<MoveaData>

export const MOVEA_ARCHIVE_EXTENSIONS = [".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz"]
export const MOVEA_DEFAULT_PRIORITY_KEYWORDS = ["同人志", "doujinshi"]

export function normalizeMoveaInput(input: MoveaInput): Required<MoveaInput> {
  return {
    action: input.action ?? "scan",
    rootPath: clean(input.rootPath),
    regexPatterns: (input.regexPatterns ?? []).map((item) => item.trim()).filter(Boolean),
    priorityKeywords: (input.priorityKeywords ?? MOVEA_DEFAULT_PRIORITY_KEYWORDS).map((item) => item.trim()).filter(Boolean),
    blacklist: (input.blacklist ?? []).map((item) => item.trim()).filter(Boolean),
    allowMoveToUnnumbered: input.allowMoveToUnnumbered ?? false,
    enableFolderMoving: input.enableFolderMoving ?? true,
    level1Name: clean(input.level1Name),
    archiveName: clean(input.archiveName),
    subfolders: (input.subfolders ?? []).map((item) => item.trim()).filter(Boolean),
    movePlan: input.movePlan ?? {},
    dryRun: input.dryRun ?? false,
  }
}

export function isMoveaArchive(path: string): boolean {
  const lower = path.toLowerCase()
  return MOVEA_ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function isNumberedFolder(name: string): boolean {
  return /^\d+[\.)\]\s]*/.test(name) || /^\(\d+\)\s*/.test(name) || /^\[\d+\]\s*/.test(name)
}

export function matchMoveaArchiveToFolders(
  archiveName: string,
  subfolders: string[],
  regexPatterns: string[],
  allowMoveToUnnumbered = false,
  priorityKeywords: string[] = MOVEA_DEFAULT_PRIORITY_KEYWORDS,
): string[] {
  const matched = new Set<string>()
  const patterns = regexPatterns.length ? regexPatterns : [".*"]

  for (const folder of subfolders) {
    for (const pattern of patterns) {
      try {
        if (new RegExp(pattern, "i").test(archiveName)) {
          matched.add(folder)
          break
        }
      } catch {
        if (archiveName.toLowerCase().includes(pattern.toLowerCase())) {
          matched.add(folder)
          break
        }
      }
    }
  }

  if (allowMoveToUnnumbered) {
    for (const folder of subfolders) {
      if (!isNumberedFolder(folder)) matched.add(folder)
    }
  }

  const lowerKeywords = priorityKeywords.map((item) => item.toLowerCase())
  return [...matched].sort((a, b) => {
    const aPriority = lowerKeywords.some((keyword) => a.toLowerCase().includes(keyword))
    const bPriority = lowerKeywords.some((keyword) => b.toLowerCase().includes(keyword))
    if (aPriority !== bPriority) return aPriority ? -1 : 1
    return a.localeCompare(b)
  })
}

export function buildMoveaMoveTargets(
  level1Name: string,
  level1Path: string,
  movePlan: Record<string, string | null | undefined>,
  runtime: Pick<MoveaRuntime, "join">,
): MoveaMoveItem[] {
  const items: MoveaMoveItem[] = []
  for (const [itemKey, targetFolder] of Object.entries(movePlan)) {
    if (!targetFolder) continue
    const isFolder = itemKey.startsWith("folder_")
    const itemName = isFolder ? itemKey.slice("folder_".length) : itemKey
    const sourcePath = runtime.join(level1Path, itemName)
    const targetPath = runtime.join(level1Path, targetFolder, itemName)
    items.push({
      level1Name,
      itemName,
      itemType: isFolder ? "folder" : "file",
      sourcePath,
      targetFolder,
      targetPath,
      success: false,
    })
  }
  return items
}

export async function runMovea(
  input: MoveaInput,
  runtime: MoveaRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<MoveaResult> {
  const normalized = normalizeMoveaInput(input)
  try {
    if (normalized.action === "scan") return await scanMovea(normalized, runtime, onEvent)
    if (normalized.action === "match") return matchMovea(normalized)
    if (normalized.action === "move_single") return await moveSingle(normalized, runtime, onEvent)
    return await moveMany(normalized, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

async function scanMovea(input: Required<MoveaInput>, runtime: MoveaRuntime, onEvent: (event: NodeRunEvent) => void): Promise<MoveaResult> {
  if (!input.rootPath) return failure("Root path is required.")
  if (!await runtime.exists(input.rootPath)) return failure(`Root path does not exist: ${input.rootPath}`)

  onEvent({ type: "progress", progress: 10, message: `Scanning ${input.rootPath}` })
  const blacklist = new Set(input.blacklist)
  const rootEntries = (await runtime.listDir(input.rootPath)).filter((entry) => entry.isDirectory && !blacklist.has(entry.name))
  const scanResults: Record<string, MoveaScanItem> = {}

  for (let index = 0; index < rootEntries.length; index += 1) {
    const level1 = rootEntries[index]
    onEvent({ type: "progress", progress: 10 + Math.round((index / Math.max(rootEntries.length, 1)) * 80), message: `Scanning ${level1.name}` })
    const subfolders: string[] = []
    const archives: string[] = []
    const movableFolders: string[] = []

    for (const child of await runtime.listDir(level1.path)) {
      if (child.isDirectory) subfolders.push(child.name)
      else if (child.isFile && isMoveaArchive(child.name)) archives.push(child.name)
    }

    for (const folder of [...subfolders]) {
      if (!isNumberedFolder(folder)) {
        if (input.enableFolderMoving) movableFolders.push(folder)
        subfolders.splice(subfolders.indexOf(folder), 1)
      }
    }

    if (archives.length || movableFolders.length) {
      const hasPriority = subfolders.some((folder) => input.priorityKeywords.some((keyword) => folder.toLowerCase().includes(keyword.toLowerCase())))
      scanResults[level1.name] = {
        name: level1.name,
        path: level1.path,
        subfolders: subfolders.sort((a, b) => a.localeCompare(b)),
        archives: archives.sort((a, b) => a.localeCompare(b)),
        movableFolders: movableFolders.sort((a, b) => a.localeCompare(b)),
        ...(subfolders.length && !hasPriority ? { warning: "No priority target folder matched." } : {}),
        ...(!subfolders.length ? { warning: "No target folder matched." } : {}),
      }
    }
  }

  const totalArchives = Object.values(scanResults).reduce((sum, item) => sum + item.archives.length, 0)
  const totalMovableFolders = Object.values(scanResults).reduce((sum, item) => sum + item.movableFolders.length, 0)
  onEvent({ type: "progress", progress: 100, message: "Scan completed." })

  return success(`Scan completed: ${Object.keys(scanResults).length} folder(s), ${totalArchives} archive(s).`, {
    scanResults,
    totalFolders: Object.keys(scanResults).length,
    totalArchives,
    totalMovableFolders,
  })
}

function matchMovea(input: Required<MoveaInput>): MoveaResult {
  const matchedFolders = matchMoveaArchiveToFolders(
    input.archiveName,
    input.subfolders,
    input.regexPatterns,
    input.allowMoveToUnnumbered,
    input.priorityKeywords,
  )
  return success(`Matched ${matchedFolders.length} folder(s).`, { matchedFolders })
}

async function moveSingle(input: Required<MoveaInput>, runtime: MoveaRuntime, onEvent: (event: NodeRunEvent) => void): Promise<MoveaResult> {
  if (!input.rootPath || !input.level1Name) return failure("Root path and level1 name are required.")
  const level1Path = runtime.join(input.rootPath, input.level1Name)
  if (!await runtime.exists(level1Path)) return failure(`Level1 folder does not exist: ${level1Path}`)

  const moveItems = buildMoveaMoveTargets(input.level1Name, level1Path, input.movePlan, runtime)
  let moveSuccess = 0
  let moveFailed = 0
  const completed: MoveaMoveItem[] = []

  for (let index = 0; index < moveItems.length; index += 1) {
    const item = moveItems[index]
    onEvent({ type: "progress", progress: Math.round((index / Math.max(moveItems.length, 1)) * 100), message: `Moving ${item.itemName}` })
    if (input.dryRun) {
      completed.push({ ...item, success: true })
      moveSuccess += 1
      continue
    }
    try {
      await runtime.ensureDir(runtime.dirname(item.targetPath))
      await runtime.movePath(item.sourcePath, item.targetPath)
      completed.push({ ...item, success: true })
      moveSuccess += 1
    } catch (error) {
      completed.push({ ...item, success: false, error: error instanceof Error ? error.message : String(error) })
      moveFailed += 1
    }
  }

  onEvent({ type: "progress", progress: 100, message: "Move completed." })
  return {
    success: moveFailed === 0,
    message: `${input.dryRun ? "Move dry-run" : "Move completed"}: ${moveSuccess} success, ${moveFailed} failed.`,
    data: data({ moveItems: completed, moveSuccess, moveFailed }),
  }
}

async function moveMany(input: Required<MoveaInput>, runtime: MoveaRuntime, onEvent: (event: NodeRunEvent) => void): Promise<MoveaResult> {
  if (!input.movePlan || typeof input.movePlan !== "object") return failure("Move plan is required.")
  return moveSingle({ ...input, action: "move_single" }, runtime, onEvent)
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function data(partial: Partial<MoveaData>): MoveaData {
  return {
    scanResults: {},
    matchedFolders: [],
    moveItems: [],
    totalFolders: 0,
    totalArchives: 0,
    totalMovableFolders: 0,
    moveSuccess: 0,
    moveFailed: 0,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<MoveaData>): MoveaResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): MoveaResult {
  return { success: false, message, data: data({ errors: [message], moveFailed: 1 }) }
}
