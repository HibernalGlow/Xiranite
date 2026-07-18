#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

type BumpKind = "major" | "minor" | "patch"

interface ReleaseOptions {
  bump: BumpKind | string
  dryRun: boolean
  remote: string
  tagPrefix: string
}

const repoRoot = new URL("..", import.meta.url)
const packageJsonUrl = new URL("package.json", repoRoot)
const repoRootPath = fileURLToPath(repoRoot)
const gitCommand = resolveGitCommand()

const options = parseArgs(process.argv.slice(2))
const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8")) as { version?: string }
const currentVersion = parseVersion(packageJson.version ?? "")
const nextVersion = resolveNextVersion(options.bump, currentVersion)
if (compareVersion(nextVersion, currentVersion) <= 0) {
  fail(`Next version ${formatVersion(nextVersion)} must be greater than current version ${formatVersion(currentVersion)}.`)
}
const tagName = `${options.tagPrefix}${formatVersion(nextVersion)}`
const branch = git(["branch", "--show-current"]).trim()

if (!branch) {
  fail("Could not resolve the current git branch.")
}

ensureCleanWorktree()

console.log(`Releasing ${tagName} from ${branch}`)

if (!options.dryRun) {
  packageJson.version = formatVersion(nextVersion)
  await writeFile(packageJsonUrl, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8")
}

run([process.execPath, "install"], { dryRun: options.dryRun })

ensureNoExistingTag(tagName)
run([gitCommand, "add", "package.json", "bun.lock"], { dryRun: options.dryRun })
run([gitCommand, "commit", "-m", `chore(release): ${tagName}`], { dryRun: options.dryRun })
run([gitCommand, "tag", "-a", tagName, "-m", tagName], { dryRun: options.dryRun })
run([gitCommand, "push", options.remote, `HEAD:${branch}`], { dryRun: options.dryRun })
run([gitCommand, "push", options.remote, tagName], { dryRun: options.dryRun })

console.log(`${options.dryRun ? "Dry run complete" : "Released"} ${tagName}`)

function parseArgs(args: string[]): ReleaseOptions {
  const options: ReleaseOptions = {
    bump: "patch",
    dryRun: false,
    remote: "origin",
    tagPrefix: "v",
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }
    if (arg === "--remote") {
      options.remote = requireValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === "--tag-prefix") {
      options.tagPrefix = requireValue(args, index, arg)
      index += 1
      continue
    }
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
    if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`)
    }
    options.bump = arg
  }

  return options
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`)
  }
  return value
}

function printHelp(): void {
  console.log([
    "Usage: bun run release -- [patch|minor|major|x.y.z] [options]",
    "",
    "Options:",
    "  --dry-run             Print commands without changing files or pushing.",
    "  --remote <name>       Git remote to push to. Default: origin.",
    "  --tag-prefix <prefix> Tag prefix. Default: v.",
    "",
    "Examples:",
    "  bun run release:patch",
    "  bun run release -- patch",
    "  bun run release -- 0.2.0",
  ].join("\n"))
}

function parseVersion(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) {
    fail(`package.json version must be x.y.z, got "${value}".`)
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function resolveNextVersion(bump: string, current: [number, number, number]): [number, number, number] {
  if (bump === "major") return [current[0] + 1, 0, 0]
  if (bump === "minor") return [current[0], current[1] + 1, 0]
  if (bump === "patch") return [current[0], current[1], current[2] + 1]
  return parseVersion(bump)
}

function formatVersion(version: [number, number, number]): string {
  return version.join(".")
}

function compareVersion(a: [number, number, number], b: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function ensureCleanWorktree(): void {
  const status = git(["status", "--porcelain"]).trim()
  if (!status) return

  console.error(status)
  fail("Release requires a clean working tree. Commit or stash local changes first.")
}

function ensureNoExistingTag(tagName: string): void {
  const result = spawn([gitCommand, "rev-parse", "-q", "--verify", `refs/tags/${tagName}`])
  if (result.exitCode === 0) {
    fail(`Tag already exists: ${tagName}`)
  }
}

function git(args: string[]): string {
  const result = spawn([gitCommand, ...args])
  if (result.exitCode !== 0) {
    fail(result.stderr.trim() || `git ${args.join(" ")} failed.`)
  }
  return result.stdout
}

function run(command: string[], options: { allowFailure?: boolean; dryRun?: boolean } = {}): void {
  console.log(`$ ${command.join(" ")}`)
  if (options.dryRun) return

  const result = spawn(command, { inherit: true })
  if (result.exitCode !== 0 && !options.allowFailure) {
    fail(`${command.join(" ")} failed with exit code ${result.exitCode}.`)
  }
}

function spawn(command: string[], options: { inherit?: boolean } = {}): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, {
    cwd: repoRootPath,
    stdout: options.inherit ? "inherit" : "pipe",
    stderr: options.inherit ? "inherit" : "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout ? new TextDecoder().decode(result.stdout) : "",
    stderr: result.stderr ? new TextDecoder().decode(result.stderr) : "",
  }
}

function resolveGitCommand(): string {
  const candidates = [
    process.env.GIT_BIN,
    "git",
    "git.exe",
    "D:\\scoop\\apps\\git\\current\\cmd\\git.exe",
    "D:\\scoop\\apps\\git\\current\\bin\\git.exe",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files\\Git\\bin\\git.exe",
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const result = trySpawn([candidate, "--version"])
    if (result?.exitCode === 0) return candidate
  }

  fail("Could not find git. Set GIT_BIN to the full path of git.exe.")
}

function trySpawn(command: string[]): { exitCode: number } | undefined {
  try {
    return Bun.spawnSync(command, {
      cwd: repoRootPath,
      stdout: "pipe",
      stderr: "pipe",
    })
  } catch {
    return undefined
  }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
