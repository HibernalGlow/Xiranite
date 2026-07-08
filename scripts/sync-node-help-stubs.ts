#!/usr/bin/env bun
import { access, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readNodeDef, type NodeDefLiteral } from "./lib/read-node-def.js"

interface NodePackageJson {
  name?: string
  exports?: Record<string, unknown>
}

interface BasicNodeHelp {
  title: string
  short: string
  description: string
  whenToUse: string[]
  workflows: Array<{
    title: string
    summary: string
    ui?: string[]
    terminal?: string[]
    tips?: string[]
  }>
  commands: Array<{
    title: string
    command: string
    description: string
    examples: Array<{ label: string; command: string; description: string }>
  }>
  safety?: {
    defaultMode: string
    notes: string[]
  }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const nodesRoot = join(repoRoot, "packages", "nodes")

let writtenHelp = 0
let updatedExports = 0

for (const entry of await readdir(nodesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue

  const nodeRoot = join(nodesRoot, entry.name)
  const packagePath = join(nodeRoot, "package.json")
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as NodePackageJson
  if (!pkg.name?.startsWith("@xiranite/node-")) continue

  const def = await readNodeDef(join(nodeRoot, "src", "index.ts"))
  const helpPath = join(nodeRoot, "src", "help.ts")
  if (!await fileExists(helpPath)) {
    await writeFile(helpPath, renderHelpModule(createBasicHelp(def)), "utf8")
    writtenHelp += 1
  }

  if (!pkg.exports?.["./help"]) {
    pkg.exports = withHelpExport(pkg.exports ?? {})
    await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8")
    updatedExports += 1
  }
}

console.log(`Node help stubs written: ${writtenHelp}`)
console.log(`Package help exports updated: ${updatedExports}`)

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function withHelpExport(exportsMap: Record<string, unknown>): Record<string, unknown> {
  const helpExport = {
    types: "./dist/help.d.ts",
    default: "./dist/help.js",
  }
  const next: Record<string, unknown> = {}
  let inserted = false

  for (const [key, value] of Object.entries(exportsMap)) {
    next[key] = value
    if (key === "./core") {
      next["./help"] = helpExport
      inserted = true
    }
  }

  if (!inserted) next["./help"] = helpExport
  return next
}

function createBasicHelp(def: NodeDefLiteral): BasicNodeHelp {
  const cliName = `xiranite ${def.id}`
  const safetyNotes = safetyNotesFor(def.category)
  return {
    title: def.name,
    short: def.description,
    description: def.description,
    whenToUse: [
      `Use ${def.name} when you need this node's ${def.category} workflow from either the workspace UI or CLI.`,
    ],
    workflows: [
      {
        title: "Workspace UI",
        summary: `Deploy ${def.name} from the module registry and run it from the node surface.`,
        ui: [
          `Open the module registry and deploy ${def.name} to the current workspace.`,
          "Fill the node fields or paste paths/configuration into the node surface.",
          "Run preview or the primary action, then review results and logs before applying live changes.",
        ],
      },
      {
        title: "CLI",
        summary: `Run ${def.name} directly from a terminal.`,
        terminal: [
          `Run \`${cliName}\` for the guided mode when the command supports interactive prompts.`,
          `Run \`${cliName} --help\` for the node command's exact flags and subcommands.`,
        ],
      },
    ],
    commands: [
      {
        title: "Node CLI",
        command: cliName,
        description: "Open the node CLI or inspect command-specific flags.",
        examples: [
          {
            label: "Guided mode",
            command: cliName,
            description: "Start the node's interactive terminal workflow.",
          },
          {
            label: "Command flags",
            command: `${cliName} --help`,
            description: "Show the node CLI's subcommands and options.",
          },
          {
            label: "Shared help",
            command: `xiranite help ${def.id}`,
            description: "Render this shared help entry in the root CLI.",
          },
        ],
      },
    ],
    ...(safetyNotes.length
      ? {
          safety: {
            defaultMode: "preview",
            notes: safetyNotes,
          },
        }
      : {}),
  }
}

function safetyNotesFor(category: string): string[] {
  const normalized = category.toLowerCase()
  if (normalized === "file" || normalized === "image" || normalized === "video") {
    return [
      "Prefer preview or dry-run modes before changing files.",
      "Keep backups or undo records when processing large folders.",
    ]
  }
  if (normalized === "system") {
    return [
      "Review configuration and affected system state before running live actions.",
      "Prefer preview modes when available.",
    ]
  }
  return []
}

function renderHelpModule(help: BasicNodeHelp): string {
  return `import type { NodeHelp } from "@xiranite/contract"\n\nexport const help = ${JSON.stringify(help, null, 2)} satisfies NodeHelp\n`
}
