import { confirm as clackConfirm, isCancel as isClackCancel, text as clackText } from "@clack/prompts"
import boxen from "boxen"
import { Chalk } from "chalk"
import stringWidth from "string-width"
import type { Readable, Writable } from "node:stream"
import type { ReactNode } from "react"
export { defineCommand, runMain } from "citty"

export interface CliHost {
  cwd: string
  env: Record<string, string | undefined>
  stdin: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => void }
  stdout: { columns?: number; isTTY?: boolean; write: (chunk: string) => unknown }
  stderr: { columns?: number; isTTY?: boolean; write: (chunk: string) => unknown }
}

export interface CliCommand {
  name: string
  description: string
  run: (args: string[], host: CliHost) => Promise<void> | void
}

export const NODE_CLI_PREFIX = "x"
export const LEGACY_NODE_CLI_PREFIX = "xiranite-"

export function nodeCliName(nodeId: string): string {
  return `${NODE_CLI_PREFIX}${nodeId}`
}

export function normalizeNodeCliName(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith(LEGACY_NODE_CLI_PREFIX)) return normalized.slice(LEGACY_NODE_CLI_PREFIX.length)
  if (NODE_CLI_PREFIX && normalized.startsWith(NODE_CLI_PREFIX) && normalized.length > NODE_CLI_PREFIX.length) {
    return normalized.slice(NODE_CLI_PREFIX.length)
  }
  return normalized
}

export interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | boolean>
}

export class CliUsageError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message)
    this.name = "CliUsageError"
  }
}

export class CliPromptExitError extends Error {
  constructor(message = "Prompt cancelled.") {
    super(message)
    this.name = "CliPromptExitError"
  }
}

export function createCliHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

export function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--") {
      positionals.push(...args.slice(index + 1))
      break
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const raw = arg.slice(2)
    if (!raw) {
      continue
    }

    const equalIndex = raw.indexOf("=")
    if (equalIndex >= 0) {
      flags[toCamelFlag(raw.slice(0, equalIndex))] = raw.slice(equalIndex + 1)
      continue
    }

    const name = toCamelFlag(raw)
    const next = args[index + 1]
    if (next && !next.startsWith("-")) {
      flags[name] = next
      index += 1
    } else {
      flags[name] = true
    }
  }

  return { positionals, flags }
}

export function flagString(flags: Record<string, string | boolean>, name: string, fallback = ""): string {
  const value = flags[name]
  if (typeof value === "string") return value
  if (value === true) return "true"
  return fallback
}

export function flagNumber(flags: Record<string, string | boolean>, name: string, fallback: number): number {
  const value = flags[name]
  if (typeof value !== "string") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function flagBoolean(flags: Record<string, string | boolean>, name: string, fallback = false): boolean {
  const value = flags[name]
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return fallback
  return ["1", "true", "yes", "on"].includes(value.toLowerCase())
}

export function writeJson(host: CliHost, value: unknown): void {
  host.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function writeLine(host: CliHost, message = ""): void {
  host.stdout.write(`${message}\n`)
}

export function writeError(host: CliHost, message: string): void {
  host.stderr.write(`${message}\n`)
}

export function canRunInkApp(host: CliHost = createCliHost()): boolean {
  return canRunInteractiveCli(host)
}

export function canRunInteractiveCli(host: CliHost = createCliHost()): boolean {
  return Boolean(host.stdin.isTTY && host.stdout.isTTY)
}

export type RichColor = "blue" | "cyan" | "green" | "grey" | "magenta" | "red" | "white" | "yellow"
export type RichStyle = RichColor | "bold" | "dim" | "inverse"

export function rich(host: CliHost, text: string, ...styles: RichStyle[]): string {
  if (styles.length === 0) return text
  return styles.reduce((value, style) => applyRichStyle(host, value, style), text)
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "")
}

export function visibleWidth(text: string): number {
  return stringWidth(stripAnsi(text))
}

export function padVisibleEnd(text: string, targetWidth: number): string {
  return `${text}${" ".repeat(Math.max(0, targetWidth - visibleWidth(text)))}`
}

export function terminalColumns(host: CliHost, fallback = 80): number {
  const fromStdout = Number(host.stdout.columns)
  if (Number.isFinite(fromStdout) && fromStdout > 0) return Math.floor(fromStdout)

  const fromXiraniteEnv = Number(host.env.XIRANITE_CLI_COLUMNS)
  if (Number.isFinite(fromXiraniteEnv) && fromXiraniteEnv > 0) return Math.floor(fromXiraniteEnv)

  const fromEnv = Number(host.env.COLUMNS)
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv)

  return fallback
}

export function renderRichLabel(host: CliHost, label: string, color: RichColor = "blue"): string {
  return boxen(rich(host, label, color), {
    borderColor: boxenColor(color),
    borderStyle: "round",
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
  })
}

export function renderRichPanel(
  host: CliHost,
  title: string,
  lines: string[] | string,
  options: { color?: RichColor; maxWidth?: number; minWidth?: number } = {},
): string {
  const color = options.color ?? "blue"
  const content = Array.isArray(lines) ? lines : lines.split(/\r?\n/)
  const minWidth = options.minWidth ?? 0
  const maxWidth = Math.max(24, options.maxWidth ?? terminalColumns(host) - 2)
  const requestedContentWidth = Math.max(minWidth, ...content.map((line) => visibleWidth(line)))
  const width = Math.min(maxWidth, requestedContentWidth + 4)
  const innerWidth = Math.max(1, width - 4)
  const displayLines = content.map((line) => truncateVisible(line, innerWidth))
  return boxen(displayLines.join("\n"), {
    borderColor: boxenColor(color),
    borderStyle: "round",
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    title,
    width,
  })
}

