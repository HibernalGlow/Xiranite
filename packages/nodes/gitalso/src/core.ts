import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type GitalsoAction =
  | "status" | "stage" | "unstage" | "stage_all" | "unstage_all"
  | "branch_create" | "branch_checkout" | "fetch" | "pull" | "push"
  | "generate" | "commit" | "gitbutler_commit"

export interface GitalsoInput {
  action?: GitalsoAction
  repoPath?: string
  dinyPath?: string
  paths?: string[]
  branchName?: string
  noVerify?: boolean
  message?: string
  dryRun?: boolean
  timeout?: number
}

export interface GitalsoFile {
  path: string
  index: string
  workingTree: string
  staged: boolean
  unstaged: boolean
}

export interface GitalsoCommit { hash: string; message: string; author: string; date: string }
export interface GitalsoBranch { name: string; current: boolean; remote?: string }
export interface GitalsoRepository {
  root: string
  branch: string
  files: GitalsoFile[]
  branches: GitalsoBranch[]
  commits: GitalsoCommit[]
  remotes: string[]
  ahead: number
  behind: number
  stagedDiff: string
}

export interface GitalsoData {
  repository: GitalsoRepository | null
  dinyInstalled: boolean
  dinyVersion: string | null
  commitMessage: string | null
  committed: boolean
  pushed: boolean
  commitHash: string | null
  errors: string[]
}

// Temporary API aliases keep persisted cards and the app entry compatible while
// GitAlso evolves from the original diny-only node into a Git workbench.
export type DinyAction = GitalsoAction
export type DinyInput = GitalsoInput
export interface DinyStagedFile { path: string; status: string; insertions: number; deletions: number }
export interface DinyGitInfo { branch: string; stagedFiles: DinyStagedFile[]; diffStat: { insertions: number; deletions: number; files: number }; diffPreview: string }
export interface DinyData extends GitalsoData { git: DinyGitInfo | null }

export interface GitalsoRuntime {
  defaultRepoPath: () => Promise<string>
  getRepository: (repoPath: string) => Promise<GitalsoRepository>
  stage: (repoPath: string, paths: string[]) => Promise<void>
  unstage: (repoPath: string, paths: string[]) => Promise<void>
  stageAll: (repoPath: string) => Promise<void>
  unstageAll: (repoPath: string) => Promise<void>
  createBranch: (repoPath: string, branchName: string) => Promise<void>
  checkoutBranch: (repoPath: string, branchName: string) => Promise<void>
  fetch: (repoPath: string) => Promise<void>
  pull: (repoPath: string) => Promise<void>
  push: (repoPath: string) => Promise<{ remote: string; branch: string }>
  commit: (repoPath: string, message: string, noVerify: boolean) => Promise<{ hash: string }>
  resolveDiny: (path?: string) => Promise<{ found: boolean; path: string; version: string | null }>
  runDinyPrint: (options: { dinyPath: string; repoPath: string; noVerify: boolean; timeout: number }) => Promise<{ stdout: string; stderr: string; code: number }>
  gitButlerCommit: (repoPath: string) => Promise<{ hash: string; message: string }>
}

