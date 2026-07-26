import { type ReaderDirectoryPageDto } from "../../../../adapters/reader-http-client"

export function sameFolderPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/u, "")
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return /^[a-z]:/iu.test(normalizedLeft) || /^[a-z]:/iu.test(normalizedRight)
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight
}
export function isSameFolderNavigationEntry(
  previous: Pick<ReaderDirectoryPageDto, "sessionId" | "navigationEntryId"> | undefined,
  next: Pick<ReaderDirectoryPageDto, "sessionId" | "navigationEntryId">,
): boolean {
  return previous?.sessionId === next.sessionId && previous.navigationEntryId === next.navigationEntryId
}
export function resolveFolderStartupPath(sourcePath: string | undefined, homePath: string | undefined): string {
  const source = sourcePath?.trim()
  if (source) return source
  const home = homePath?.trim()
  if (home) return home
  return ""
}
export function sameFolderOrChild(folderPath: string, sourcePath: string): boolean {
  const folder = folderPath.replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase()
  const source = sourcePath.trim().replaceAll("\\", "/").replace(/\/+$/u, "").toLocaleLowerCase()
  if (!folder || !source || folder === source) return folder === source
  const separator = source.lastIndexOf("/")
  const parent = separator < 0 ? source : source.slice(0, separator).replace(/\/+$/u, "")
  return parent === folder || parent === `${folder}:`
}
