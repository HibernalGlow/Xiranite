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


/**
 * Runner-coverage check, computed rather than patterned: a test file that every runner excludes is invisible, and
 * this repo measured 24 such suites (11 node packages whose `Tui.bun.test.tsx` was `--exclude`d with no `bun test`
 * half, plus 13 `scripts/` suites outside the root config's `src/**` include). The class can come back, so the check
 * is part of this gate: a test file is *unrouted* when some manifest that could run it names it only inside an
 * `--exclude`, and no script mentions it anywhere else. It is reported under its own heading and kept out of the
 * Bun total, because the gap is routing rather than Bun-specific code and this gate would otherwise go red for a
 * condition the conversion cannot fix.
 *
 * Deliberate limits, both measured rather than assumed: coverage through a directory argument (`vitest run src`) is
 * taken as given, because modelling every runner's include globs would need the configs too; and `exclude` entries
 * written in a `vitest.config.ts` are not read — this checks the script text, which is where the 24 dead suites hid.
 * The check was verified against an injected violation (add `--exclude src/cli.test.ts` to a package whose only test
 * script is `vitest run src` and it goes 0 → 1 with the path printed), which is how the first version of this
 * function was caught reporting zero for a suite it was built to find.
 */
function findUnroutedTestFiles(files: string[]): Hit[] {
  type Script = { named: string; excluded: string[] }
  /**
   * `--exclude src/X.test.ts` has to be cut out before asking "does this script run the file", otherwise the very
   * clause that kills the suite counts as a mention of it. This exact bug made the first version of this check
   * report zero against an injected unrouted suite. Both spellings (`--exclude X`, `--exclude=X`) and quotes occur.
   */
  const toScript = (command: string): Script => {
    const excluded: string[] = []
    const named = command.replace(/--exclude(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g, (_all, quoted, single, bare) => {
      excluded.push(String(quoted ?? single ?? bare ?? ""))
      return " "
    })
    return { named, excluded }
  }

  const scriptsByDir = new Map<string, Script[]>()
  for (const manifest of files.filter((file) => file.endsWith("package.json"))) {
    let parsed: { scripts?: Record<string, string> }
    try {
      parsed = JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> }
    } catch {
      continue
    }
    const commands = Object.values(parsed.scripts ?? {}).filter((value): value is string => typeof value === "string")
    scriptsByDir.set(manifest.slice(0, manifest.lastIndexOf("/")), commands.map(toScript))
  }
  const rootScripts = scriptsByDir.get("") ?? []

  /** The nearest package manifest that owns this file, i.e. the longest directory key that prefixes it. */
  const ownerOf = (file: string): string => {
    let owner = ""
    for (const dir of scriptsByDir.keys()) {
      if (dir.length > 0 && file.startsWith(`${dir}/`) && dir.length > owner.length) owner = dir
    }
    return owner
  }

  const hits: Hit[] = []
  for (const file of files) {
    if (!/\.test\.[cm]?[jt]sx?$/.test(file) || /\.browser\.test\./.test(file)) continue
    // The root vite config covers `src/**/*.test.*` wholesale, and the scripts project covers `scripts/**`.
    if (file.startsWith("src/")) continue
    if (file.startsWith("scripts/") && !file.endsWith(".bun.test.ts") && !file.endsWith(".bun.test.tsx")) continue
    const packageDir = ownerOf(file)
    const basename = file.slice(file.lastIndexOf("/") + 1)
    const relativeToPackage = packageDir.length > 0 ? file.slice(packageDir.length + 1) : file
    const candidates = packageDir.length > 0 ? [...rootScripts, ...(scriptsByDir.get(packageDir) ?? [])] : rootScripts
    if (candidates.some((script) => script.named.includes(relativeToPackage) || script.named.includes(basename))) continue
    const excluded = candidates.some((script) => script.excluded.includes(relativeToPackage) || script.excluded.includes(basename))
    if (excluded) hits.push({ path: file, line: 0, text: `excluded by every script in ${packageDir || "the repo root"}` })
  }
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

  const unrouted = findUnroutedTestFiles(files)

  if (asJson) {
    const summary = reports.map((report) => ({ id: report.category, description: report.description, count: report.hits.length, exempt: report.exempt, files: [...new Set(report.hits.map((hit) => hit.path))].length }))
    console.log(JSON.stringify({
      total,
      exempted: exemptTotal,
      categories: summary,
      unroutedTestFiles: {
        count: unrouted.length,
        files: unrouted.map((hit) => hit.path),
        note: "separate contract from the Bun surface above: excluded by every manifest script that could run them, so nothing executes them",
      },
    }, null, 2))
  } else {
    for (const report of reports) {
      const files = [...new Set(report.hits.map((hit) => hit.path))]
      console.log(`${report.category}: ${report.hits.length} hit(s) in ${files.length} file(s) — ${report.description} [exempt: ${report.exempt}]`)
      const shown = showAll ? report.hits : report.hits.slice(0, 8)
      for (const hit of shown) console.log(`    ${hit.path}${hit.line > 0 ? `:${hit.line}` : ""}  ${hit.text}`)
      if (!showAll && report.hits.length > shown.length) console.log(`    … ${report.hits.length - shown.length} more (pass --all)`)
    }
    console.log(`\nBun-only code surface: ${total} hit(s) remaining, ${exemptTotal} exempted (ADR-0075 gate).`)
    // Reported, not counted: these suites are a routing gap that predates the Bun retirement, and folding them into
    // `total` would make this gate red for a condition no Bun-API conversion can fix.
    console.log(`Runner coverage: ${unrouted.length} test file(s) excluded by every script that could run them (not counted above).`)
    for (const hit of unrouted.slice(0, showAll ? unrouted.length : 8)) console.log(`    ${hit.path}  ${hit.text}`)
    if (!showAll && unrouted.length > 8) console.log(`    … ${unrouted.length - 8} more (pass --all)`)
  }

  if (total > 0) process.exitCode = 1
}

main()
