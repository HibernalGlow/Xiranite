import { parse } from "csv-parse/browser/esm/sync"

/** Decode the encodings emitted by Everything's EFU exporter. */
export function decodeEfuBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder("utf-16le").decode(view)
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder("utf-16be").decode(view)
  return new TextDecoder("utf-8").decode(view)
}

/**
 * Read an Everything File List (EFU) as paths.
 *
 * EFU is CSV with a `Filename` column. csv-parse handles quoted commas,
 * embedded newlines, BOMs, and variable optional columns for us.
 */
export function parseEfuText(text: string): string[] {
  const rows = parse(text, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as unknown[][]
  const header = rows.shift() ?? []
  const filenameIndex = header.findIndex((value) => String(value).trim().toLowerCase() === "filename")
  if (filenameIndex < 0) throw new Error("EFU 文件缺少 Filename 列。")
  return rows
    .map((row) => String(row[filenameIndex] ?? "").trim())
    .filter(Boolean)
}

export function parseEfuBytes(bytes: ArrayBuffer | Uint8Array): string[] {
  return parseEfuText(decodeEfuBytes(bytes))
}
