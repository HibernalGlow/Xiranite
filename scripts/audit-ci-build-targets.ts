/**
 * Gate: every build target the workflows name must resolve in the same tree that carries the workflow.
 *
 * Why this exists — measured, not inferred. The pushed branch tip `a94b5500` contains a `rust-host` job with
 * three steps that call `cargo … -p quickjs-host-protocol` and `-p quickjs-realm`, but `cargo metadata
 * --no-deps` on a clean checkout of that same commit answers 14 workspace members and neither crate among
 * them: the ADR-0078 crate split was committed as *workflow + docs* while the crates, `[workspace] members`
 * and `Cargo.lock` stayed uncommitted. Those steps would have failed with
 * `package ID specification ... did not match any packages` — after the runner had already paid for a full
 * `bun install` and `build:node-bundles` on three operating systems.
 *
 * AGENTS.md ("门禁必须检查实际构建参数与真实注册表") is the rule this implements: the registry here is
 * `cargo metadata` (the real workspace, not a directory listing) and the build arguments are the literal
 * `-p`/`bun run` tokens in `.github/workflows/*`. A workflow that names a target nobody committed is a
 * workflow that cannot pass, and it must say so in five seconds instead of in thirty minutes.
 *
 * The scan is deliberately textual: `run:` blocks are shell strings, and the only thing worth reading out of
 * them is which targets they name. No YAML library is imported because neither `yaml` nor `js-yaml` is a
 * declared dependency of this workspace — both are only present transitively, and a gate must not rest on an
 * undeclared hoisting accident. The body is standard Node syntax with no Bun-specific API (ADR-0075), but CI
 * invokes it through `bun` rather than `node`: runners ship a preinstalled `node`, and executing a `.ts` file
 * directly needs type stripping, which is default-on only from Node 22.18 / 23.6 — a runner image that lags
 * there would fail the gate on a toolchain detail instead of on the drift it exists to catch.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** One `-p <package>` or `bun run <script>` mention, kept with its location so a finding is actionable. */
export interface TargetMention {
  /** Path relative to the repository root, e.g. `.github/workflows/ci.yml`. */
  file: string
  line: number
  /** The command that named it, trimmed — printed verbatim so a reader sees the whole build argument. */
  command: string
  target: string
}

export interface WorkflowTargets {
  cargoPackages: TargetMention[]
  bunScripts: TargetMention[]
  scriptFiles: TargetMention[]
}

/** Matches a `-p`/`--package` flag whose value is a bare package name (`-p foo` and `-p=foo`). */
const CARGO_PACKAGE = /(?:^|\s)(?:-p|--package)[=\s]([A-Za-z0-9][A-Za-z0-9_.-]*)/g
/** Matches `bun run <script>`; a following flag (`--cwd`, `-b`) is not a script name and must not be read as one. */
const BUN_SCRIPT = /\bbun\s+run\s+([A-Za-z0-9][A-Za-z0-9_:.-]*)/g
/** Matches a directly-invoked `bun|node scripts/<path>.ts`, which bypasses the script table entirely. */
const SCRIPT_PATH = /\b(?:bun|node)\s+(scripts\/[A-Za-z0-9_./-]+\.ts)/g

/**
 * Reads the build arguments out of one workflow file. Only lines that carry a command are inspected: a `#`
 * comment naming `-p xiranite-desktop` is prose about the job, not a build argument, and reading it as one
 * would make the gate fail on a comment.
 */
export function extractTargets(file: string, text: string): WorkflowTargets {
  const targets: WorkflowTargets = { cargoPackages: [], bunScripts: [], scriptFiles: [] }
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith("#") || line.startsWith("- #") || line.startsWith("name:")) return
    // A `run:` value is what actually executes. Also accept continuation lines of a multi-line `run: |` block,
    // which carry no key of their own, so anything that is not a YAML mapping line counts as command text.
    if (/^[A-Za-z0-9_-]+:\s/.test(line) && !line.startsWith("run:")) return
    const command = line.replace(/^run:\s*/, "").replace(/^-\s*/, "")
    if (!command || /^[A-Za-z0-9_-]+:$/.test(command)) return
    const location = { file, line: index + 1, command }
    for (const match of command.matchAll(CARGO_PACKAGE)) {
      targets.cargoPackages.push({ ...location, target: match[1] })
    }
    for (const match of command.matchAll(BUN_SCRIPT)) {
      targets.bunScripts.push({ ...location, target: match[1] })
    }
    for (const match of command.matchAll(SCRIPT_PATH)) {
      targets.scriptFiles.push({ ...location, target: match[1] })
    }
  })
  return targets
}

