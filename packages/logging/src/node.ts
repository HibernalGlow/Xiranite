import { createReadStream } from "node:fs"
import { mkdir, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { once } from "node:events"
import { createGunzip } from "node:zlib"
import { createStream, type RotatingFileStream } from "rotating-file-stream"

import { parseLogLine, serializeLogEnvelope, type LogParseIssue } from "./jsonl.js"
import { LogEnvelopeSchema, type LogEnvelope } from "./schema.js"

export const DEFAULT_LOG_FILE_SIZE = "10M" as const
export const DEFAULT_LOG_DIRECTORY_SIZE = "200M" as const
export const DEFAULT_LOG_RETENTION_FILES = 100

export interface LogWriterOptions {
  directory?: string
  source: string
  sessionId: string
  size?: `${number}${"B" | "K" | "M" | "G"}`
  maxSize?: `${number}${"B" | "K" | "M" | "G"}`
  maxFiles?: number
  compress?: boolean
}

export interface LogFileParseIssue extends LogParseIssue {
  file: string
}

export interface ReadLogDirectoryResult {
  events: LogEnvelope[]
  issues: LogFileParseIssue[]
  files: string[]
}

export class RotatingJsonlLogWriter {
  readonly directory: string
  readonly source: string
  readonly sessionId: string
  private readonly stream: RotatingFileStream
  private streamError: Error | undefined
  private writeQueue = Promise.resolve()

  constructor(options: LogWriterOptions) {
    this.directory = resolveLogDirectory(options.directory)
    this.source = sanitizeFilePart(options.source)
    this.sessionId = sanitizeFilePart(options.sessionId).slice(0, 48)
    const baseName = `${this.source}-${this.sessionId}`
    const rotatedExtension = options.compress === false ? ".jsonl" : ".jsonl.gz"
    // Size-only rotation avoids rotating-file-stream's UTC boundary loop in positive-offset time zones.
    this.stream = createStream((time, index) => {
      if (!time) return `${baseName}.current.jsonl`
      const date = formatUtcDate(time instanceof Date ? time : new Date(time))
      return `${baseName}.${date}.${index ?? 0}${rotatedExtension}`
    }, {
      path: this.directory,
      size: options.size ?? envFileSize("XIRANITE_LOG_FILE_SIZE", DEFAULT_LOG_FILE_SIZE),
      compress: options.compress === false ? false : "gzip",
      history: `${baseName}.history.json`,
      maxFiles: options.maxFiles ?? envPositiveInteger("XIRANITE_LOG_MAX_FILES", DEFAULT_LOG_RETENTION_FILES),
      maxSize: options.maxSize ?? envFileSize("XIRANITE_LOG_MAX_SIZE", DEFAULT_LOG_DIRECTORY_SIZE),
      encoding: "utf8",
      mode: 0o600,
    })
    this.stream.on("error", (error) => { this.streamError = error })
  }

  async append(events: readonly LogEnvelope[]): Promise<void> {
    const validated = events.map((event) => LogEnvelopeSchema.parse(event))
    const write = async () => {
      if (this.streamError) throw this.streamError
      for (const event of validated) {
        if (!this.stream.write(`${serializeLogEnvelope(event)}\n`, "utf8")) await once(this.stream, "drain")
        if (this.streamError) throw this.streamError
      }
    }
    const result = this.writeQueue.then(write)
    this.writeQueue = result.catch(() => undefined)
    await result
  }

  async close(): Promise<void> {
    await this.writeQueue
    if (this.stream.closed || this.stream.destroyed) return
    this.stream.end()
    await Promise.race([
      once(this.stream, "finish").then(() => undefined),
      once(this.stream, "error").then(([error]) => { throw error }),
    ])
  }
}

export function resolveLogDirectory(explicit?: string, environment: NodeJS.ProcessEnv = process.env): string {
  if (explicit?.trim()) return path.resolve(explicit)
  if (environment.XIRANITE_LOG_DIR?.trim()) return path.resolve(environment.XIRANITE_LOG_DIR)
  const home = homedir()
  if (process.platform === "win32") {
    const base = environment.LOCALAPPDATA ?? environment.APPDATA ?? path.join(home, "AppData", "Local")
    return path.join(base, "Xiranite", "logs")
  }
  if (process.platform === "darwin") return path.join(home, "Library", "Logs", "Xiranite")
  const state = environment.XDG_STATE_HOME ?? path.join(home, ".local", "state")
  return path.join(state, "xiranite", "logs")
}

export async function discoverLogFiles(directory = resolveLogDirectory()): Promise<string[]> {
  const root = path.resolve(directory)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: Array<{ path: string; modified: number }> = []
  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.endsWith(".jsonl") && !entry.name.endsWith(".jsonl.gz"))) continue
    const file = path.join(root, entry.name)
    const info = await stat(file).catch(() => undefined)
    if (info) files.push({ path: file, modified: info.mtimeMs })
  }
  return files.sort((left, right) => left.modified - right.modified || left.path.localeCompare(right.path)).map((item) => item.path)
}

export async function readLogDirectory(directory = resolveLogDirectory()): Promise<ReadLogDirectoryResult> {
  const files = await discoverLogFiles(directory)
  const events: LogEnvelope[] = []
  const issues: LogFileParseIssue[] = []
  for (const file of files) {
    let lineNumber = 0
    const compressed = file.endsWith(".gz") || await hasGzipHeader(file)
    const input = createReadStream(file)
    const source = compressed ? input.pipe(createGunzip()) : input
    const lines = createInterface({ input: source, crlfDelay: Infinity })
    for await (const raw of lines) {
      lineNumber += 1
      if (!raw.trim()) continue
      const parsed = parseLogLine(raw, lineNumber)
      if (parsed.event) events.push(parsed.event)
      if (parsed.issue) issues.push({ ...parsed.issue, file })
    }
  }
  return { events, issues, files }
}

async function hasGzipHeader(file: string): Promise<boolean> {
  const input = createReadStream(file, { start: 0, end: 1 })
  const chunks: Buffer[] = []
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const header = Buffer.concat(chunks)
  return header.length >= 2 && header[0] === 0x1f && header[1] === 0x8b
}

export async function ensureLogDirectory(directory = resolveLogDirectory()): Promise<string> {
  const root = path.resolve(directory)
  await mkdir(root, { recursive: true })
  return root
}

function sanitizeFilePart(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || "unknown"
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "")
}

function envPositiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function envFileSize(name: string, fallback: `${number}${"B" | "K" | "M" | "G"}`): `${number}${"B" | "K" | "M" | "G"}` {
  const value = process.env[name]?.trim().toUpperCase()
  return value && /^\d+[BKMG]$/.test(value) ? value as `${number}${"B" | "K" | "M" | "G"}` : fallback
}
