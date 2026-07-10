import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

// ── Types ──────────────────────────────────────────────

export type DinyAction = "status" | "generate" | "commit" | "push"

export interface DinyInput {
  action?: DinyAction
  /** Working directory for git operations. Defaults to cwd. */
  repoPath?: string
  /** Override diny binary path. If empty, resolves from PATH. */
  dinyPath?: string
  /** Pass --no-verify to diny (skip pre-commit hooks). */
  noVerify?: boolean
  /** Manually edited message — skip diny generation and commit directly. */
  message?: string
  /** Dry-run: preview what would happen without committing. */
  dryRun?: boolean
  /** Timeout in ms for diny AI generation. Defaults to 60_000. */
  timeout?: number
}

export interface DinyStagedFile {
  path: string
  status: string // "M", "A", "D", "R", "C"
  insertions: number
  deletions: number
}

export interface DinyGitInfo {
  branch: string
  stagedFiles: DinyStagedFile[]
  diffStat: { insertions: number; deletions: number; files: number }
  diffPreview: string
}

export interface DinyData {
  message: string
  dinyInstalled: boolean
  dinyVersion: string | null
  git: DinyGitInfo | null
  /** AI-generated commit message (from diny commit --print). */
  commitMessage: string | null
  committed: boolean
  pushed: boolean
  commitHash: string | null
  errors: string[]
}

// ── Runtime interface ──────────────────────────────────

export interface DinyRuntime {
  /** Check if diny binary exists in PATH or at the given path. */
  resolveDiny: (path?: string) => Promise<{ found: boolean; path: string; version: string | null }>
  /** Run `diny commit --print` and return stdout. */
  runDinyPrint: (options: { dinyPath: string; repoPath: string; noVerify: boolean; timeout: number }) => Promise<{ stdout: string; stderr: string; code: number }>
  /** Get staged file list with status codes. */
  getStagedFiles: (repoPath: string) => Promise<DinyStagedFile[]>
  /** Get staged diff text (truncated for preview). */
  getStagedDiff: (repoPath: string, maxLines?: number) => Promise<string>
  /** Get diff stat summary. */
  getDiffStat: (repoPath: string) => Promise<{ insertions: number; deletions: number; files: number }>
  /** Get current branch name. */
  getCurrentBranch: (repoPath: string) => Promise<string>
  /** Create a git commit with the given message. */
  commit: (repoPath: string, message: string, noVerify: boolean) => Promise<{ hash: string; summary: string }>
  /** Push current branch to remote. */
  push: (repoPath: string) => Promise<{ remote: string; branch: string }>
}

// ── Constants ──────────────────────────────────────────

const MAX_DIFF_PREVIEW_LINES = 200

// ── Main entry ─────────────────────────────────────────

