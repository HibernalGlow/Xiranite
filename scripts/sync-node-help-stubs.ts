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
    cli?: string[]
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
  translations?: Record<string, {
    title?: string
    short?: string
    description?: string
    whenToUse?: string[]
    workflows?: BasicNodeHelp["workflows"]
    commands?: BasicNodeHelp["commands"]
    safety?: BasicNodeHelp["safety"]
  }>
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
  const zhSafetyNotes = zhSafetyNotesFor(def.category)
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
        cli: [
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
    translations: {
      "zh-CN": {
        title: def.name,
        short: def.description,
        description: def.description,
        whenToUse: [
          `当你需要在工作区 UI 或 CLI 中使用 ${def.name} 的 ${def.category} 工作流时使用这个节点。`,
        ],
        workflows: [
          {
            title: "工作区 UI",
            summary: `从模块库部署 ${def.name}，然后在节点界面中运行。`,
            ui: [
              `打开模块库，把 ${def.name} 部署到当前工作区。`,
              "填写节点字段，或把路径/配置粘贴到节点界面。",
              "先运行预览或主要动作，检查结果和日志后再应用真实改动。",
            ],
          },
          {
            title: "CLI",
            summary: `直接从终端运行 ${def.name}。`,
            cli: [
              `当命令支持交互提示时，运行 \`${cliName}\` 进入引导模式。`,
              `运行 \`${cliName} --help\` 查看该节点命令的精确参数和子命令。`,
            ],
          },
        ],
        commands: [
          {
            title: "节点 CLI",
            command: cliName,
            description: "打开节点 CLI，或查看命令参数。",
            examples: [
              {
                label: "引导模式",
                command: cliName,
                description: "启动节点的交互式终端工作流。",
              },
              {
                label: "命令参数",
                command: `${cliName} --help`,
                description: "显示节点 CLI 的子命令和选项。",
              },
              {
                label: "共享帮助",
                command: `xiranite help ${def.id}`,
                description: "在根 CLI 中渲染这份共享帮助。",
              },
            ],
          },
        ],
        ...(zhSafetyNotes.length
          ? {
              safety: {
                defaultMode: "preview",
                notes: zhSafetyNotes,
              },
            }
          : {}),
      },
    },
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

function zhSafetyNotesFor(category: string): string[] {
  const normalized = category.toLowerCase()
  if (normalized === "file" || normalized === "image" || normalized === "video") {
    return [
      "修改文件前优先使用预览或 dry-run 模式。",
      "批量处理大目录前保留备份或撤销记录。",
    ]
  }
  if (normalized === "system") {
    return [
      "真实执行前检查配置和受影响的系统状态。",
      "可用时优先使用预览模式。",
    ]
  }
  return []
}

function renderHelpModule(help: BasicNodeHelp): string {
  return `import type { NodeHelp } from "@xiranite/contract"\n\nexport const help = ${JSON.stringify(help, null, 2)} satisfies NodeHelp\n`
}