export function writeRichPanel(host: CliHost, title: string, lines: string[] | string, options: { color?: RichColor; maxWidth?: number; minWidth?: number } = {}): void {
  writeLine(host, renderRichPanel(host, title, lines, options))
}

export function renderProgressBar(
  host: CliHost,
  progress: number,
  message: string,
  options: { width?: number; label?: string } = {},
): string {
  const value = Math.max(0, Math.min(100, Math.round(progress)))
  const columns = terminalColumns(host)
  const label = options.label ? `${rich(host, options.label, "blue", "bold")} ` : ""
  const percent = rich(host, `${value.toString().padStart(3)}%`, "yellow")
  let width = options.width ?? 32
  if (!options.width) {
    const fixedWidth = visibleWidth(label) + width + 1 + visibleWidth(percent) + 1
    const messageBudget = columns - fixedWidth
    if (messageBudget < 18) width = Math.max(8, width - (18 - messageBudget))
  }
  const filled = Math.round((value / 100) * width)
  const empty = Math.max(0, width - filled)
  const bar = `${rich(host, "━".repeat(filled), "cyan")}${rich(host, "━".repeat(empty), "grey")}`
  const prefix = `${label}${bar} ${percent} `
  return `${prefix}${truncateVisible(message, Math.max(0, columns - visibleWidth(prefix)))}`
}

export async function promptRich(host: CliHost, prompt: string, defaultValue = ""): Promise<string> {
  try {
    const answer = await clackText({
      message: prompt,
      defaultValue: defaultValue || undefined,
      ...clackContext(host),
    })
    if (isClackCancel(answer)) throw new CliPromptExitError()
    return answer.trim() || defaultValue
  } catch (error) {
    if (isPromptExitError(error)) throw new CliPromptExitError()
    throw error
  }
}

export async function confirmRich(host: CliHost, prompt: string, defaultValue = false): Promise<boolean> {
  try {
    const answer = await clackConfirm({
      message: prompt,
      initialValue: defaultValue,
      active: "是",
      inactive: "否",
      ...clackContext(host),
    })
    if (isClackCancel(answer)) throw new CliPromptExitError()
    return answer
  } catch (error) {
    if (isPromptExitError(error)) throw new CliPromptExitError()
    throw error
  }
}

export function shellQuote(value: string): string {
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`
  return `'${value.replace(/'/g, "'\\''")}'`
}

export async function runCliCommand(command: CliCommand, args = process.argv.slice(2)): Promise<void> {
  const host = createCliHost()
  if (args.includes("--help") || args.includes("-h")) {
    writeLine(host, `${command.name}: ${command.description}`)
    return
  }

  try {
    await command.run(args, host)
  } catch (error) {
    if (error instanceof CliUsageError) {
      writeError(host, error.message)
      process.exitCode = error.exitCode
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    writeError(host, message)
    process.exitCode = 1
  }
}

export async function runInkApp(node: ReactNode): Promise<void> {
  const { render } = await import("ink")
  const app = render(node)
  await app.waitUntilExit()
}

function shouldColor(host: CliHost): boolean {
  if (host.env.NO_COLOR !== undefined) return false
  if (host.env.FORCE_COLOR && host.env.FORCE_COLOR !== "0") return true
  if (host.env.XIRANITE_FORCE_COLOR === "1") return true
  return Boolean(host.stdout.isTTY)
}

function createChalk(host: CliHost): InstanceType<typeof Chalk> {
  return new Chalk({ level: shouldColor(host) ? 3 : 0 })
}

function applyRichStyle(host: CliHost, text: string, style: RichStyle): string {
  const chalk = createChalk(host)
  switch (style) {
    case "blue": return chalk.blueBright(text)
    case "cyan": return chalk.cyanBright(text)
    case "green": return chalk.greenBright(text)
    case "grey": return chalk.gray(text)
    case "magenta": return chalk.magentaBright(text)
    case "red": return chalk.redBright(text)
    case "white": return chalk.whiteBright(text)
    case "yellow": return chalk.yellowBright(text)
    case "bold": return chalk.bold(text)
    case "dim": return chalk.dim(text)
    case "inverse": return chalk.inverse(text)
  }
}

function boxenColor(color: RichColor): "blue" | "cyan" | "gray" | "green" | "magenta" | "red" | "white" | "yellow" {
  return color === "grey" ? "gray" : color
}

function clackContext(host: CliHost) {
  return {
    input: host.stdin as unknown as Readable,
    output: host.stdout as unknown as Writable,
  }
}

function isPromptExitError(error: unknown): boolean {
  return error instanceof Error && (error.name === "ExitPromptError" || error.name === "AbortPromptError")
}

export function truncateVisible(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (maxWidth === 1) return visibleWidth(text) > 1 ? "…" : text
  if (visibleWidth(text) <= maxWidth) return text
  let width = 0
  let result = ""
  for (const char of Array.from(text)) {
    const nextWidth = stringWidth(char)
    if (width + nextWidth > maxWidth - 1) break
    result += char
    width += nextWidth
  }
  return `${result}…`
}

function toCamelFlag(name: string): string {
  return name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}
