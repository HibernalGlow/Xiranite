import { readdir, readFile, stat } from "node:fs/promises"
import { extname, relative, resolve, sep } from "node:path"

const MAX_LINES = 1000
const WARN_LINES = 800
const REPO_ROOT = resolve(import.meta.dir, "..")
const MAINTAINED_ROOTS = ["src", "packages", "scripts", "cmd", "native", "examples"]
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".go",
  ".js",
  ".jsx",
  ".mjs",
  ".rs",
  ".scss",
  ".svelte",
  ".ts",
  ".tsx",
  ".vue",
])
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".turbo",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "migration",
  "node_modules",
  "test-results",
  "vendor",
])

type Mode = "all" | "changed"

interface SourceReport {
  baseLines: number | null
  lines: number
  path: string
}

const args = new Set(process.argv.slice(2))
const mode: Mode = args.has("--all") ? "all" : "changed"
const strict = args.has("--strict")

function normalizePath(path: string): string {
  return path.split(sep).join("/").replaceAll("\\", "/")
}

function isMaintainedSource(path: string): boolean {
  const normalized = normalizePath(path)
  const segments = normalized.split("/")
  const extension = extname(normalized).toLowerCase()

  if (!SOURCE_EXTENSIONS.has(extension) || segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false
  return MAINTAINED_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))
}

function decode(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim()
}

function runGit(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: REPO_ROOT, stderr: "pipe", stdout: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error(decode(result.stderr) || `git ${args.join(" ")} failed`)
  }
  return decode(result.stdout)
}

function lineCount(source: string): number {
  if (source.length === 0) return 0
  const normalized = source.replaceAll("\r\n", "\n")
  return normalized.endsWith("\n") ? normalized.split("\n").length - 1 : normalized.split("\n").length
}

async function collectAllSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name)
    const relativePath = normalizePath(relative(REPO_ROOT, absolutePath))
    if (entry.isDirectory()) {
      if (!EXCLUDED_SEGMENTS.has(entry.name)) files.push(...await collectAllSourceFiles(absolutePath))
    } else if (entry.isFile() && isMaintainedSource(relativePath)) {
      files.push(relativePath)
    }
  }

  return files
}

function collectChangedSourceFiles(): string[] {
  const tracked = runGit(["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD", "--"]).split(/\r?\n/).filter(Boolean)
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean)
  return [...new Set([...tracked, ...untracked].map(normalizePath).filter(isMaintainedSource))]
}

async function readCurrentSource(path: string): Promise<string> {
  return readFile(resolve(REPO_ROOT, path), "utf8")
}

function readBaseSource(path: string): string | null {
  const trackedResult = Bun.spawnSync(["git", "ls-files", "--error-unmatch", "--", path], { cwd: REPO_ROOT, stderr: "pipe", stdout: "pipe" })
  if (trackedResult.exitCode !== 0) return null
  const result = Bun.spawnSync(["git", "show", `HEAD:${path}`], { cwd: REPO_ROOT, stderr: "pipe", stdout: "pipe" })
  return result.exitCode === 0 ? new TextDecoder().decode(result.stdout) : null
}

function formatReport(report: SourceReport): string {
  const base = report.baseLines === null ? "" : ` (base ${report.baseLines})`
  return `${report.lines} lines${base}  ${report.path}`
}

const sourceFiles = mode === "all"
  ? (await Promise.all(MAINTAINED_ROOTS.map(async (root) => {
      const absoluteRoot = resolve(REPO_ROOT, root)
      return (await stat(absoluteRoot).catch(() => null))?.isDirectory() ? collectAllSourceFiles(absoluteRoot) : []
    }))).flat()
  : collectChangedSourceFiles()

const reports: SourceReport[] = []
for (const path of sourceFiles) {
  const current = await readCurrentSource(path)
  const base = mode === "changed" ? readBaseSource(path) : null
  reports.push({
    baseLines: base === null ? null : lineCount(base),
    lines: lineCount(current),
    path,
  })
}

const warnings = reports.filter((report) => report.lines >= WARN_LINES && report.lines <= MAX_LINES)
const overLimit = reports.filter((report) => report.lines > MAX_LINES)
const errors = mode === "all"
  ? (strict ? overLimit : [])
  : overLimit.filter((report) => report.baseLines === null || report.baseLines <= MAX_LINES || report.lines > (report.baseLines ?? 0))

if (reports.length === 0) {
  console.log(mode === "all" ? "No maintained source files found." : "No changed maintained source files.")
} else {
  if (warnings.length > 0) {
    console.log(`Warnings (>= ${WARN_LINES} lines):`)
    for (const report of warnings.sort((left, right) => right.lines - left.lines)) console.log(`  ${formatReport(report)}`)
  }
  if (overLimit.length > 0) {
    console.log(`${mode === "all" && !strict ? "Historical files over" : "Files over"} ${MAX_LINES} lines:`)
    for (const report of overLimit.sort((left, right) => right.lines - left.lines)) console.log(`  ${formatReport(report)}`)
  }
  if (errors.length > 0) {
    console.error(`Source-size check failed for ${errors.length} file(s). Split new or growing files before continuing.`)
    process.exitCode = 1
  } else if (mode === "all" && overLimit.length > 0 && !strict) {
    console.log("Historical source-size debt reported; use --strict to fail on it.")
  } else {
    console.log("Source-size check passed.")
  }
}