export async function runDiny(
  input: DinyInput,
  runtime: DinyRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<NodeRunResult<DinyData>> {
  const normalized = normalizeInput(input)
  try {
    // 1. Check diny installation
    onEvent({ type: "progress", progress: 10, message: "Checking diny installation." })
    const dinyCheck = await runtime.resolveDiny(normalized.dinyPath)
    if (!dinyCheck.found) {
      return failure("diny binary not found. Install it via `scoop install diny` or download from https://github.com/dinoDanic/diny/releases.", {
        dinyInstalled: false,
        dinyVersion: null,
        git: null,
        commitMessage: null,
        committed: false,
        pushed: false,
        commitHash: null,
        errors: ["diny not found in PATH"],
      })
    }

    // 2. Gather git info
    onEvent({ type: "progress", progress: 20, message: "Reading staged changes." })
    const [branch, stagedFiles, diffStat, diffPreview] = await Promise.all([
      runtime.getCurrentBranch(normalized.repoPath),
      runtime.getStagedFiles(normalized.repoPath),
      runtime.getDiffStat(normalized.repoPath),
      runtime.getStagedDiff(normalized.repoPath, MAX_DIFF_PREVIEW_LINES),
    ])

    if (stagedFiles.length === 0) {
      return failure("No staged files found. Use `git add` to stage changes first.", {
        dinyInstalled: true,
        dinyVersion: dinyCheck.version,
        git: { branch, stagedFiles: [], diffStat, diffPreview: "" },
        commitMessage: null,
        committed: false,
        pushed: false,
        commitHash: null,
        errors: ["No staged files"],
      })
    }

    const git: DinyGitInfo = { branch, stagedFiles, diffStat, diffPreview }

    // status: just return git info, no generation
    if (normalized.action === "status") {
      return success(`diny status: ${stagedFiles.length} file(s) staged on ${branch}.`, {
        dinyInstalled: true,
        dinyVersion: dinyCheck.version,
        git,
        commitMessage: null,
        committed: false,
        pushed: false,
        commitHash: null,
      })
    }

    // 3. Generate or use provided message
    let commitMessage: string | null = null

    if (normalized.message) {
      // User provided a manual message, skip diny generation
      commitMessage = normalized.message
      onEvent({ type: "progress", progress: 50, message: "Using manually provided commit message." })
    } else {
      // Call diny commit --print
      onEvent({ type: "progress", progress: 30, message: "Generating commit message with diny AI." })
      const result = await runtime.runDinyPrint({
        dinyPath: dinyCheck.path,
        repoPath: normalized.repoPath,
        noVerify: normalized.noVerify,
        timeout: normalized.timeout,
      })

      if (result.code !== 0 && !result.stdout.trim()) {
        return failure(`diny failed: ${result.stderr || "Unknown error"}`, {
          dinyInstalled: true,
          dinyVersion: dinyCheck.version,
          git,
          commitMessage: null,
          committed: false,
          pushed: false,
          commitHash: null,
          errors: [result.stderr || `diny exited with code ${result.code}`],
        })
      }

      commitMessage = parseDinyOutput(result.stdout)
      if (!commitMessage) {
        return failure("diny produced no commit message output.", {
          dinyInstalled: true,
          dinyVersion: dinyCheck.version,
          git,
          commitMessage: null,
          committed: false,
          pushed: false,
          commitHash: null,
          errors: ["diny output was empty"],
        })
      }
    }

    onEvent({ type: "progress", progress: 60, message: "Commit message generated." })

    // generate: return message without committing
    if (normalized.action === "generate") {
      return success(`Generated commit message for ${stagedFiles.length} file(s).`, {
        dinyInstalled: true,
        dinyVersion: dinyCheck.version,
        git,
        commitMessage,
        committed: false,
        pushed: false,
        commitHash: null,
      })
    }

    // 4. Dry-run: preview without committing
    if (normalized.dryRun) {
      return success(`Dry-run: would commit "${commitMessage}" on ${branch}.`, {
        dinyInstalled: true,
        dinyVersion: dinyCheck.version,
        git,
        commitMessage,
        committed: false,
        pushed: false,
        commitHash: null,
      })
    }

    // 5. Commit
    onEvent({ type: "progress", progress: 75, message: "Creating commit." })
    const commitResult = await runtime.commit(normalized.repoPath, commitMessage, normalized.noVerify)

    // 6. Push (if action is "push")
    let pushed = false
    if (normalized.action === "push") {
      onEvent({ type: "progress", progress: 90, message: "Pushing to remote." })
      await runtime.push(normalized.repoPath)
      pushed = true
    }

    onEvent({ type: "progress", progress: 100, message: "Done." })
    return success(`Committed${pushed ? " and pushed" : ""}: ${commitResult.hash.slice(0, 7)}`, {
      dinyInstalled: true,
      dinyVersion: dinyCheck.version,
      git,
      commitMessage,
      committed: true,
      pushed,
      commitHash: commitResult.hash,
    })
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

// ── Helpers ─────────────────────────────────────────────

/**
 * Parse diny commit --print stdout.
 *
 * diny prints the commit message to stdout. It may include:
 * - ANSI color codes (stripped)
 * - A trailing newline
 * - Optional prefix lines like "Generated commit message:"
 *
 * We take the first non-empty meaningful block and strip ANSI.
 */
export function parseDinyOutput(stdout: string): string | null {
  // Strip ANSI escape sequences
  const clean = stdout.replace(/\x1b\[[0-9;]*m/g, "")

  // diny may print informational lines before the message.
  // The actual commit message is typically the last meaningful block.
  const lines = clean.split(/\r?\n/).filter((line) => line.trim())

  if (lines.length === 0) return null

  // If there's only one line, that's the message
  if (lines.length === 1) return lines[0]!.trim()

  // If diny outputs a known prefix, skip lines up to and including it
  const knownPrefixes = ["Generated commit message:", "Commit message:", "Suggested message:"]
  let startIndex = 0
  for (let i = 0; i < lines.length; i++) {
    if (knownPrefixes.some((p) => lines[i]!.startsWith(p))) {
      startIndex = i + 1
      break
    }
  }

  // Take remaining lines as the commit message
  const messageLines = lines.slice(startIndex)
  if (messageLines.length === 0) return null

  // If it's a conventional commit (e.g., "feat: ..."), take the whole block
  return messageLines.join("\n").trim()
}

export function normalizeInput(input: DinyInput): Required<DinyInput> {
  return {
    action: input.action ?? "generate",
    repoPath: clean(input.repoPath) || process.cwd(),
    dinyPath: clean(input.dinyPath),
    noVerify: input.noVerify ?? false,
    message: clean(input.message),
    dryRun: input.dryRun ?? false,
    timeout: input.timeout ?? 60_000,
  }
}

// ── Internal utilities ─────────────────────────────────

function data(partial: Partial<DinyData>): DinyData {
  return {
    message: "",
    dinyInstalled: false,
    dinyVersion: null,
    git: null,
    commitMessage: null,
    committed: false,
    pushed: false,
    commitHash: null,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<DinyData>): NodeRunResult<DinyData> {
  return { success: true, message, data: data(partial) }
}

function failure(message: string, partial?: Partial<DinyData>): NodeRunResult<DinyData> {
  return { success: false, message, data: data({ ...partial, errors: partial?.errors ?? [message] }) }
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}
