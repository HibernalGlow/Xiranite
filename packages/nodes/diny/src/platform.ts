import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { stat } from "node:fs/promises"
import { simpleGit } from "simple-git"
import type { DinyRuntime, DinyStagedFile } from "./core.js"

const execFileAsync = promisify(execFile)

export function createNodeDinyRuntime(): DinyRuntime {
  return {
    resolveDiny,
    runDinyPrint,
    getStagedFiles,
    getStagedDiff,
    getDiffStat,
    getCurrentBranch,
    commit,
    push,
  }
}

// ── diny binary operations ──────────────────────────────

async function resolveDiny(path?: string): Promise<{ found: boolean; path: string; version: string | null }> {
  if (path) {
    try {
      await stat(path)
      const version = await getDinyVersion(path)
      return { found: true, path, version }
    } catch {
      // path doesn't exist, fall through to PATH lookup
    }
  }

  const binaryName = process.platform === "win32" ? "diny.exe" : "diny"
  try {
    const version = await getDinyVersion(binaryName)
    if (version) {
      return { found: true, path: binaryName, version }
    }
  } catch {
    // not found
  }

  return { found: false, path: "", version: null }
}

async function getDinyVersion(binaryPath: string): Promise<string | null> {
  for (const args of [["--version"], ["version"]]) {
    try {
      const { stdout } = await execFileAsync(binaryPath, args, { timeout: 10_000, windowsHide: true })
      const match = stdout.match(/v?\d+\.\d+\.\d+/)
      return match ? match[0] : stdout.trim() || null
    } catch {
      // Older diny releases accepted `version`; the current CLI uses `--version`.
    }
  }
  return null
}

async function runDinyPrint(options: {
  dinyPath: string
  repoPath: string
  noVerify: boolean
  timeout: number
}): Promise<{ stdout: string; stderr: string; code: number }> {
  const args = ["commit", "--print"]
  if (options.noVerify) args.push("--no-verify")

  try {
    const { stdout, stderr } = await execFileAsync(options.dinyPath, args, {
      cwd: options.repoPath,
      timeout: options.timeout,
      maxBuffer: 1024 * 1024 * 4,
      windowsHide: true,
    })
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number | string; message: string; killed?: boolean }
    if (err.killed) {
      return { stdout: "", stderr: `diny timed out after ${options.timeout}ms`, code: -1 }
    }
    return {
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message),
      code: typeof err.code === "number" ? err.code : 1,
    }
  }
}

// ── Git operations via simple-git ───────────────────────

async function getStagedFiles(repoPath: string): Promise<DinyStagedFile[]> {
  const git = simpleGit(repoPath)
  const status = await git.status()

  // status.staged is string[], status.files has the status codes
  const fileStatusMap = new Map<string, string>()
  for (const f of status.files) {
    fileStatusMap.set(f.path, f.index)
  }

  const staged: DinyStagedFile[] = []
  for (const filePath of status.staged) {
    const diff = await git.diff(["--numstat", "--cached", "--", filePath])
    const [ins, del] = diff.trim().split(/\s+/)
    staged.push({
      path: filePath,
      status: fileStatusMap.get(filePath) ?? "M",
      insertions: Number(ins) || 0,
      deletions: Number(del) || 0,
    })
  }

  return staged
}

async function getStagedDiff(repoPath: string, maxLines = 200): Promise<string> {
  const git = simpleGit(repoPath)
  const diff = await git.diff(["--cached"])
  const lines = diff.split("\n")
  if (lines.length <= maxLines) return diff
  return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines truncated)`
}

async function getDiffStat(repoPath: string): Promise<{ insertions: number; deletions: number; files: number }> {
  const git = simpleGit(repoPath)
  const diff = await git.diff(["--cached", "--numstat"])
  let insertions = 0
  let deletions = 0
  const lines = diff.trim().split("\n").filter(Boolean)
  for (const line of lines) {
    const [ins, del] = line.split(/\s+/)
    insertions += Number(ins) || 0
    deletions += Number(del) || 0
  }
  return { insertions, deletions, files: lines.length }
}

async function getCurrentBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath)
  const branch = await git.branch()
  return branch.current || "HEAD"
}

async function commit(repoPath: string, message: string, noVerify: boolean): Promise<{ hash: string; summary: string }> {
  const git = simpleGit(repoPath)
  if (noVerify) {
    // Use raw command for --no-verify since simple-git options don't type-check it
    await git.raw(["commit", "-m", message, "--no-verify"])
  } else {
    await git.commit(message)
  }
  // Get the commit hash
  const hash = await git.revparse(["HEAD"])
  return { hash, summary: "" }
}

async function push(repoPath: string): Promise<{ remote: string; branch: string }> {
  const git = simpleGit(repoPath)
  const branch = await git.branch()
  const branchName = branch.current || "HEAD"
  // Use raw command for --set-upstream
  await git.raw(["push", "-u", "origin", branchName])
  return { remote: "origin", branch: branchName }
}
