import { realpath } from "node:fs/promises"

export function normalizePlatformDirectoryPath(path: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return path
  return /^[a-z]:[\\/]?$/i.test(path) ? `${path.slice(0, 2)}\\` : path
}

export async function canonicalizePlatformDirectoryPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
  canonicalize: (path: string) => Promise<string> = realpath,
): Promise<string> {
  const canonicalPath = await canonicalize(normalizePlatformDirectoryPath(path, platform))
  return normalizePlatformDirectoryPath(canonicalPath, platform)
}
