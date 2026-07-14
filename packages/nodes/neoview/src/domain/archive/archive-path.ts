export function normalizeArchivePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  const parts = normalized.split("/").filter(Boolean)
  if (!parts.length || normalized.startsWith("/") || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Unsafe archive entry path: ${path}`)
  }
  return parts.join("/")
}
