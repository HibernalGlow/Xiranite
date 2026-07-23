import { createReadStream } from "node:fs"

/**
 * Stream the Filename column from an Everything File List without retaining
 * the file contents or parsed rows. Windows filenames cannot contain newlines,
 * so each physical EFU line is one complete CSV record.
 */
export async function* streamEfuPaths(path: string): AsyncGenerator<string> {
  let header: string[] | undefined
  let filenameIndex = -1

  for await (const line of decodedLines(path)) {
    if (!line) continue
    const row = parseCsvLine(line)
    if (!header) {
      header = row
      filenameIndex = header.findIndex((value) => value.trim().toLowerCase() === "filename")
      if (filenameIndex < 0) throw new Error(`EFU file ${path} is missing the Filename column.`)
      continue
    }
    const filename = row[filenameIndex]?.trim()
    if (filename) yield filename
  }

  if (!header) throw new Error(`EFU file ${path} is empty.`)
}

async function* decodedLines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path)
  let decoder: TextDecoder | undefined
  let pending = ""

  for await (const chunk of stream) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer)
    if (!decoder) decoder = new TextDecoder(detectEncoding(bytes))
    pending += decoder.decode(bytes, { stream: true })
    let newline = pending.indexOf("\n")
    while (newline >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, "")
      pending = pending.slice(newline + 1)
      yield line
      newline = pending.indexOf("\n")
    }
  }

  pending += decoder?.decode() ?? ""
  if (pending) yield pending.replace(/\r$/, "")
}

function detectEncoding(bytes: Uint8Array): "utf-8" | "utf-16le" | "utf-16be" {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le"
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be"
  return "utf-8"
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let value = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === "," && !quoted) {
      fields.push(value)
      value = ""
    } else value += char
  }
  fields.push(value)
  return fields
}
