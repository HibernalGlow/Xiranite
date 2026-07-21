#!/usr/bin/env node
import { CliUsageError, createCliHost, writeError, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"

import type { ReaderLibraryHeadlessController } from "./application/headless/ReaderLibraryHeadlessController.js"
import { parseLibraryArguments } from "./cli/library-arguments.js"
import { runLibraryCommand, type LibraryCommand } from "./cli/library-command.js"
import { formatCliHelp } from "./cli/library-help.js"

const COMMAND_ALIASES: Readonly<Record<string, LibraryCommand>> = {
  history: "history",
  "library-recents": "history",
  bookmarks: "bookmarks",
  "library-bookmarks": "bookmarks",
  "bookmark-lists": "bookmark-lists",
  "library-bookmark-lists": "bookmark-lists",
  stats: "stats",
}

export interface NeoviewCliDependencies {
  createLibraryController?: (databasePath?: string) => Promise<ReaderLibraryHeadlessController>
}

export const cli: CliCommand = {
  name: "xneoview",
  description: "Inspect NeoView reading history and bookmarks.",
  run: (args, host) => runProgram(args, host),
}

export async function runProgram(args = process.argv.slice(2), host: CliHost = createCliHost(), dependencies: NeoviewCliDependencies = {}): Promise<void> {
  const rawCommand = args[0]
  if (!rawCommand || rawCommand === "help" || rawCommand === "--help" || rawCommand === "-h") {
    writeLine(host, formatCliHelp())
    return
  }

  const command = COMMAND_ALIASES[rawCommand]
  if (!command) throw usage(`Unknown NeoView command: ${rawCommand}`)
  const parsed = parseLibraryArguments(args.slice(1))
  const controller = await createLibraryController(parsed.values.get("--database"), dependencies)
  try {
    await runLibraryCommand(command, parsed, controller, host)
  } finally {
    await controller.close()
  }
}

async function createLibraryController(databasePath: string | undefined, dependencies: NeoviewCliDependencies): Promise<ReaderLibraryHeadlessController> {
  if (dependencies.createLibraryController) return dependencies.createLibraryController(databasePath)
  const { createReaderLibraryHeadlessController } = await import("./platform.js")
  return createReaderLibraryHeadlessController(databasePath)
}

function usage(message: string): CliUsageError {
  return new CliUsageError(`${message}\n\n${formatCliHelp()}`)
}

if (import.meta.main) {
  const host = createCliHost()
  try {
    await runProgram(process.argv.slice(2), host)
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = error instanceof CliUsageError ? 2 : 1
  }
}