export interface TargetUniverse {
  /** Package names the real Cargo workspace resolves (`cargo metadata`, not a directory listing). */
  cargoMembers: string[]
  /** Keys of the root `package.json` scripts table. */
  packageScripts: string[]
  /** Existence of a repository-relative file path. */
  fileExists(relativePath: string): boolean
}

/**
 * Compares named targets against the universe. Returns one finding per unresolved mention, plus the two
 * blindness guards: a workflow set that names no cargo target at all, or a workspace that resolves to no
 * members, would otherwise report an empty difference as success.
 */
export function checkTargets(all: WorkflowTargets[], universe: TargetUniverse): string[] {
  const findings: string[] = []
  const members = new Set(universe.cargoMembers)
  const scripts = new Set(universe.packageScripts)

  if (universe.cargoMembers.length === 0) {
    return ["cargo metadata reported no workspace members — the gate cannot grade anything"]
  }

  const cargo = all.flatMap((t) => t.cargoPackages)
  const bun = all.flatMap((t) => t.bunScripts)
  const paths = all.flatMap((t) => t.scriptFiles)

  // A workflow set that names nothing would produce an empty difference and read as success.
  if (cargo.length === 0 && bun.length === 0 && paths.length === 0) {
    return ["no workflow names a cargo `-p` target, a `bun run` script or a `scripts/*.ts` path — the scan is blind, not clean"]
  }

  for (const mention of cargo) {
    if (!members.has(mention.target)) {
      findings.push(`${mention.file}:${mention.line}: cargo names "${mention.target}", which is not a workspace member — ${mention.command}`)
    }
  }
  for (const mention of bun) {
    if (!scripts.has(mention.target)) {
      findings.push(`${mention.file}:${mention.line}: "bun run ${mention.target}" names no script in package.json — ${mention.command}`)
    }
  }
  for (const mention of paths) {
    if (!universe.fileExists(mention.target)) {
      findings.push(`${mention.file}:${mention.line}: ${mention.target} does not exist in the tree — ${mention.command}`)
    }
  }
  return findings
}

export function readWorkflows(root = repoRoot): WorkflowTargets[] {
  const dir = join(root, ".github", "workflows")
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
    .map((name) => {
      const file = `.github/workflows/${name}`
      return extractTargets(file, readFileSync(join(dir, name), "utf8"))
    })
}

export function cargoWorkspaceMembers(root = repoRoot): string[] {
  const result = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps", "--locked"], {
    cwd: root,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(`cargo metadata failed (rc=${result.status}): ${(result.stderr || result.stdout).trim().slice(0, 400)}`)
  }
  const parsed = JSON.parse(result.stdout) as { packages?: { name: string }[] }
  return (parsed.packages ?? []).map((pkg) => pkg.name).sort()
}

export function packageScriptNames(root = repoRoot): string[] {
  const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> }
  return Object.keys(parsed.scripts ?? {})
}

function main(): number {
  const targets = readWorkflows()
  const universe: TargetUniverse = {
    cargoMembers: cargoWorkspaceMembers(),
    packageScripts: packageScriptNames(),
    fileExists: (relativePath) => existsSync(join(repoRoot, relativePath)),
  }
  const findings = checkTargets(targets, universe)
  const counted = targets.reduce((sum, t) => sum + t.cargoPackages.length + t.bunScripts.length + t.scriptFiles.length, 0)
  for (const finding of findings) console.error(`FAIL ${finding}`)
  console.log(
    `CI build targets: ${counted} mentions over ${targets.length} workflows against ${universe.cargoMembers.length} workspace members and ${universe.packageScripts.length} scripts — ${findings.length ? `${findings.length} FAIL` : "ok"}`,
  )
  return findings.length === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main()
}
