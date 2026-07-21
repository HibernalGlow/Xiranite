import type { ReaderDirectoryRootDto } from "../../../../adapters/reader-http-client"
import { normalizeFolderNavigationPath } from "./DirectoryCatalog"

export interface FolderDirectoryRoot {
  path: string
  name: string
  pinned: boolean
  available: boolean
}

export function folderDirectoryRoots(
  currentPath: string,
  pinnedPaths: readonly string[],
  platformRoots: readonly ReaderDirectoryRootDto[],
  currentRootName?: string,
): FolderDirectoryRoot[] {
  const currentRoot = folderDirectoryRoot(currentPath)
  const roots: FolderDirectoryRoot[] = []
  for (const rawPath of pinnedPaths) {
    const path = normalizeFolderNavigationPath(rawPath)
    if (!roots.some((root) => sameFolderDirectoryPath(root.path, path))) {
      roots.push({ path, name: pinnedFolderDirectoryLabel(path), pinned: true, available: true })
    }
  }
  for (const root of platformRoots) {
    const path = normalizeFolderNavigationPath(root.path)
    const existing = roots.find((candidate) => sameFolderDirectoryPath(candidate.path, path))
    if (existing) {
      existing.name = root.label
      existing.available = root.available
    } else {
      roots.push({ path, name: root.label, pinned: false, available: root.available })
    }
  }
  const existingCurrent = roots.find((root) => sameFolderDirectoryPath(root.path, currentRoot))
  if (existingCurrent) {
    existingCurrent.available = true
    if (currentRootName && !platformRoots.some((root) => sameFolderDirectoryPath(root.path, currentRoot))) {
      existingCurrent.name = currentRootName
    }
  } else {
    roots.push({ path: currentRoot, name: currentRootName ?? folderDirectoryRootLabel(currentRoot), pinned: false, available: true })
  }
  return roots
}

export function folderDirectoryRoot(path: string): string {
  const normalized = normalizeFolderNavigationPath(path).replaceAll("\\", "/")
  const unc = /^(\/\/[^/]+\/[^/]+)(?:\/|$)/u.exec(normalized)
  if (unc) return `${unc[1]}/`
  const drive = /^([A-Za-z]:)(?:\/|$)/u.exec(normalized)
  if (drive) return `${drive[1]}\\`
  return "/"
}

export function folderDirectoryPathKey(path: string): string {
  const normalized = normalizeFolderNavigationPath(path).replaceAll("\\", "/").replace(/\/+$/u, "")
  const value = normalized || "/"
  return /^(?:[A-Za-z]:|\/\/)/u.test(value) ? value.toLowerCase() : value
}

export function sameFolderDirectoryPath(left: string, right: string): boolean {
  return folderDirectoryPathKey(left) === folderDirectoryPathKey(right)
}

export function isFolderDirectoryAncestor(candidate: string, path: string): boolean {
  const ancestor = folderDirectoryPathKey(candidate)
  const target = folderDirectoryPathKey(path)
  return target !== ancestor && target.startsWith(ancestor === "/" ? "/" : `${ancestor}/`)
}

function folderDirectoryRootLabel(root: string): string {
  return root.replaceAll("\\", "/").replace(/\/$/u, "") || "/"
}

function pinnedFolderDirectoryLabel(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/u, "")
  return normalized.split("/").at(-1) || folderDirectoryRootLabel(path)
}
