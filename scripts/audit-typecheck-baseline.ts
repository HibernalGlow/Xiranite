/**
 * Ratchet for the only TypeScript gate that actually reads the product source.
 *
 * `tsc --noEmit` with the root tsconfig is a no-op: that file is `files: []` plus project references, and
 * `--noEmit` does not follow references. Measured, not inferred — pointing the same command at
 * `tsconfig.app.json` is what surfaces the real debt (796 when this was first measured on 2026-10-05, 103
 * at the time this gate was added). So the gate runs `tsc --noEmit -p tsconfig.app.json` and compares the
 * per-file error counts against `docs/typecheck-baseline.json`:
 *
 * - a file may stay where it is or go down; one more error than the baseline is red,
 * - a file the baseline does not know about is red the moment it errors, so debt cannot move sideways,
 * - the baseline is only ever written by `--update-baseline`. It is never seeded from a live run inside the
 *   gate, because a gate that grades its own homework cannot fail.
 *
 * Two failure modes of the *measurement* are refused rather than reported as success:
 *
 * - a halting syntax error (`'}' expected.`) makes tsc stop after one diagnostic, so the count collapses
 *   toward zero and a naive comparison would read that as a huge improvement. The parser is recognised by
 *   message shape and not by a code range because the 1000-1999 band also carries diagnostics that do not
 *   halt checking (TS1294, TS1484).
 * - exit status >= 2 means tsc itself failed (bad project, missing files); silence from it is not "clean".
 *
 * Counts are per file, not one number: a fix in one file must not pay for a regression in another.
 */
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export const GATE_PROJECT = "tsconfig.app.json"
export const GATE_BASELINE_PATH = "docs/typecheck-baseline.json"

export interface TypecheckBaseline {
  project: string
  total: number
  byFile: Record<string, number>
}

export interface TypecheckViolation {
  file: string
  current: number
  allowed: number
}

export interface TypecheckGateResult {
  ok: boolean
  /** Why the measurement itself was refused; an absent reason means the counts are trustworthy. */
  unusable?: "syntax-error" | "compiler-failure"
  violations: TypecheckViolation[]
  improved: TypecheckViolation[]
  currentTotal: number
  syntaxErrors: string[]
  exitStatus: number | null
}

const ERROR_LINE = /^(?<file>[^(]+)\((\d+),(\d+)\): error TS(?<code>\d+): (?<message>.*)$/
/** Parser diagnostics abort semantic checking for the whole program, collapsing every other count. */
const HALTING_MESSAGE = /(expected\.?|has no corresponding closing tag\.?)$/

export function parseTscOutput(output: string): { counts: Record<string, number>; syntaxErrors: string[]; total: number } {
  const counts: Record<string, number> = {}
  const syntaxErrors: string[] = []
  let total = 0
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "")
    // Continuation lines of a multi-line diagnostic stay indented; only column 0 is a new error.
    const match = ERROR_LINE.exec(line)
    if (!match) continue
    const { file, message } = match.groups as { file: string; message: string }
    total += 1
    counts[file] = (counts[file] ?? 0) + 1
    if (HALTING_MESSAGE.test(message.trim())) syntaxErrors.push(line.trim())
  }
  return { counts, syntaxErrors, total }
}

export function compareWithBaseline(baseline: TypecheckBaseline, counts: Record<string, number>): {
  violations: TypecheckViolation[]
  improved: TypecheckViolation[]
  currentTotal: number
} {
  const violations: TypecheckViolation[] = []
  const improved: TypecheckViolation[] = []
  let currentTotal = 0
  for (const current of Object.values(counts)) currentTotal += current
  for (const file of new Set([...Object.keys(baseline.byFile), ...Object.keys(counts)])) {
    const current = counts[file] ?? 0
    const allowed = baseline.byFile[file] ?? 0
    if (current > allowed) violations.push({ file, current, allowed })
    else if (current < allowed) improved.push({ file, current, allowed })
  }
  return {
    violations: violations.sort((left, right) => left.file.localeCompare(right.file)),
    improved: improved.sort((left, right) => right.current - left.current || left.file.localeCompare(right.file)),
    currentTotal,
  }
}

