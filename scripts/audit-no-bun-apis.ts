/**
 * Gate for ADR-0075: the runner may stay Bun, but the *code* may not use Bun-only APIs.
 *
 * Deliberately written with plain Node globals (`node:child_process`, `node:fs`) so it runs under `node`, `bun`, or
 * any other runtime — a policing tool that itself needs the thing it polices is not a gate. Reports per category and
 * exits non-zero on any non-exempt hit.
 *
 * Usage: `node scripts/audit-no-bun-apis.ts [--json] [--all]`
 *   --json  machine-readable summary
 *   --all   print every offending path instead of a capped list per category
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

type Category = {
  id: string
  description: string
  /** Applied to file contents of the listed extensions. */
  pattern?: RegExp
  /** Applied to the path itself. */
  pathPattern?: RegExp
  extensions?: string[]
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".svelte", ".vue"]

const CATEGORIES: Category[] = [
  {
    id: "bun-global-api",
    description: "Bun.* global API call sites (ADR-0075 replacement table)",
    pattern: /\bBun\.[A-Za-z_$][\w$]*/g,
    extensions: SOURCE_EXTENSIONS,
  },
  {
    id: "bun-test-import",
    description: 'import/require of "bun:test" — migrate to Vitest',
    pattern: /(?:from\s*|require\()\s*["']bun:test["']/g,
    extensions: SOURCE_EXTENSIONS,
  },
  {
    // Tightened after a false positive: `packages/tauri-migrate/src/node-feasibility.ts:156` lists "bun:ffi" inside
    // NO_HOST_FREE_ANSWER_LIBS, a vocabulary of FFI libraries (next to koffi/ffi-napi/ref-napi). That is data about
    // a runtime, not a call into it. Matching import positions only still catches both real `await import("bun:ffi")`
    // sites — packages/findz-native/src/index.ts:106 and packages/native-loader/scripts/build-native-assets.ts:161.
    id: "bun-specifier",
    description: 'other "bun:*" modules reached through an import or dynamic import (ffi/sqlite/crypto/hash/…)',
    pattern: /(?:from|import\s*\()\s*["']bun:(?!test)[a-z-]+["']/g,
    extensions: SOURCE_EXTENSIONS,
  },
  {
    id: "bun-meta-api",
    description: "Bun's `Meta.*` module-path API",
    pattern: /\bMeta\.[a-z]/g,
    extensions: SOURCE_EXTENSIONS,
  },
  {
    // Measured on this machine: under `node` these answer **undefined**, under `bun` they are strings.
    // `import.meta.main`/`.dirname`/`.filename` are boolean/string in both, so they are not flagged.
    id: "bun-import-meta-path",
    description: "import.meta.dir / import.meta.path — Bun-only (Node answers undefined); use .dirname / .filename",
    pattern: /\bimport\.meta\.(dir|path)\b/g,
    extensions: SOURCE_EXTENSIONS,
  },
  {
    // Found live while migrating `scripts/lucide-deep-imports.test.ts`: Bun adds an `exists` export to
    // `node:fs/promises` that Node does not have, so the named import is `undefined` there and the file cannot
    // even be loaded by plain `node`. Not a `Bun.*` token, which is why the global-API category missed it.
    id: "bun-node-export",
    description: "named imports of Bun-only additions to `node:*` modules (exists from node:fs/promises)",
    pattern: /import\s*\{[^}]*\bexists\b[^}]*\}\s*from\s*["']node:fs\/promises["']/g,
    extensions: SOURCE_EXTENSIONS,
  },
  {
    // Found twice the hard way: `toBeTrue`/`toBeFalse` (enginev) and `toBeString` (backend-gateway.integration) blew
    // up as `Invalid Chai property` only once the file was running under Vitest. These matchers are bun:test's, Vitest
    // 4.1.10 has none of them, and they take arguments (`toStartWith("x")`), which is why a survey demanding `\(\)`
    // misses them. Translating is equal strength: `.toBe(true)`, `typeof x === "string"`, `x.startsWith(p)`.
    id: "bun-test-matcher",
    description: "bun:test-only matchers that Vitest rejects (toBeTrue/toBeString/toStartWith/…)",
    pattern: /\.(toBeTrue|toBeFalse|toBeString|toBeNumber|toBeNaN|toBeFinite|toBeArray|toBeObject|toBeFunction|toBeEmptyObject|toStartWith|toEndWith|toEqualObject)\(/g,
    extensions: SOURCE_EXTENSIONS,
  },
  {
    id: "bun-test-filename",
    description: "*.bun.test.* file names — rename to *.node.test.*",
    pathPattern: /\.bun\.test\.[cm]?[jt]sx?$/,
  },
  {
    id: "bun-types-dependency",
    description: "@types/bun or bun-types declared in a manifest",
    pattern: /"@types\/bun"|"bun-types"/g,
    extensions: [".json"],
  },
]

/**
 * Every exemption carries its reason, because an unexplained allowlist is the failure mode ADR-0073 already
 * documented for this repo's gates.
 */
const EXEMPT_PATHS: Array<{ match: (path: string) => boolean; reason: string }> = [
  {
    match: (path) => path.startsWith("docs/adr/0075-"),
    reason: "the decision record itself names the APIs it retires",
  },
  {
    match: (path) => path === "scripts/audit-no-bun-apis.ts",
    reason: "the gate's own pattern table contains the strings it searches for",
  },
  {
    match: (path) => path.startsWith("packages/backend/"),
    reason: "the old Bun backend is scheduled for deletion as a layer; porting its serve call would keep the layer alive",
  },
]

/** Third-party trees checked into the repo are not this project's code surface. */
const SKIP_PREFIXES = ["vendor/", "ref/", "node_modules/"]

type Hit = { path: string; line: number; text: string }
type Report = { category: string; description: string; exempt: string; hits: Hit[] }

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  return String(out).split("\0").filter((entry) => entry.length > 0)
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".")
  return dot < 0 ? "" : path.slice(dot)
}

function collectHits(path: string, category: Category): Hit[] {
  if (category.pathPattern !== undefined) {
    return category.pathPattern.test(path) ? [{ path, line: 0, text: path }] : []
  }
  if (category.pattern === undefined) return []
  if (category.extensions !== undefined && !category.extensions.includes(extensionOf(path))) return []
  let source: string
  try {
    source = readFileSync(path, "utf8")
  } catch {
    return []
  }
  const hits: Hit[] = []
  // Line-based, so a doc comment that *names* the API it replaces (this file and the subprocess helper both do)
  // is not counted as a call site. Comment shapes skipped: `//`, `*` (jsdoc), `/* …`.
  source.split("\n").forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return
    const expression = new RegExp(category.pattern!.source, category.pattern!.flags.replace("g", ""))
    const match = expression.exec(line)
    if (match !== null) hits.push({ path, line: index + 1, text: match[0] ?? "" })
  })
  return hits
}

