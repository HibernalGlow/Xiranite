import { CliUsageError } from "@xiranite/cli-runtime"

import type { ReaderDirectoryFilter } from "../domain/browser/ReaderDirectoryFilter.js"

export interface ParsedLibraryArguments {
  readonly values: ReadonlyMap<string, string>
  readonly json: boolean
}

const VALUE_OPTIONS = new Set(["--database", "--limit", "--offset", "--filter", "--list"])

export function parseLibraryArguments(args: readonly string[]): ParsedLibraryArguments {
  const values = new Map<string, string>()
  let json = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--json") {
      json = true
      continue
    }
    if (!argument.startsWith("--")) throw usage(`Unexpected positional argument: ${argument}`)
    if (!VALUE_OPTIONS.has(argument)) throw usage(`Unknown NeoView option: ${argument}`)
    if (values.has(argument)) throw usage(`${argument} may only be specified once.`)
    const value = args[index + 1]
    if (!value || value.startsWith("--")) throw usage(`${argument} requires a value.`)
    values.set(argument, value)
    index += 1
  }
  return { values, json }
}

export function integerOption(parsed: ParsedLibraryArguments, name: string, minimum: number, maximum: number, fallback: number): number {
  const raw = parsed.values.get(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw usage(`${name} must be an integer from ${minimum} to ${maximum}.`)
  }
  return value
}

export function directoryFilter(value: string | undefined): ReaderDirectoryFilter | undefined {
  if (value === undefined) return undefined
  if (["all", "library", "archive", "directory", "video", "image", "other"].includes(value)) {
    return value as ReaderDirectoryFilter
  }
  throw usage("--filter must be all, library, archive, directory, video, image, or other.")
}

export function rejectOptions(parsed: ParsedLibraryArguments, allowed: ReadonlySet<string>): void {
  for (const option of parsed.values.keys()) {
    if (!allowed.has(option)) throw usage(`${option} is not supported by this command.`)
  }
}

function usage(message: string): CliUsageError {
  return new CliUsageError(message)
}
