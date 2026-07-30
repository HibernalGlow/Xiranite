import type { ReaderFolderMigrationTarget } from "../../../../adapters/reader-http-client"

export const MAX_FOLDER_MIGRATION_TARGETS = 16

export function createFolderMigrationTarget(
  path: string,
  id: string,
  existing: readonly ReaderFolderMigrationTarget[],
): ReaderFolderMigrationTarget {
  const baseName = folderNameFromPath(path) || "新目录"
  const names = new Set(existing.map((target) => target.name.trim().toLowerCase()))
  let name = baseName
  for (let suffix = 2; names.has(name.toLowerCase()); suffix += 1) name = `${baseName} ${suffix}`
  return { id, name, path: path.trim() }
}

export function updateFolderMigrationTarget(
  targets: readonly ReaderFolderMigrationTarget[],
  id: string,
  patch: Partial<Pick<ReaderFolderMigrationTarget, "name" | "path">>,
): ReaderFolderMigrationTarget[] {
  return targets.map((target) => target.id === id ? { ...target, ...patch } : target)
}

export function moveFolderMigrationTarget(
  targets: readonly ReaderFolderMigrationTarget[],
  id: string,
  offset: -1 | 1,
): ReaderFolderMigrationTarget[] {
  const index = targets.findIndex((target) => target.id === id)
  const destination = index + offset
  if (index < 0 || destination < 0 || destination >= targets.length) return [...targets]
  const next = [...targets]
  const [target] = next.splice(index, 1)
  next.splice(destination, 0, target)
  return next
}

export function removeFolderMigrationTarget(
  targets: readonly ReaderFolderMigrationTarget[],
  id: string,
): ReaderFolderMigrationTarget[] {
  return targets.filter((target) => target.id !== id)
}

export function normalizeFolderMigrationTargets(
  targets: readonly ReaderFolderMigrationTarget[],
): ReaderFolderMigrationTarget[] {
  return targets.map((target) => ({
    id: target.id.trim(),
    name: target.name.trim(),
    path: target.path.trim(),
  }))
}

export function validateFolderMigrationTargets(
  targets: readonly ReaderFolderMigrationTarget[],
): string | undefined {
  if (targets.length > MAX_FOLDER_MIGRATION_TARGETS) return `常用目录不能超过 ${MAX_FOLDER_MIGRATION_TARGETS} 个。`
  const ids = new Set<string>()
  const paths = new Set<string>()
  for (const target of targets) {
    const id = target.id.trim()
    const name = target.name.trim()
    const path = target.path.trim()
    if (!id || id.length > 128 || id.includes("\0")) return "常用目录标识无效。"
    if (!name) return "目录名称不能为空。"
    if (name.length > 128 || name.includes("\0")) return "目录名称不能超过 128 个字符。"
    if (!path) return "目录路径不能为空。"
    if (path.length > 4096 || path.includes("\0")) return "目录路径无效。"
    const pathKey = folderMigrationPathKey(path)
    if (ids.has(id)) return "常用目录标识不能重复。"
    if (paths.has(pathKey)) return "同一个目录只能添加一次。"
    ids.add(id)
    paths.add(pathKey)
  }
  return undefined
}

export function hasFolderMigrationPath(
  targets: readonly ReaderFolderMigrationTarget[],
  path: string,
  excludedId?: string,
): boolean {
  const key = folderMigrationPathKey(path)
  return targets.some((target) => target.id !== excludedId && folderMigrationPathKey(target.path) === key)
}

function folderNameFromPath(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/u, "")
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  return normalized.slice(separator + 1)
}

function folderMigrationPathKey(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase()
}
