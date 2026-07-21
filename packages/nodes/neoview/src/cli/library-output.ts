import { writeJson, writeLine } from "@xiranite/cli-runtime"
import type { CliHost } from "@xiranite/cli-runtime"

export function printLibraryItems(name: string, items: readonly unknown[], json: boolean, host: CliHost): void {
  if (json) {
    writeJson(host, items)
    return
  }
  writeLine(host, `${name}: ${items.length}`)
  for (const item of items) writeLine(host, formatItem(item))
}

function formatItem(item: unknown): string {
  if (!item || typeof item !== "object") return String(item)
  const record = item as Record<string, unknown>
  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.displayName === "string"
        ? record.displayName
        : typeof record.bookId === "string"
          ? record.bookId
          : "(unnamed)"
  const source = formatSource(record.source)
  return source ? `${name}\t${source}` : name
}

function formatSource(source: unknown): string | undefined {
  if (!source || typeof source !== "object") return undefined
  const record = source as Record<string, unknown>
  for (const key of ["path", "archivePath", "directoryPath", "videoPath"]) {
    if (typeof record[key] === "string") return record[key]
  }
  return undefined
}
