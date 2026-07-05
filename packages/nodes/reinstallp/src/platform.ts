import { execFile } from "node:child_process"
import { lstat, readdir, readFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import type { ReinstallProject, ReinstallpRuntime } from "./core.js"
import { extractPyprojectName } from "./core.js"

const execFileAsync = promisify(execFile)

export function createNodeReinstallpRuntime(): ReinstallpRuntime {
  return {
    scanProjects,
    installProject,
  }
}

async function scanProjects(root: string, exclude: (path: string) => boolean): Promise<ReinstallProject[]> {
  const rootPath = resolve(root)
  const rootStat = await lstat(rootPath)
  if (!rootStat.isDirectory()) throw new Error(`Path is not a directory: ${rootPath}`)

  const projects: ReinstallProject[] = []
  const seen = new Set<string>()
  await walk(rootPath)
  return projects.sort((a, b) => a.path.localeCompare(b.path))

  async function walk(current: string) {
    if (exclude(current)) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    const hasPyproject = entries.some((entry) => entry.isFile() && entry.name === "pyproject.toml")
    if (hasPyproject && !seen.has(current)) {
      const pyproject = join(current, "pyproject.toml")
      const content = await readFile(pyproject, "utf8").catch(() => "")
      seen.add(current)
      projects.push({
        path: current,
        name: extractPyprojectName(content, basename(current)),
        pyproject,
      })
    }

    for (const entry of entries) {
      if (entry.isDirectory()) await walk(join(current, entry.name))
    }
  }
}

async function installProject(projectPath: string, useSystem: boolean): Promise<{ success: boolean; error?: string }> {
  const resolved = resolve(projectPath)
  const args = ["pip", "install", "-e", resolved]
  if (useSystem) args.push("--system")

  try {
    await execFileAsync("uv", args, { cwd: dirname(resolved) })
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}
