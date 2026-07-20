export function libraryItemFolderPath(path: string, isFolder: boolean): string {
  if (isFolder) return path
  const normalized = path.replace(/[\\/]+$/, "")
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  if (separator < 0) return normalized
  if (separator === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, separator + 1)
  return normalized.slice(0, separator) || normalized.slice(0, 1)
}
