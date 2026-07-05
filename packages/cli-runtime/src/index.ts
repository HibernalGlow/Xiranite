import type { CliCommand, CliHost } from "@xiranite/contract"
import type { ReactNode } from "react"
export { defineCommand, runMain } from "citty"

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
  const stdin = host.stdin as { isTTY?: boolean }
  const stdout = host.stdout as { isTTY?: boolean }
  return Boolean(stdin.isTTY && stdout.isTTY)
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

function toCamelFlag(name: string): string {
  return name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}
