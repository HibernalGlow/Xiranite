export function normalizePlatformDirectoryPath(path: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return path
  return /^[a-z]:[\\/]?$/i.test(path) ? `${path.slice(0, 2)}\\` : path
}
