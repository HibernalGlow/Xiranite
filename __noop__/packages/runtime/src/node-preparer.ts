import { readdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

interface WorkspacePackage {
  name: string
  dependencies: readonly string[]
}

export interface NodePreparationOptions {
  repoRoot?: string
  buildPackage?: (packageName: string) => Promise<void>
}

const preparations = new Map<string, Promise<void>>()

export function prepareNodePackage(packageName: string, options: NodePreparationOptions = {}): Promise<void> {
  if (process.env.XIRANITE_LAZY_NODE_BUILD !== "1") return Promise.resolve()
  const existing = preparations.get(packageName)
  if (existing) return existing

  const preparation = prepare(packageName, options)
  preparations.set(packageName, preparation)
  return preparation
}

export async function workspaceBuildOrder(packageName: string, repoRoot: string): Promise<string[]> {
  const packages = await readWorkspacePackages(repoRoot)
  const order: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(name: string): void {
    if (visited.has(name)) return
    if (visiting.has(name)) throw new Error(`Workspace dependency cycle includes ${name}.`)
    const pkg = packages.get(name)
    if (!pkg) return
    visiting.add(name)
    for (const dependency of pkg.dependencies) visit(dependency)
    visiting.delete(name)
    visited.add(name)
    order.push(name)
  }

  visit(packageName)
  if (!visited.has(packageName)) throw new Error(`Unknown workspace package ${packageName}.`)
  return order
}

function resolveRepoRoot(): string {
  return resolve(import.meta.dirname, "../../..")
}

async function prepare(packageName: string, options: NodePreparationOptions): Promise<void> {
  const repoRoot = options.repoRoot ?? resolveRepoRoot()
  const buildPackage = options.buildPackage ?? ((name) => runTurboBuild(name, repoRoot))
  for (const dependency of await workspaceBuildOrder(packageName, repoRoot)) {
    await buildPackage(dependency)
  }
}

async function runTurboBuild(packageName: string, repoRoot: string): Promise<void> {
  const bun = (globalThis as { Bun?: { spawn(command: readonly string[], options: { cwd: string; stdin: "ignore"; stdout: "inherit"; stderr: "inherit" }): { exited: Promise<number> } } }).Bun
  if (!bun) throw new Error(`Cannot prepare ${packageName}: Bun is required in desktop development.`)

  const child = bun.spawn([process.execPath, "scripts/run-turbo.ts", "build", "--only", `--filter=${packageName}`], {
    cwd: repoRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Unable to build ${packageName} (exit ${exitCode}).`)
}

async function readWorkspacePackages(repoRoot: string): Promise<Map<string, WorkspacePackage>> {
  const directories = [join(repoRoot, "packages"), join(repoRoot, "packages", "nodes")]
  const files = (await Promise.all(directories.map((directory) => packageFiles(directory)))).flat()
  const packages = new Map<string, WorkspacePackage>()

  for (const file of files) {
    const value = JSON.parse(await readFile(file, "utf8")) as { name?: string; dependencies?: Record<string, string> }
    if (!value.name) continue
    packages.set(value.name, {
      name: value.name,
      dependencies: Object.entries(value.dependencies ?? {})
        .filter(([, version]) => version.startsWith("workspace:"))
        .map(([name]) => name),
    })
  }
  return packages
}

async function packageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => join(directory, entry.name, "package.json"))
  const files: string[] = []
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8")
      files.push(candidate)
    } catch {
      // Workspace grouping directories such as packages/nodes have no manifest.
    }
  }
  return files
}