export async function runGitalso(input: GitalsoInput, runtime: GitalsoRuntime, onEvent: (event: NodeRunEvent) => void = () => {}): Promise<NodeRunResult<GitalsoData>> {
  const action = input.action ?? "status"
  const repoPath = clean(input.repoPath) || await runtime.defaultRepoPath()
  const paths = input.paths?.map(clean).filter(Boolean) ?? []
  const branchName = clean(input.branchName)
  const noVerify = input.noVerify ?? false

  try {
    if (action === "gitbutler_commit") {
      onEvent({ type: "progress", progress: 20, message: "Setting up the GitButler workspace (fallback workflow)." })
      const commit = await runtime.gitButlerCommit(repoPath)
      return ok(`GitButler AI commit landed: ${commit.hash.slice(0, 7)}`, { commitMessage: commit.message, committed: true, commitHash: commit.hash })
    }

    if (action === "stage") {
      ensurePaths(paths, "Select one or more changed files to stage.")
      await runtime.stage(repoPath, paths)
      return refreshed(runtime, repoPath, `Staged ${paths.length} file(s).`)
    }
    if (action === "unstage") {
      ensurePaths(paths, "Select one or more staged files to unstage.")
      await runtime.unstage(repoPath, paths)
      return refreshed(runtime, repoPath, `Unstaged ${paths.length} file(s).`)
    }
    if (action === "stage_all") { await runtime.stageAll(repoPath); return refreshed(runtime, repoPath, "Staged all changed files.") }
    if (action === "unstage_all") { await runtime.unstageAll(repoPath); return refreshed(runtime, repoPath, "Unstaged all files.") }
    if (action === "branch_create") {
      if (!branchName) throw new Error("Enter a branch name.")
      await runtime.createBranch(repoPath, branchName)
      return refreshed(runtime, repoPath, `Created and switched to ${branchName}.`)
    }
    if (action === "branch_checkout") {
      if (!branchName) throw new Error("Choose a branch.")
      await runtime.checkoutBranch(repoPath, branchName)
      return refreshed(runtime, repoPath, `Switched to ${branchName}.`)
    }
    if (action === "fetch") { await runtime.fetch(repoPath); return refreshed(runtime, repoPath, "Fetched remotes.") }
    if (action === "pull") { await runtime.pull(repoPath); return refreshed(runtime, repoPath, "Pulled remote changes.") }
    if (action === "push") {
      if (!input.message && !(await runtime.getRepository(repoPath)).files.some((file) => file.staged)) {
        const pushed = await runtime.push(repoPath)
        return refreshed(runtime, repoPath, `Pushed ${pushed.branch} to ${pushed.remote}.`, { pushed: true })
      }
      return commitWithDiny(input, runtime, repoPath, "push", onEvent)
    }
    if (action === "status") return refreshed(runtime, repoPath, "Repository refreshed.")
    return commitWithDiny(input, runtime, repoPath, action, onEvent)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

async function commitWithDiny(input: GitalsoInput, runtime: GitalsoRuntime, repoPath: string, action: "generate" | "commit" | "push", onEvent: (event: NodeRunEvent) => void): Promise<NodeRunResult<GitalsoData>> {
  const repository = await runtime.getRepository(repoPath)
  if (!repository.files.some((file) => file.staged)) return fail("No staged files. Stage changes before generating a commit message.", { repository })
  const noVerify = input.noVerify ?? false
  const dryRun = input.dryRun ?? false
  const diny = await runtime.resolveDiny(input.dinyPath)
  if (!diny.found && !clean(input.message)) return fail("diny is not installed. Enter a commit message manually, or install diny for AI generation.", { repository, dinyInstalled: false })
  let message = clean(input.message)
  if (!message) {
    onEvent({ type: "progress", progress: 35, message: "Generating a commit message with diny." })
    const result = await runtime.runDinyPrint({ dinyPath: diny.path, repoPath, noVerify, timeout: input.timeout ?? 60_000 })
    if (result.code !== 0 && !result.stdout.trim()) return fail(`diny failed: ${result.stderr || "Unknown error"}`, { repository, dinyInstalled: true, dinyVersion: diny.version })
    message = parseDinyOutput(result.stdout) ?? ""
    if (!message) return fail("diny produced no commit message.", { repository, dinyInstalled: true, dinyVersion: diny.version })
  }
  if (action === "generate") return ok("Commit message generated.", { repository, dinyInstalled: diny.found, dinyVersion: diny.version, commitMessage: message })
  if (dryRun) return ok(`Dry-run: would commit on ${repository.branch}.`, { repository, dinyInstalled: diny.found, dinyVersion: diny.version, commitMessage: message })
  onEvent({ type: "progress", progress: 75, message: "Creating commit." })
  const commit = await runtime.commit(repoPath, message, noVerify)
  if (action === "push") await runtime.push(repoPath)
  return refreshed(runtime, repoPath, `${action === "push" ? "Committed and pushed" : "Committed"}: ${commit.hash.slice(0, 7)}`, { dinyInstalled: diny.found, dinyVersion: diny.version, commitMessage: message, committed: true, pushed: action === "push", commitHash: commit.hash })
}

async function refreshed(runtime: GitalsoRuntime, repoPath: string, message: string, extra: Partial<GitalsoData> = {}): Promise<NodeRunResult<GitalsoData>> {
  return ok(message, { repository: await runtime.getRepository(repoPath), ...extra })
}

function ensurePaths(paths: string[], message: string) { if (!paths.length) throw new Error(message) }
export function parseDinyOutput(stdout: string): string | null {
  const lines = stdout.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return null
  const prefix = lines.findIndex((line) => /^(generated )?commit message:|^suggested message:/i.test(line.trim()))
  return lines.slice(prefix >= 0 ? prefix + 1 : 0).join("\n").trim() || null
}
function clean(value?: string) { return (value ?? "").trim().replace(/^["']|["']$/g, "") }
function data(partial: Partial<GitalsoData>): DinyData {
  const value = { repository: null, dinyInstalled: false, dinyVersion: null, commitMessage: null, committed: false, pushed: false, commitHash: null, errors: [], ...partial }
  const repository = value.repository
  return { ...value, git: repository ? { branch: repository.branch, stagedFiles: repository.files.filter((file) => file.staged).map((file) => ({ path: file.path, status: file.index, insertions: 0, deletions: 0 })), diffStat: { insertions: 0, deletions: 0, files: repository.files.filter((file) => file.staged).length }, diffPreview: repository.stagedDiff } : null }
}
function ok(message: string, partial: Partial<GitalsoData>): NodeRunResult<DinyData> { return { success: true, message, data: data(partial) } }
function fail(message: string, partial: Partial<GitalsoData> = {}): NodeRunResult<DinyData> { return { success: false, message, data: data({ ...partial, errors: [message] }) } }