export function evaluateTypecheckGate(input: {
  baseline: TypecheckBaseline
  output: string
  exitStatus: number | null
}): TypecheckGateResult {
  const { baseline, output, exitStatus } = input
  const { counts, syntaxErrors } = parseTscOutput(output)
  const compared = compareWithBaseline(baseline, counts)

  if (syntaxErrors.length) {
    return { ok: false, unusable: "syntax-error", ...compared, syntaxErrors, exitStatus }
  }
  if (exitStatus === null || exitStatus >= 2) {
    return { ok: false, unusable: "compiler-failure", ...compared, syntaxErrors, exitStatus }
  }
  if (baseline.project !== GATE_PROJECT) {
    return { ok: false, unusable: "compiler-failure", ...compared, syntaxErrors, exitStatus }
  }
  return { ok: compared.violations.length === 0, ...compared, syntaxErrors, exitStatus }
}

export function buildBaseline(counts: Record<string, number>): TypecheckBaseline {
  const byFile: Record<string, number> = {}
  let total = 0
  for (const file of Object.keys(counts).sort()) {
    byFile[file] = counts[file]!
    total += counts[file]!
  }
  return { project: GATE_PROJECT, total, byFile }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export async function runTypecheckGateCli(argv: string[]): Promise<number> {
  const updateBaseline = argv.includes("--update-baseline")
  // Spawned through the current runtime so the gate works under both node and bun, without needing npx.
  const run = spawnSync(process.execPath, [resolve(repoRoot, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", GATE_PROJECT], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (run.error) {
    console.error(`audit:typecheck-baseline — tsc could not start: ${run.error.message}`)
    return 1
  }
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`
  const baselinePath = resolve(repoRoot, GATE_BASELINE_PATH)

  if (updateBaseline) {
    const { counts, syntaxErrors, total } = parseTscOutput(output)
    if (syntaxErrors.length || (run.status ?? 0) >= 2) {
      console.error(`audit:typecheck-baseline — refusing to write a baseline from an unusable run (syntax errors: ${syntaxErrors.length}, tsc status: ${run.status}).`)
      return 1
    }
    const baseline = buildBaseline(counts)
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`audit:typecheck-baseline — baseline updated: ${total} errors across ${Object.keys(baseline.byFile).length} files.`)
    return 0
  }

  let baseline: TypecheckBaseline
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8")) as TypecheckBaseline
  } catch (error) {
    console.error(`audit:typecheck-baseline — ${GATE_BASELINE_PATH} could not be read: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  const result = evaluateTypecheckGate({ baseline, output, exitStatus: run.status })
  if (result.unusable === "syntax-error") {
    console.error(`audit:typecheck-baseline — run is unreliable: tsc stopped on a syntax error, so every other count is meaningless.`)
    for (const line of result.syntaxErrors.slice(0, 10)) console.error(`  ${line}`)
    console.error(`Fix the syntax error, then run again. Nothing is compared in this mode.`)
    return 1
  }
  if (result.unusable === "compiler-failure") {
    console.error(`audit:typecheck-baseline — tsc did not complete the project (status ${result.exitStatus}, baseline project "${baseline.project}").`)
    console.error(output.trim().split("\n").slice(0, 10).map((line) => `  ${line}`).join("\n"))
    return 1
  }
  if (result.ok) {
    const remaining = result.currentTotal
    const message = `audit:typecheck-baseline — at or below baseline (${remaining}/${baseline.total}).`
    if (result.improved.length) {
      console.log(`${message}\n${result.improved.length} file(s) improved; lower the baseline with --update-baseline so the gain is kept:\n${result.improved.slice(0, 8).map((entry) => `  ${entry.file} ${entry.allowed} -> ${entry.current}`).join("\n")}`)
    } else {
      console.log(message)
    }
    return 0
  }
  console.error(`audit:typecheck-baseline — new type errors in ${result.violations.length} file(s), ${result.currentTotal} total vs baseline ${baseline.total}:`)
  for (const violation of result.violations) {
    console.error(`  ${violation.file}: ${violation.allowed} -> ${violation.current} (+${violation.current - violation.allowed})`)
  }
  console.error(`Clear them, or lower what you legitimately fixed with --update-baseline.`)
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runTypecheckGateCli(process.argv.slice(2))
}
