import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import { promisify } from "node:util"
import { simpleGit } from "simple-git"
import type { GitalsoRepository, GitalsoRuntime } from "./core.js"

const execFileAsync = promisify(execFile)

export function createNodeGitalsoRuntime(): GitalsoRuntime {
  return { defaultRepoPath: async () => process.cwd(), getRepository, stage, unstage, stageAll, unstageAll, createBranch, checkoutBranch, fetch, pull, push, commit, resolveDiny, runDinyPrint, gitButlerCommit }
}

async function getRepository(repoPath: string): Promise<GitalsoRepository> {
  const git = simpleGit(repoPath)
  const [status, branches, log, remotes, root] = await Promise.all([
    git.status(), git.branchLocal(), git.log({ maxCount: 20 }), git.getRemotes(true), git.revparse(["--show-toplevel"]),
  ])
  const files = status.files.map((file) => ({ path: file.path, index: file.index, workingTree: file.working_dir, staged: file.index !== " " && file.index !== "?", unstaged: file.working_dir !== " " && file.working_dir !== "?" }))
  return {
    root: root.trim(), branch: branches.current || "HEAD", files,
    branches: Object.entries(branches.branches).map(([name, branch]) => ({ name, current: branch.current, remote: branch.label || undefined })),
    commits: log.all.map((entry) => ({ hash: entry.hash, message: entry.message, author: entry.author_name, date: entry.date })),
    remotes: remotes.map((remote) => remote.name), ahead: status.ahead, behind: status.behind,
    stagedDiff: await limitedDiff(git),
  }
}

async function limitedDiff(git: ReturnType<typeof simpleGit>) {
  const diff = await git.diff(["--cached"])
  const lines = diff.split("\n")
  return lines.length > 200 ? `${lines.slice(0, 200).join("\n")}\n… ${lines.length - 200} lines truncated` : diff
}
async function stage(repoPath: string, paths: string[]) { await simpleGit(repoPath).add(paths) }
async function unstage(repoPath: string, paths: string[]) { await simpleGit(repoPath).reset(["--", ...paths]) }
async function stageAll(repoPath: string) { await simpleGit(repoPath).add(".") }
async function unstageAll(repoPath: string) { await simpleGit(repoPath).reset() }
async function createBranch(repoPath: string, branchName: string) { await simpleGit(repoPath).checkoutLocalBranch(branchName) }
async function checkoutBranch(repoPath: string, branchName: string) { await simpleGit(repoPath).checkout(branchName) }
async function fetch(repoPath: string) { await simpleGit(repoPath).fetch() }
async function pull(repoPath: string) { await simpleGit(repoPath).pull() }
async function push(repoPath: string) {
  const git = simpleGit(repoPath)
  const branch = (await git.branch()).current || "HEAD"
  await git.raw(["push", "-u", "origin", branch])
  return { remote: "origin", branch }
}
async function commit(repoPath: string, message: string, noVerify: boolean) {
  const git = simpleGit(repoPath)
  if (noVerify) await git.raw(["commit", "-m", message, "--no-verify"])
  else await git.commit(message)
  return { hash: await git.revparse(["HEAD"]) }
}
async function resolveDiny(path?: string) {
  if (path) { try { await stat(path); return { found: true, path, version: await dinyVersion(path) } } catch { return { found: false, path: "", version: null } } }
  const binary = process.platform === "win32" ? "diny.exe" : "diny"
  try { const version = await dinyVersion(binary); return { found: Boolean(version), path: binary, version } } catch { return { found: false, path: "", version: null } }
}
async function dinyVersion(binary: string) {
  const { stdout } = await execFileAsync(binary, ["--version"], { timeout: 10_000, windowsHide: true })
  return stdout.match(/v?\d+\.\d+\.\d+/)?.[0] ?? (stdout.trim() || null)
}
async function runDinyPrint(options: { dinyPath: string; repoPath: string; noVerify: boolean; timeout: number }) {
  try {
    const args = ["commit", "--print", ...(options.noVerify ? ["--no-verify"] : [])]
    const { stdout, stderr } = await execFileAsync(options.dinyPath, args, { cwd: options.repoPath, timeout: options.timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const item = error as { stdout?: string; stderr?: string; code?: number; message: string }
    return { stdout: item.stdout ?? "", stderr: item.stderr ?? item.message, code: item.code ?? 1 }
  }
}
async function gitButlerCommit(repoPath: string) {
  await execFileAsync("but", ["setup", "--format", "json"], { cwd: repoPath, windowsHide: true })
  const { stdout } = await execFileAsync("but", ["commit", "--ai", "--format", "json"], { cwd: repoPath, windowsHide: true })
  const result = JSON.parse(stdout) as { result?: { commit_id?: string; branch?: string }; status?: { stacks?: Array<{ branches?: Array<{ commits?: Array<{ message?: string }> }> }> } }
  const hash = result.result?.commit_id; const branch = result.result?.branch
  if (!hash || !branch) throw new Error("GitButler did not return a commit branch or hash.")
  await execFileAsync("but", ["land", branch, "--yes", "--format", "json"], { cwd: repoPath, windowsHide: true })
  return { hash, message: result.status?.stacks?.[0]?.branches?.[0]?.commits?.[0]?.message?.trim() ?? "" }
}