function main(): void {
  const asJson = process.argv.includes("--json")
  const showAll = process.argv.includes("--all")
  const files = trackedFiles()
  const reports: Report[] = []
  let total = 0
  let exemptTotal = 0

  for (const category of CATEGORIES) {
    const hits: Hit[] = []
    let exempt = 0
    for (const file of files) {
      if (SKIP_PREFIXES.some((prefix) => file.startsWith(prefix))) continue
      const found = collectHits(file, category)
      if (found.length === 0) continue
      if (EXEMPT_PATHS.some((entry) => entry.match(file))) {
        exempt += found.length
        continue
      }
      hits.push(...found)
    }
    total += hits.length
    exemptTotal += exempt
    reports.push({ category: category.id, description: category.description, exempt: `${exempt} (see EXEMPT_PATHS)`, hits: hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line) })
  }

  if (asJson) {
    const summary = reports.map((report) => ({ id: report.category, description: report.description, count: report.hits.length, exempt: report.exempt, files: [...new Set(report.hits.map((hit) => hit.path))].length }))
    console.log(JSON.stringify({ total, exempted: exemptTotal, categories: summary }, null, 2))
  } else {
    for (const report of reports) {
      const files = [...new Set(report.hits.map((hit) => hit.path))]
      console.log(`${report.category}: ${report.hits.length} hit(s) in ${files.length} file(s) — ${report.description} [exempt: ${report.exempt}]`)
      const shown = showAll ? report.hits : report.hits.slice(0, 8)
      for (const hit of shown) console.log(`    ${hit.path}${hit.line > 0 ? `:${hit.line}` : ""}  ${hit.text}`)
      if (!showAll && report.hits.length > shown.length) console.log(`    … ${report.hits.length - shown.length} more (pass --all)`)
    }
    console.log(`\nBun-only code surface: ${total} hit(s) remaining, ${exemptTotal} exempted (ADR-0075 gate).`)
  }

  if (total > 0) process.exitCode = 1
}

main()
