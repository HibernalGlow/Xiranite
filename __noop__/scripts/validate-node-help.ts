#!/usr/bin/env bun
import { access, readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

interface NodePackageJson {
  name?: string
  exports?: Record<string, unknown>
}

interface HelpModule {
  help?: unknown
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const nodesRoot = join(repoRoot, "packages", "nodes")
const errors: string[] = []

for (const entry of await readdir(nodesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue

  const nodeRoot = join(nodesRoot, entry.name)
  const packagePath = join(nodeRoot, "package.json")
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as NodePackageJson
  if (!pkg.name?.startsWith("@xiranite/node-")) continue

  const label = `${pkg.name} (${entry.name})`
  const helpPath = join(nodeRoot, "src", "help.ts")
  if (!await fileExists(helpPath)) {
    errors.push(`${label}: missing src/help.ts`)
    continue
  }
  if (!pkg.exports?.["./help"]) {
    errors.push(`${label}: package.json missing ./help export`)
  }

  let module: HelpModule
  try {
    module = await import(`${pathToFileURL(helpPath).href}?validate=${Date.now()}`) as HelpModule
  } catch (error) {
    errors.push(`${label}: failed to import help.ts: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  const help = module.help
  if (!isRecord(help)) {
    errors.push(`${label}: help export must be an object`)
    continue
  }

  if (!isNonEmptyString(help.short)) {
    errors.push(`${label}: help.short is required`)
  }

  if (!Array.isArray(help.workflows) || help.workflows.length === 0) {
    errors.push(`${label}: at least one workflow is required`)
  }

  if (!hasCliExample(help.commands)) {
    errors.push(`${label}: at least one CLI example is required in commands[].examples[]`)
  }
}

if (errors.length) {
  console.error(`Node help validation failed with ${errors.length} issue(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log("Node help validation passed.")
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function hasCliExample(commands: unknown): boolean {
  if (!Array.isArray(commands)) return false
  return commands.some((command) => {
    if (!isRecord(command) || !Array.isArray(command.examples)) return false
    return command.examples.some((example) => isRecord(example) && isNonEmptyString(example.command))
  })
}
