#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import { createCliHost, normalizeNodeCliName, renderRichPanel, rich, terminalColumns, writeError, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import type { NodeHelp } from "@xiranite/contract"
import { GENERATED_NODE_CLI_REGISTRY } from "./node-cli-registry.generated.js"

export interface NodeCliRegistration {
  id: string
  packageName: string
  bin: string
  description: string
}

interface NodeCliModule {
  cli?: CliCommand
}

interface NodeHelpModule {
  help?: NodeHelp
}

export const NODE_CLI_REGISTRY: NodeCliRegistration[] = GENERATED_NODE_CLI_REGISTRY

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
    const plain = rest.includes("--plain") || rest.includes("-p")
    const nodeId = rest.find((arg) => !arg.startsWith("-"))
    if (!nodeId) {
      writeLine(host, formatHelp())
      return
    }
    await showNodeHelp(nodeId, { plain }, host)
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

export async function showNodeHelp(
  nodeId: string,
  options: { plain?: boolean } = {},
  host: CliHost = createCliHost(),
): Promise<void> {
  const registration = findNodeCli(nodeId)
  if (!registration) {
    writeError(host, `Unknown node "${nodeId}". Run \`xiranite list\` to see available commands.`)
    process.exitCode = 2
    return
  }

  const help = await loadNodeHelp(registration)
  if (!help) {
    await runNodeCli(nodeId, ["--help"], host)
    return
  }

  const useRich = Boolean(host.stdout.isTTY) && !options.plain
  writeLine(host, useRich ? formatNodeHelpRich(registration, help, host) : formatNodeHelpPlain(registration, help))
}

async function loadNodeCli(registration: NodeCliRegistration): Promise<CliCommand> {
  const module = await import(`${registration.packageName}/cli`) as NodeCliModule
  if (!module.cli) {
    throw new Error(`${registration.packageName}/cli does not export cli.`)
  }
  return module.cli
}

async function loadNodeHelp(registration: NodeCliRegistration): Promise<NodeHelp | undefined> {
  try {
    const module = await import(`${registration.packageName}/help`) as NodeHelpModule
    return module.help
  } catch {
    return undefined
  }
}

export function formatNodeHelpPlain(registration: NodeCliRegistration, help: NodeHelp): string {
  const lines = [
    `${help.title} (${registration.id})`,
    help.short,
  ]
  if (help.description && help.description !== help.short) {
    lines.push("", help.description)
  }

  if (help.whenToUse?.length) {
    lines.push("", "When to use:")
    for (const item of help.whenToUse) lines.push(`  - ${item}`)
  }

  if (help.workflows.length) {
    lines.push("", "Workflows:")
    for (const workflow of help.workflows) {
      lines.push(`  ${workflow.title}${workflow.summary ? ` - ${workflow.summary}` : ""}`)
      for (const step of workflow.ui ?? []) lines.push(`    UI: ${step}`)
      for (const step of workflow.terminal ?? []) lines.push(`    CLI: ${step}`)
      for (const tip of workflow.tips ?? []) lines.push(`    Tip: ${tip}`)
    }
  }

  if (help.commands.length) {
    lines.push("", "Commands:")
    for (const command of help.commands) {
      lines.push(`  ${command.title}${command.command ? ` (${command.command})` : ""}`)
      if (command.description) lines.push(`    ${command.description}`)
      for (const example of command.examples) {
        lines.push(`    $ ${example.command}`)
        if (example.description) lines.push(`      ${example.description}`)
      }
    }
  }

  if (help.fields?.length) {
    lines.push("", "Fields:")
    for (const field of help.fields) {
      const flags = [field.type, field.required ? "required" : undefined].filter(Boolean).join(", ")
      lines.push(`  ${field.name}${flags ? ` (${flags})` : ""}: ${field.description}`)
    }
  }

  if (help.safety) {
    lines.push("", "Safety:")
    if (help.safety.defaultMode) lines.push(`  Default mode: ${help.safety.defaultMode}`)
    for (const item of help.safety.destructive ?? []) lines.push(`  Destructive: ${item}`)
    for (const item of help.safety.notes ?? []) lines.push(`  Note: ${item}`)
  }

  return lines.join("\n")
}

function formatNodeHelpRich(registration: NodeCliRegistration, help: NodeHelp, host: CliHost): string {
  const columns = terminalColumns(host)
  const sections = [
    renderRichPanel(
      host,
      `${help.title} / ${registration.bin}`,
      [
        rich(host, help.short, "bold"),
        ...(help.description && help.description !== help.short ? ["", help.description] : []),
      ],
      { color: "blue", maxWidth: columns - 2, minWidth: Math.min(72, columns - 6) },
    ),
  ]

  if (help.whenToUse?.length) {
    sections.push(renderRichPanel(host, "When to use", help.whenToUse.map((item) => `- ${item}`), {
      color: "cyan",
      maxWidth: columns - 2,
      minWidth: Math.min(72, columns - 6),
    }))
  }

  if (help.workflows.length) {
    sections.push(renderRichPanel(host, "Workflows", renderWorkflowLines(help), {
      color: "magenta",
      maxWidth: columns - 2,
      minWidth: Math.min(72, columns - 6),
    }))
  }

  if (help.commands.length) {
    sections.push(renderRichPanel(host, "Commands", renderCommandLines(help, host), {
      color: "green",
      maxWidth: columns - 2,
      minWidth: Math.min(72, columns - 6),
    }))
  }

  if (help.fields?.length) {
    sections.push(renderRichPanel(host, "Fields", help.fields.map((field) => {
      const meta = [field.type, field.required ? "required" : undefined].filter(Boolean).join(", ")
      return `${field.name}${meta ? ` (${meta})` : ""}: ${field.description}`
    }), {
      color: "yellow",
      maxWidth: columns - 2,
      minWidth: Math.min(72, columns - 6),
    }))
  }

  if (help.safety) {
    const lines = [
      ...(help.safety.defaultMode ? [`Default mode: ${help.safety.defaultMode}`] : []),
      ...(help.safety.destructive ?? []).map((item) => `Destructive: ${item}`),
      ...(help.safety.notes ?? []).map((item) => `Note: ${item}`),
    ]
    if (lines.length) {
      sections.push(renderRichPanel(host, "Safety", lines, {
        color: "red",
        maxWidth: columns - 2,
        minWidth: Math.min(72, columns - 6),
      }))
    }
  }

  return sections.join("\n\n")
}

function renderWorkflowLines(help: NodeHelp): string[] {
  return help.workflows.flatMap((workflow) => [
    workflow.summary ? `${workflow.title} - ${workflow.summary}` : workflow.title,
    ...(workflow.ui ?? []).map((step) => `  UI: ${step}`),
    ...(workflow.terminal ?? []).map((step) => `  CLI: ${step}`),
    ...(workflow.tips ?? []).map((tip) => `  Tip: ${tip}`),
  ])
}

function renderCommandLines(help: NodeHelp, host: CliHost): string[] {
  return help.commands.flatMap((command) => [
    command.command ? `${command.title} - ${rich(host, command.command, "cyan")}` : command.title,
    ...(command.description ? [`  ${command.description}`] : []),
    ...command.examples.flatMap((example) => [
      `  $ ${rich(host, example.command, "green")}`,
      ...(example.description ? [`    ${example.description}`] : []),
    ]),
  ])
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
