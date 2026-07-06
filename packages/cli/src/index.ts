#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { createCliHost, nodeCliName, normalizeNodeCliName, writeError, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"

export interface NodeCliRegistration {
  id: string
  packageName: string
  bin: string
  description: string
}

interface NodeCliModule {
  cli?: CliCommand
}

export const NODE_CLI_REGISTRY: NodeCliRegistration[] = [
  node("bandia", "Batch archive extract, compress, repack, and EFU export."),
  node("cleanf", "Remove empty folders, backup files, temp folders, and trash patterns."),
  node("crashu", "Match and move folders by normalized artist/title similarity."),
  node("dissolvef", "Dissolve nested folder/archive structures with undo support."),
  node("encodeb", "Recover mojibake file names between encodings."),
  node("enginev", "Scan and manage Wallpaper Engine workshop folders."),
  node("findz", "Search filesystem and archive contents with filters."),
  node("formatv", "Toggle video file suffixes and detect duplicates."),
  node("kavvka", "Organize artist folders and compare sibling directories."),
  node("lata", "Run Taskfile-style command workflows."),
  node("linedup", "Filter source lines by removing matches."),
  node("linku", "Create and track symlinks from TOML config."),
  node("marku", "Transform Markdown/text files with dry-run and undo."),
  node("migratef", "Migrate folder contents with history and undo."),
  node("movea", "Move numbered folders and matching archive files."),
  node("mvz", "Operate on archive entries from findz-style lines."),
  node("owithu", "Apply environment and registry operations from config."),
  node("rawfilter", "Separate raw/translated archive variants."),
  node("recycleu", "Empty the Windows recycle bin once or on a timer."),
  node("reinstallp", "Scan and reinstall local Python projects."),
  node("repacku", "Analyze and repack folders into archive layouts."),
  node("scoolp", "Manage Scoop package buckets and cache state."),
  node("seriex", "Plan and apply series folder organization."),
  node("sleept", "Run sleep/shutdown timers and system monitors."),
  node("trename", "Plan, validate, rename, and undo ACG file names."),
  node("weibospider", "Manage config and crawl Weibo media workflows."),
]

export function normalizeNodeId(value: string): string {
  return normalizeNodeCliName(value)
}

export function findNodeCli(value: string): NodeCliRegistration | undefined {
  const id = normalizeNodeId(value)
  return NODE_CLI_REGISTRY.find((entry) => entry.id === id || entry.bin === value.trim().toLowerCase())
}

export function formatHelp(): string {
  return [
    "xiranite <node> [args]",
    "",
    "Commands:",
    "  list                 List node commands",
    "  help <node>          Show a node command help",
    "  <node> [args]        Run a node CLI, for example `xiranite cleanf preview --help`",
    "",
    "No args after <node> are forwarded as-is, so `xiranite cleanf` opens that node's guided mode in an interactive terminal.",
  ].join("\n")
}

export function formatNodeList(): string {
  const width = Math.max(...NODE_CLI_REGISTRY.map((entry) => entry.id.length))
  return NODE_CLI_REGISTRY
    .map((entry) => `${entry.id.padEnd(width)}  ${entry.bin.padEnd(width + 9)}  ${entry.description}`)
    .join("\n")
}

export async function runProgram(args = process.argv.slice(2), host: CliHost = createCliHost()): Promise<void> {
  const [command, ...rest] = args

  if (!command || command === "--help" || command === "-h") {
    writeLine(host, formatHelp())
    return
  }

  if (command === "list") {
    writeLine(host, formatNodeList())
    return
  }

  if (command === "help") {
    const nodeId = rest[0]
    if (!nodeId) {
      writeLine(host, formatHelp())
      return
    }
    await runNodeCli(nodeId, ["--help"], host)
    return
  }

  await runNodeCli(command, rest, host)
}

export async function runNodeCli(nodeId: string, args: string[], host: CliHost = createCliHost()): Promise<void> {
  const registration = findNodeCli(nodeId)
  if (!registration) {
    writeError(host, `Unknown node "${nodeId}". Run \`xiranite list\` to see available commands.`)
    process.exitCode = 2
    return
  }

  const cli = await loadNodeCli(registration)
  await cli.run(args, host)
}

async function loadNodeCli(registration: NodeCliRegistration): Promise<CliCommand> {
  const module = await import(`${registration.packageName}/cli`) as NodeCliModule
  if (!module.cli) {
    throw new Error(`${registration.packageName}/cli does not export cli.`)
  }
  return module.cli
}

function node(id: string, description: string): NodeCliRegistration {
  return {
    id,
    packageName: `@xiranite/node-${id}`,
    bin: nodeCliName(id),
    description,
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runProgram()
  } catch (error) {
    const host = createCliHost()
    writeError(host, error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
