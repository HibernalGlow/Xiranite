import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type ReinstallpAction = "scan" | "install"

export interface ReinstallpInput {
  action?: ReinstallpAction
  path?: string
  projects?: string[]
  useSystem?: boolean
}

export interface ReinstallProject {
  path: string
  name: string
  pyproject: string
}

export interface InstallResult extends ReinstallProject {
  status: "success" | "failed"
  error?: string
}

export interface ReinstallpData {
  projects: ReinstallProject[]
  installedCount: number
  failedCount: number
  results: InstallResult[]
}

export interface ReinstallpRuntime {
  scanProjects: (root: string, exclude: (path: string) => boolean) => Promise<ReinstallProject[]>
  installProject: (projectPath: string, useSystem: boolean) => Promise<{ success: boolean; error?: string }>
}

export type ReinstallpResult = NodeRunResult<ReinstallpData>

export const DEFAULT_EXCLUDE_PATTERNS = [
  String.raw`(^|[\\/])\.venv([\\/]|$)`,
  String.raw`(^|[\\/])venv([\\/]|$)`,
  String.raw`(^|[\\/])\.env([\\/]|$)`,
  String.raw`__pycache__`,
  String.raw`(^|[\\/])\.git([\\/]|$)`,
  String.raw`node_modules`,
  String.raw`(^|[\\/])\.pytest_cache([\\/]|$)`,
  String.raw`(^|[\\/])\.mypy_cache([\\/]|$)`,
  String.raw`\.egg-info`,
  String.raw`(^|[\\/])build([\\/]|$)`,
  String.raw`(^|[\\/])dist([\\/]|$)`,
  String.raw`(^|[\\/])\.tox([\\/]|$)`,
]

export function normalizeReinstallpInput(input: ReinstallpInput): Required<ReinstallpInput> {
  return {
    action: input.action ?? "scan",
    path: (input.path ?? "").trim().replace(/^["']|["']$/g, ""),
    projects: input.projects ?? [],
    useSystem: input.useSystem ?? true,
  }
}

export function shouldExcludePath(path: string, patterns = DEFAULT_EXCLUDE_PATTERNS): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(path))
}

export function extractPyprojectName(content: string, fallback: string): string {
  let inProject = false
  for (const line of content.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)?.[1]?.trim()
    if (section) {
      if (section === "project") {
        inProject = true
        continue
      }
      if (inProject) break
    }

    if (!inProject) continue
    const name = line.match(/^\s*name\s*=\s*["']([^"']+)["']/)?.[1]?.trim()
    if (name) return name
  }
  return fallback
}

export async function runReinstallp(
  input: ReinstallpInput,
  runtime: ReinstallpRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<ReinstallpResult> {
  const normalized = normalizeReinstallpInput(input)
  if (normalized.action === "scan") {
    if (!normalized.path) return failure("Root path is required.")
    onEvent({ type: "progress", progress: 20, message: `Scanning ${normalized.path}` })
    const projects = await runtime.scanProjects(normalized.path, shouldExcludePath)
    onEvent({ type: "progress", progress: 100, message: `Found ${projects.length} project(s).` })
    return success(`Found ${projects.length} project(s).`, { projects })
  }

  if (!normalized.projects.length) {
    return failure("No projects provided for installation.")
  }

  const results: InstallResult[] = []
  let installedCount = 0
  let failedCount = 0
  for (let index = 0; index < normalized.projects.length; index += 1) {
    const projectPath = normalized.projects[index]
    onEvent({ type: "progress", progress: Math.round((index / normalized.projects.length) * 100), message: `Installing ${projectPath}` })
    const result = await runtime.installProject(projectPath, normalized.useSystem)
    const project: InstallResult = {
      path: projectPath,
      name: projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath,
      pyproject: `${projectPath.replace(/[\\/]+$/, "")}/pyproject.toml`,
      status: result.success ? "success" : "failed",
      error: result.error,
    }
    results.push(project)
    if (result.success) installedCount += 1
    else failedCount += 1
  }
  onEvent({ type: "progress", progress: 100, message: "Install completed." })
  return success(`Install completed: ${installedCount} success, ${failedCount} failed.`, { installedCount, failedCount, results })
}

function success(message: string, data: Partial<ReinstallpData>): ReinstallpResult {
  return {
    success: true,
    message,
    data: { projects: [], installedCount: 0, failedCount: 0, results: [], ...data },
  }
}

function failure(message: string): ReinstallpResult {
  return {
    success: false,
    message,
    data: { projects: [], installedCount: 0, failedCount: 0, results: [] },
  }
}
