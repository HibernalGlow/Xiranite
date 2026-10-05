/**
 * Generates `src/lib/design-theme/md3/tokens.generated.ts` from the token dictionary Google ships inside the
 * installed `@material/web` package.
 *
 * Why generated instead of transcribed: the advanced-theme recipe needs M3's numbers — shape corners, elevation
 * levels, duration curves, and the per-component vocabulary such as `filled-button.container-height` — and every
 * one of them is already machine-readable in `node_modules/@material/web/tokens/versions/<version>/_md-*.scss`.
 * Those files carry an `!!! THIS FILE WAS AUTOMATICALLY GENERATED !!!` header from Material Theme Builder, so the
 * SCSS *is* upstream's own export of its design system. Typing those values from a documentation page is how a
 * token goes stale or wrong without anything noticing. Reading the SCSS with a real tokenizer and writing the
 * answer down is the same discipline `scripts/audit-tui-theme-table.ts` applies to the terminal palette.
 *
 * Two properties of the source are preserved on purpose:
 * - Cross-group references stay symbolic (`"ref:md-sys-color:primary"`). `md-sys-color` is computed from the
 *   user's seed colour at runtime, so flattening a reference into whatever hex this seed happens to produce would
 *   freeze a dynamic value into a static one.
 * - `md-ref-palette` keeps its hex literals, because those are fixed upstream constants rather than a derived
 *   scheme, and `md-sys-color` is exactly the layer that references them.
 *
 * A value that cannot be classified throws with the file and the token name: silent skipping would recreate the
 * failure mode this generator exists to avoid.
 *
 * `bun run gen:md3-tokens` writes the file; `bun run audit:md3-tokens` fails when the checked-in file no longer
 * matches the installed package.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dirname, "..")
const PACKAGE_RELATIVE_PATH = "node_modules/@material/web"
const TOKENS_RELATIVE_ROOT = `${PACKAGE_RELATIVE_PATH}/tokens/versions`
const OUTPUT_RELATIVE_PATH = "src/lib/design-theme/md3/tokens.generated.ts"
const OUTPUT_PATH = join(REPO_ROOT, OUTPUT_RELATIVE_PATH)

/** The 8 system/reference modules and the component sets, by file name. */
const SYS_FILE_PATTERN = /^_md-(?:sys|ref)-[a-z0-9-]+\.scss$/
const COMPONENT_FILE_PATTERN = /^_md-comp-[a-z0-9-]+\.scss$/
/**
 * `*-meta.scss` is skipped: those files are `$_default--resolved` JSON-ish fixtures for @material/web's own tests,
 * they repeat the same token names inside a different structure, and reading them would double-count the grammar.
 */
const META_FILE_SUFFIX = "-meta.scss"

/** `bun run check:source-size` caps maintained sources at 1000 lines; generated data is packed to stay inside it. */
const MAX_FILE_LINES = 1_000
/**
 * The payload is ~3.5k entries / ~200k characters, so a one-entry-per-line table would be a ~3.7k line file —
 * over the repo's source cap even for a generated artifact. 400 columns keeps the checked-in file inside the same
 * gauge every other source file is held to, at the cost of a table you read through `MD3_*` rather than by eye.
 */
const MAX_LINE_COLUMNS = 400

export interface Md3TokenSourceInfo {
  package: string
  version: string
  designSystem: string
  designVersion: string
  license: string
  sysGroups: number
  componentSets: number
  sysTokenCount: number
  componentTokenCount: number
}

export interface ParsedTokenEntry {
  key: string
  value: string
  /** True for a composite font shorthand (the `weight size / line-height family` form). */
  composite: boolean
}

export interface ParsedTokenSection {
  /** Group name, plus a `.light` / `.dark` suffix for `md-sys-color`. */
  section: string
  entries: ParsedTokenEntry[]
  sourceFile: string
}

export interface Md3GeneratedData {
  source: Md3TokenSourceInfo
  /** Repo-relative directory the maps were read from, recorded in the generated header. */
  sourceDir: string
  sys: Record<string, Record<string, string>>
  component: Record<string, Record<string, string>>
  componentSetNames: string[]
}

interface ScssProvenance {
  designSystem: string
  designVersion: string
  license: string
}

// ---------------------------------------------------------------------------------------------
// Scanner primitives: paren-depth, quote-aware. Nothing here is line-oriented, because half of
// the source entries wrap across lines and several values carry commas inside `if(...)` calls.
// ---------------------------------------------------------------------------------------------

const OPENERS = new Set(["(", "[", "{"])
const CLOSER_FOR: Record<string, string> = { "(": ")", "[": "]", "{": "}" }

/** Returns the index of the closing quote that the opening quote at `index` belongs to. */
function skipQuoted(text: string, index: number, label: string): number {
  const quote = text[index] as string
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    const char = text[cursor] as string
    if (char === "\\") { cursor += 1; continue }
    if (char === quote) return cursor
  }
  throw new Error(`${label}: unterminated ${quote} string starting at offset ${index}`)
}

/** Given the index of an opening bracket, returns the index of its matching closer. */
export function findClosingBracket(text: string, start: number, label: string): number {
  const openChar = text[start] as string
  if (!OPENERS.has(openChar)) throw new Error(`${label}: expected a bracket at offset ${start}, found ${JSON.stringify(openChar)}`)
  const stack: string[] = []
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const char = text[cursor] as string
    if (char === "'" || char === '"') { cursor = skipQuoted(text, cursor, label); continue }
    if (OPENERS.has(char)) { stack.push(CLOSER_FOR[char] as string); continue }
    if (char === ")" || char === "]" || char === "}") {
      const expected = stack.pop()
      if (expected === undefined) throw new Error(`${label}: stray ${char} at offset ${cursor}`)
      if (expected !== char) throw new Error(`${label}: ${char} at offset ${cursor} closes a ${expected} group`)
      if (stack.length === 0) return cursor
    }
  }
  throw new Error(`${label}: unbalanced brackets from offset ${start}`)
}

/** Splits on `separator` at bracket depth 0, honouring single- and double-quoted strings. */
function splitAtDepthZero(text: string, separator: string, label: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const char = text[cursor] as string
    if (char === "'" || char === '"') { cursor = skipQuoted(text, cursor, label); continue }
    if (OPENERS.has(char)) { depth += 1; continue }
    if (char === ")" || char === "]" || char === "}") { depth -= 1; continue }
    if (char === separator && depth === 0) {
      parts.push(text.slice(from, cursor))
      from = cursor + 1
    }
  }
  if (depth !== 0) throw new Error(`${label}: ${depth} bracket level(s) left open`)
  parts.push(text.slice(from))
  return parts
}

/** Whitespace split at depth 0: this is how a composite value such as `map.get(...) 1rem #{'/'} …` is read. */
function splitAtoms(text: string, label: string): string[] {
  const atoms: string[] = []
  let depth = 0
  let current = ""
  const flush = (): void => {
    const atom = current.trim()
    if (atom.length > 0) atoms.push(atom)
    current = ""
  }
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const char = text[cursor] as string
    if (char === "'" || char === '"') {
      const end = skipQuoted(text, cursor, label)
      current += text.slice(cursor, end + 1)
      cursor = end
      continue
    }
    if (OPENERS.has(char)) { depth += 1; current += char; continue }
    if (char === ")" || char === "]" || char === "}") { depth -= 1; current += char; continue }
    if (/\s/.test(char) && depth === 0) { flush(); continue }
    current += char
  }
  flush()
  if (depth !== 0) throw new Error(`${label}: ${depth} bracket level(s) left open`)
  return atoms
}

/** `//` and `/* *\/` comments, quote-aware. The composite tokens carry an inline `/** Warning: … *\/` note. */
export function stripScssComments(text: string, label: string): string {
  let out = ""
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const char = text[cursor] as string
    if (char === "'" || char === '"') {
      const end = skipQuoted(text, cursor, label)
      out += text.slice(cursor, end + 1)
      cursor = end
      continue
    }
    const next = text[cursor + 1]
    if (char === "/" && next === "/") {
      while (cursor < text.length && text[cursor] !== "\n") cursor += 1
      out += "\n"
      continue
    }
    if (char === "/" && next === "*") {
      const end = text.indexOf("*/", cursor + 2)
      if (end < 0) throw new Error(`${label}: unterminated block comment at offset ${cursor}`)
      // A dropped block comment leaves no space: `map.get(...) /** w */ 1rem` must still split into two atoms.
      out += " "
      cursor = end + 1
      continue
    }
    out += char
  }
  return out
}

function unquote(text: string, label: string): string {
  const trimmed = text.trim()
  const quote = trimmed[0]
  if ((quote !== "'" && quote !== '"') || trimmed.at(-1) !== quote) {
    throw new Error(`${label}: expected a quoted string, found ${JSON.stringify(trimmed)}`)
  }
  return trimmed.slice(1, -1)
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

// ---------------------------------------------------------------------------------------------
// Value classification
// ---------------------------------------------------------------------------------------------

/** The `name(...)` part of a whole-call value: returns the argument list, or null when it is not exactly a call. */
function wholeCallArgs(text: string, prefix: string, label: string): string[] | null {
  if (!text.startsWith(prefix) || !text.endsWith(")")) return null
  const open = prefix.length - 1
  if (findClosingBracket(text, open, label) !== text.length - 1) return null
  const inner = text.slice(open + 1, text.length - 1)
  if (inner.trim().length === 0) return []
  return splitAtDepthZero(inner, ",", label).map((arg) => collapseWhitespace(arg))
}

/** `0px` inside a space-separated list is redundant; a lone `0px` stays as written (`md-sys-shape.corner-none`). */
function compressZeroAtom(value: string): string {
  return /^0(px|rem|em|ms|s)$/.test(value) ? "0" : value
}

/**
 * One token value -> the string written into the generated file.
 * `label` names the source file, `key` names the token, and both go into every error message.
 */
export function parseScssValue(raw: string, label: string, key: string): ParsedTokenEntry {
  const text = collapseWhitespace(raw)
  const where = `${label}: token '${key}'`

  if (text.length === 0) throw new Error(`${where}: empty value`)

  // map.get($deps, 'md-sys-color', 'primary') -> ref:md-sys-color:primary (never flattened).
  const refArgs = wholeCallArgs(text, "map.get(", where)
  if (refArgs !== null) {
    if (refArgs.length !== 3) throw new Error(`${where}: map.get needs ($deps, group, token), got ${JSON.stringify(text)}`)
    if (refArgs[0] !== "$deps") throw new Error(`${where}: map.get must read from $deps, got ${JSON.stringify(refArgs[0])}`)
    const group = unquote(refArgs[1] as string, where)
    const token = unquote(refArgs[2] as string, where)
    if (group.length === 0 || token.length === 0) throw new Error(`${where}: empty ref target ${JSON.stringify(text)}`)
    return { key, value: `ref:${group}:${token}`, composite: false }
  }

  // if($exclude-hardcoded-values, null, <value>) is the guard around every hardcoded literal.
  const ifArgs = wholeCallArgs(text, "if(", where)
  if (ifArgs !== null) {
    if (ifArgs.length !== 3) throw new Error(`${where}: if() needs 3 arguments, got ${JSON.stringify(text)}`)
    if (ifArgs[0] !== "$exclude-hardcoded-values") throw new Error(`${where}: unexpected if() condition ${JSON.stringify(ifArgs[0])}`)
    if (ifArgs[1] !== "null") throw new Error(`${where}: unexpected if() fallback ${JSON.stringify(ifArgs[1])}`)
    return parseScssValue(ifArgs[2] as string, label, key)
  }

  // Easing curves pass through unchanged, only re-spaced to one canonical form.
  const bezierArgs = wholeCallArgs(text, "cubic-bezier(", where)
  if (bezierArgs !== null) {
    if (bezierArgs.length !== 4 || bezierArgs.some((arg) => !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(arg))) {
      throw new Error(`${where}: cubic-bezier needs four numbers, got ${JSON.stringify(text)}`)
    }
    return { key, value: `cubic-bezier(${bezierArgs.join(", ")})`, composite: false }
  }

  // Sass interpolation only ever appears in the composite font shorthand, as exactly #{'/'} .
  if (text.includes("#{")) {
    const parts = splitAtoms(text, where).map((atom) => {
      if (atom.startsWith("#{")) {
        if (!/^#\{'\/'\}$/.test(atom)) throw new Error(`${where}: unsupported interpolation ${JSON.stringify(atom)}`)
        return "/"
      }
      return parseScssValue(atom, label, key).value
    })
    if (!parts.includes("/")) throw new Error(`${where}: composite value has no #{\u0027/\u0027} separator: ${JSON.stringify(text)}`)
    if (parts.length < 3) throw new Error(`${where}: composite value has too few parts: ${JSON.stringify(text)}`)
    return { key, value: parts.join(" "), composite: true }
  }

  // A parenthesised, comma-free group is a Sass *space-separated list*: (28px 28px 0px 0px), (Roboto).
  if (text.startsWith("(") && findClosingBracket(text, 0, where) === text.length - 1) {
    const inner = text.slice(1, text.length - 1)
    if (inner.includes(",")) throw new Error(`${where}: comma-separated Sass lists are not a token form: ${JSON.stringify(text)}`)
    const atoms = splitAtoms(inner, where)
    if (atoms.length === 0) throw new Error(`${where}: empty list value ${JSON.stringify(text)}`)
    const parts = atoms.map((atom) => compressZeroAtom(parseScssValue(atom, label, key).value))
    return { key, value: parts.join(" "), composite: false }
  }

  return { key, value: normalizeLiteral(text, where), composite: false }
}

const HEX_PATTERN = /^#[\da-f]{3,8}$/i
const NUMBER_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ms|s|fr|%)?$/
const IDENTIFIER_PATTERN = /^[a-z][\da-z-]*$/i

function normalizeLiteral(text: string, where: string): string {
  // The design system emits `md-sys-motion.path` as an explicit null (type motion_path is unsupported upstream).
  if (text === "null") return "null"
  if (HEX_PATTERN.test(text)) return text.toLowerCase()
  if (NUMBER_PATTERN.test(text)) return text
  if (IDENTIFIER_PATTERN.test(text)) return text
  throw new Error(`${where}: value ${JSON.stringify(text)} is neither a literal, a list, an if() guard nor a map.get reference`)
}

// ---------------------------------------------------------------------------------------------
// File-level parsing
// ---------------------------------------------------------------------------------------------

const FUNCTION_PATTERN = /@function\s+([a-z0-9_-]+)\s*/gi

function sectionName(group: string, functionName: string, label: string): string {
  if (functionName === "values") return group
  if (functionName === "values-light") return `${group}.light`
  if (functionName === "values-dark") return `${group}.dark`
  throw new Error(`${label}: unsupported token function '${functionName}'`)
}

/**
 * Every `@function … { @return ( … ); }` map in one SCSS file. `$_default: (…)` maps are outside function bodies,
 * so they are never read here — they wire the deps, they are not tokens.
 */
export function parseScssTokenSections(text: string, group: string, label: string): ParsedTokenSection[] {
  const body = stripScssComments(text, label)
  const sections: ParsedTokenSection[] = []

  for (const match of body.matchAll(FUNCTION_PATTERN)) {
    const functionName = match[1] as string
    let cursor = (match.index as number) + match[0].length
    if (body[cursor] !== "(") throw new Error(`${label}: function '${functionName}' has no parameter list`)
    cursor = findClosingBracket(body, cursor, label) + 1
    const braceAt = body.slice(cursor).indexOf("{")
    if (braceAt < 0) throw new Error(`${label}: function '${functionName}' has no body`)
    const open = cursor + braceAt
    const close = findClosingBracket(body, open, label)
    const inner = body.slice(open + 1, close)

    const returnAt = inner.indexOf("@return")
    if (returnAt < 0) throw new Error(`${label}: function '${functionName}' returns nothing`)
    const afterReturn = inner.slice(returnAt + "@return".length)
    const mapOpen = afterReturn.indexOf("(")
    if (mapOpen < 0) throw new Error(`${label}: function '${functionName}' does not return a map`)
    const mapClose = findClosingBracket(afterReturn, mapOpen, label)
    const mapText = afterReturn.slice(mapOpen + 1, mapClose)

    const entries = parseMapEntries(mapText, label)
    sections.push({ section: sectionName(group, functionName, label), entries, sourceFile: label })
  }

  if (sections.length === 0) throw new Error(`${label}: no @function values() map found`)
  return sections
}

function parseMapEntries(mapText: string, label: string): ParsedTokenEntry[] {
  const entries: ParsedTokenEntry[] = []
  const seen = new Set<string>()

  for (const raw of splitAtDepthZero(mapText, ",", label)) {
    const pair = raw.trim()
    if (pair.length === 0) continue
    const key = keyAtDepthZero(pair, label)
    if (key === null) throw new Error(`${label}: entry ${JSON.stringify(collapseWhitespace(pair).slice(0, 120))} has no ':' separator`)
    const [name, valueText] = [pair.slice(0, key.endIndex).trim(), pair.slice(key.colonIndex + 1)]
    const token = unquote(name, `${label}: entry ${JSON.stringify(name)}`)
    if (token.length === 0) throw new Error(`${label}: empty token name`)
    if (seen.has(token)) throw new Error(`${label}: token '${token}' is declared twice`)
    seen.add(token)
    entries.push(parseScssValue(valueText as string, label, token))
  }

  if (entries.length === 0) throw new Error(`${label}: map has no entries`)
  return entries
}

/** Locates the first `:` at bracket depth 0; returns null when the pair has none. */
function keyAtDepthZero(pair: string, label: string): { colonIndex: number, endIndex: number } | null {
  let depth = 0
  for (let cursor = 0; cursor < pair.length; cursor += 1) {
    const char = pair[cursor] as string
    if (char === "'" || char === '"') { cursor = skipQuoted(pair, cursor, label); continue }
    if (OPENERS.has(char)) { depth += 1; continue }
    if (char === ")" || char === "]" || char === "}") { depth -= 1; continue }
    if (char === ":" && depth === 0) return { colonIndex: cursor, endIndex: cursor }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Source discovery + provenance
// ---------------------------------------------------------------------------------------------

function headerField(text: string, label: string, field: string): string {
  const pattern = new RegExp(`^//\\s*${field}:\\s*(.+)$`, "m")
  const found = pattern.exec(text)?.[1]?.trim()
  if (!found) throw new Error(`${label}: header carries no '${field}' line, so it is not a Material Theme Builder export`)
  return found
}

function readProvenance(text: string, label: string): ScssProvenance {
  return {
    designSystem: headerField(text, label, "Design system display name"),
    designVersion: headerField(text, label, "Design system version"),
    license: headerField(text, label, "SPDX-License-Identifier"),
  }
}

/** The versioned directory that actually holds the `_md-*.scss` token maps (`latest/` has a different layout). */
async function locateTokenDirectory(): Promise<{ dir: string, name: string, files: string[] }> {
  const root = join(REPO_ROOT, TOKENS_RELATIVE_ROOT)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => null)
  if (entries === null) throw new Error(`${TOKENS_RELATIVE_ROOT} is missing: is ${PACKAGE_RELATIVE_PATH} installed?`)

  const candidates: Array<{ dir: string, name: string, files: string[] }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    const names: string[] = await readdir(dir).catch((): string[] => [])
    if (names.includes("_md-sys-color.scss")) candidates.push({ dir, name: entry.name, files: names })
  }
  if (candidates.length === 0) throw new Error(`no directory under ${TOKENS_RELATIVE_ROOT} contains _md-sys-color.scss`)

  candidates.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  return candidates[candidates.length - 1] as { dir: string, name: string, files: string[] }
}

async function readPackageVersion(): Promise<{ name: string, version: string }> {
  const manifest = await readFile(join(REPO_ROOT, PACKAGE_RELATIVE_PATH, "package.json"), "utf8").catch(() => null)
  if (manifest === null) throw new Error(`${PACKAGE_RELATIVE_PATH}/package.json is missing`)
  const parsed = JSON.parse(manifest) as { name?: string, version?: string }
  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error(`${PACKAGE_RELATIVE_PATH}/package.json has no name/version`)
  }
  return { name: parsed.name, version: parsed.version }
}

/**
 * Codepoint order, never locale collation: `localeCompare` sorts `md-sys-color.light` differently depending on the
 * machine's ICU data, and a generated file must be byte-identical on Windows and macOS.
 */
const compareKeys = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

function sortEntries(map: Record<string, string>): Array<[string, string]> {
  return Object.entries(map).sort(([left], [right]) => compareKeys(left, right))
}

function sortedCopy(source: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of sortEntries(source)) out[key] = value
  return out
}

/**
 * Reads every installed token module and returns the data behind the generated file.
 * Sections sharing a name are only allowed to differ by scheme, and a token declared twice inside one section is
 * a parse error rather than a last-write-wins.
 */
export async function collectMd3Tokens(): Promise<Md3GeneratedData> {
  const { dir, name: versionDirName, files } = await locateTokenDirectory()
  const tokenModuleFiles = files.filter((name) => name.startsWith("_md-") && name.endsWith(".scss"))
  const metaFiles = tokenModuleFiles.filter((name) => name.endsWith(META_FILE_SUFFIX))
  const tokenFiles = tokenModuleFiles.filter((name) => !name.endsWith(META_FILE_SUFFIX))
  const sysFiles = tokenFiles.filter((name) => SYS_FILE_PATTERN.test(name)).sort()
  const componentFiles = tokenFiles.filter((name) => COMPONENT_FILE_PATTERN.test(name)).sort()
  if (sysFiles.length === 0 || componentFiles.length === 0) {
    throw new Error(`${dir}: found ${sysFiles.length} system modules and ${componentFiles.length} component sets, expected both`)
  }
  // Every token module ships a meta twin; a mismatch means the grammar of the package changed under us.
  if (metaFiles.length !== tokenFiles.length) {
    throw new Error(`${dir}: ${tokenFiles.length} token files vs ${metaFiles.length} ${META_FILE_SUFFIX} files do not pair up — re-check what this directory holds`)
  }
  const unclassified = tokenFiles.filter((name) => !SYS_FILE_PATTERN.test(name) && !COMPONENT_FILE_PATTERN.test(name))
  if (unclassified.length > 0) {
    throw new Error(`${dir}: file(s) matched neither pattern and would be silently dropped: ${unclassified.join(", ")}`)
  }

  const sys = new Map<string, Record<string, string>>()
  const component = new Map<string, Record<string, string>>()
  let provenance: ScssProvenance | null = null

  for (const fileName of [...sysFiles, ...componentFiles]) {
    const label = `${TOKENS_RELATIVE_ROOT}/${versionDirName}/${fileName}`
    const text = await readFile(join(dir, fileName), "utf8")
    const fileProvenance = readProvenance(text, label)
    if (provenance === null) provenance = fileProvenance
    else if (fileProvenance.designVersion !== provenance.designVersion || fileProvenance.designSystem !== provenance.designSystem) {
      throw new Error(`${label}: design system '${fileProvenance.designSystem}' ${fileProvenance.designVersion} disagrees with '${provenance.designSystem}' ${provenance.designVersion}`)
    }

    const isSys = SYS_FILE_PATTERN.test(fileName)
    const group = isSys ? fileName.replace(/^_/, "").replace(/\.scss$/, "") : fileName.replace(/^_md-comp-/, "").replace(/\.scss$/, "")
    for (const section of parseScssTokenSections(text, group, label)) {
      const target = isSys ? sys : component
      const bucket = target.get(section.section) ?? {}
      for (const entry of section.entries) {
        // A composite shorthand and its discrete siblings must never collide on a key.
        const key = entry.composite ? `${entry.key}-composite` : entry.key
        if (key in bucket) throw new Error(`${label}: token '${key}' is emitted twice in section '${section.section}'`)
        bucket[key] = entry.value
      }
      target.set(section.section, bucket)
    }
  }

  const sysSections: Record<string, Record<string, string>> = {}
  for (const [section, tokens] of [...sys.entries()].sort(([left], [right]) => compareKeys(left, right))) {
    sysSections[section] = sortedCopy(tokens)
  }
  const componentSets: Record<string, Record<string, string>> = {}
  for (const [setName, tokens] of [...component.entries()].sort(([left], [right]) => compareKeys(left, right))) {
    componentSets[setName] = sortedCopy(tokens)
  }

  const { name, version } = await readPackageVersion()
  if (provenance === null) throw new Error("no token file was read")
  const sysTokenCount = Object.values(sysSections).reduce((sum, tokens) => sum + Object.keys(tokens).length, 0)
  const componentTokenCount = Object.values(componentSets).reduce((sum, tokens) => sum + Object.keys(tokens).length, 0)

  return {
    source: {
      package: name,
      version,
      designSystem: provenance.designSystem,
      designVersion: provenance.designVersion,
      license: provenance.license,
      // 8 modules for the 9 sections, because md-sys-color.scss emits values-light() + values-dark().
      sysGroups: sysFiles.length,
      componentSets: componentFiles.length,
      sysTokenCount,
      componentTokenCount,
    },
    sourceDir: `${TOKENS_RELATIVE_ROOT}/${versionDirName}`,
    sys: sysSections,
    component: componentSets,
    componentSetNames: Object.keys(componentSets).sort(),
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

const quote = (value: string): string => JSON.stringify(value)

/**
 * Sorted entries, greedily packed to `MAX_LINE_COLUMNS`.
 * A table this wide earns its packing from the repo's 1000-line source cap: one entry per line would be a ~3.7k
 * line file, and a generator whose output cannot be checked in is worth nothing. Keys stay sorted, so the byte
 * stream is reproducible and `--check` can diff it.
 */
function packPieces(pieces: string[], indent: string): string[] {
  const lines: string[] = []
  let batch: string[] = []
  let width = indent.length

  for (const piece of pieces) {
    const needed = (batch.length > 0 ? 1 : 0) + piece.length
    if (batch.length > 0 && width + needed > MAX_LINE_COLUMNS) {
      lines.push(`${indent}${batch.join(" ")}`)
      batch = []
      width = indent.length
    }
    batch.push(piece)
    width += needed
  }
  if (batch.length > 0) lines.push(`${indent}${batch.join(" ")}`)
  return lines
}

function packEntries(entries: Array<[string, string]>, indent: string): string[] {
  const pieces = entries.map(([key, value], index) => `${quote(key)}: ${quote(value)}${index === entries.length - 1 ? "" : ","}`)
  return packPieces(pieces, indent)
}

function renderSectionObject(name: string, tokens: Record<string, string>, isLast: boolean): string[] {
  const entries = sortEntries(tokens)
  const lines = [`${" ".repeat(2)}${quote(name)}: {`]
  lines.push(...packEntries(entries, " ".repeat(4)))
  lines.push(`${" ".repeat(2)}}${isLast ? "" : ","}`)
  return lines
}

export function renderGeneratedFile(data: Md3GeneratedData): string {
  const source = data.source
  const lines: string[] = []
  const push = (...items: string[]): void => { lines.push(...items) }

  push(
    "/**",
    " * Material 3 design tokens — DO NOT EDIT — run bun run gen:md3-tokens",
    " *",
    ` * Provenance: ${source.package} ${source.version}, read from ${data.sourceDir}/ (the versioned directory that`,
    ` * holds the _md-*.scss token maps). Design system "${source.designSystem}" ${source.designVersion} and license`,
    ` * ${source.license} are taken from the source files' own GENERATED headers, the package version from the`,
    " * installed manifest — nothing here is transcribed by hand.",
    ` * Generator: scripts/gen-md3-tokens.ts. Gate: bun run audit:md3-tokens.`,
    " *",
    " * Shape:",
    ` * - ${source.sysGroups} system/reference modules. md-sys-color.scss declares values-light() and values-dark(), so`,
    ` *   MD3_SYS_TOKENS holds ${Object.keys(data.sys).length} sections: the color group is nested as "md-sys-color.light"`,
    ` *   and "md-sys-color.dark".`,
    ` * - ${source.componentSets} component sets, ${source.componentTokenCount} component tokens, ${source.sysTokenCount} system tokens.`,
    " *",
    " * Encoding decisions, each one faithful to the SCSS rather than convenient:",
    ` * - A cross-group reference stays symbolic as "ref:<group>:<token>" and is never flattened to a hex value,`,
    ` *   because md-sys-color is computed from the user's seed colour at runtime. md-ref-palette does keep its hex`,
    ` *   literals: that palette is a fixed upstream constant, and it is the layer md-sys-color references.`,
    ` * - \`if($exclude-hardcoded-values, null, X)\` guards are unwrapped to X; the flag only exists for Sass consumers.`,
    ` * - Composite font shorthands (\`weight size / line-height family\`) are emitted as "<key>-composite" with their`,
    ` *   parts joined by single spaces; the discrete \`-size\`/\`-line-height\`/\`-tracking\`/\`-weight\`/\`-font\` entries stay.`,
    ` * - Space-separated tuples keep their order with redundant zeros compressed: "(28px 28px 0px 0px)" -> "28px 28px 0 0".`,
    ` *   A standalone \`0px\` (md-sys-shape.corner-none) is not compressed, because that is how it was written.`,
    ` * - \`md-sys-motion.path\` is the string "null": the design system exports no value for it (type motion_path is`,
    ` *   unsupported upstream), and recording the gap beats inventing a duration.`,
    ` * - \`*-meta.scss\` is skipped: those are resolved fixtures for @material/web's own tests, not the vocabulary.`,
    " *",
    " * Keys are sorted everywhere, there is no timestamp and no absolute path, so the file is byte-reproducible.",
    ` * Entries are packed ${MAX_LINE_COLUMNS} columns wide because the repo caps a source file at ${MAX_FILE_LINES} lines:`,
    " * this table is data you reach through MD3_*_TOKENS, not prose you read top to bottom.",
    " */",
    "",
    "export interface Md3TokenSourceInfo {",
    "  package: string",
    "  version: string",
    "  designSystem: string",
    "  designVersion: string",
    "  license: string",
    "  sysGroups: number",
    "  componentSets: number",
    "  sysTokenCount: number",
    "  componentTokenCount: number",
    "}",
    "",
    "export const MD3_TOKEN_SOURCE: Md3TokenSourceInfo = {",
    `  componentSets: ${source.componentSets},`,
    `  componentTokenCount: ${source.componentTokenCount},`,
    `  designSystem: ${quote(source.designSystem)},`,
    `  designVersion: ${quote(source.designVersion)},`,
    `  license: ${quote(source.license)},`,
    `  package: ${quote(source.package)},`,
    `  sysGroups: ${source.sysGroups},`,
    `  sysTokenCount: ${source.sysTokenCount},`,
    `  version: ${quote(source.version)},`,
    "}",
    "",
    "/** group -> token -> literal value; color is split into md-sys-color.light and md-sys-color.dark. */",
    "export const MD3_SYS_TOKENS: Record<string, Record<string, string>> = {",
  )

  const sysNames = Object.keys(data.sys).sort()
  sysNames.forEach((name, index) => push(...renderSectionObject(name, data.sys[name] as Record<string, string>, index === sysNames.length - 1)))
  push("}", "", "/** component set -> token -> literal or \"ref:<group>:<token>\". */", "export const MD3_COMPONENT_TOKENS: Record<string, Record<string, string>> = {")

  const setNames = Object.keys(data.component).sort()
  setNames.forEach((name, index) => push(...renderSectionObject(name, data.component[name] as Record<string, string>, index === setNames.length - 1)))

  push(
    "}",
    "",
    "export const MD3_COMPONENT_SET_NAMES: readonly string[] = [",
    ...packPieces(setNames.map((name, index) => `${quote(name)}${index === setNames.length - 1 ? "" : ","}`), "  "),
    "]",
    "",
  )

  const rendered = lines.join("\n")
  const physicalLines = rendered.split("\n").length
  if (physicalLines > MAX_FILE_LINES) {
    throw new Error(`generated ${OUTPUT_RELATIVE_PATH} would be ${physicalLines} lines, over the ${MAX_FILE_LINES}-line source cap: raise MAX_LINE_COLUMNS in scripts/gen-md3-tokens.ts or split the generator`)
  }
  return rendered
}

// ---------------------------------------------------------------------------------------------
// Drift report
// ---------------------------------------------------------------------------------------------

/** A diff-ish summary: how far apart the two renders are, plus the first few differing lines. */
export function describeGeneratedDrift(onDisk: string, rendered: string): string[] {
  const before = onDisk.split("\n")
  const after = rendered.split("\n")
  const differing: string[] = []
  const shared = Math.min(before.length, after.length)
  for (let index = 0; index < shared; index += 1) {
    if (before[index] !== after[index]) differing.push(describeLineDiff(index, before[index] as string, after[index] as string))
  }
  const lines = differing.slice(0, 6)
  if (differing.length > 6) lines.push(`...and ${differing.length - 6} more differing lines`)
  if (before.length !== after.length) {
    lines.push(`line count: file ${before.length} vs generator ${after.length} (${after.length - before.length > 0 ? "+" : ""}${after.length - before.length})`)
  }
  return lines
}

const DRIFT_WINDOW = 72
const DRIFT_LOOKBEHIND = 44

/**
 * Entries are packed several to a line, so quoting the head of the line would hide the change: skip the shared
 * prefix and show the window around the first character that differs, far enough back to name the token.
 */
function describeLineDiff(index: number, before: string, after: string): string {
  let offset = 0
  while (offset < before.length && offset < after.length && before[offset] === after[offset]) offset += 1
  const from = Math.max(0, offset - DRIFT_LOOKBEHIND)
  const cut = (text: string): string => text.slice(from, from + DRIFT_LOOKBEHIND + DRIFT_WINDOW)
  return `line ${index + 1} column ${offset + 1}: file has ${JSON.stringify(cut(before))}; generator writes ${JSON.stringify(cut(after))}`
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function summaryLines(data: Md3GeneratedData): string[] {
  const source = data.source
  return [
    `token dir         ${data.sourceDir}`,
    `source            ${source.package}@${source.version} (${source.designSystem} ${source.designVersion}, ${source.license})`,
    `sys groups        ${source.sysGroups} modules / ${Object.keys(data.sys).length} sections`,
    `component sets    ${source.componentSets}`,
    `sys tokens        ${source.sysTokenCount}`,
    `component tokens  ${source.componentTokenCount}`,
    `total tokens      ${source.sysTokenCount + source.componentTokenCount}`,
  ]
}

/** One line for the gate: what was matched, in the numbers a reviewer cares about. */
function sourceCheck(data: Md3GeneratedData): string {
  const source = data.source
  return `${source.package}@${source.version} ${source.designVersion}: ${source.sysGroups} sys groups / ${source.componentSets} sets / ${source.sysTokenCount + source.componentTokenCount} tokens match ${OUTPUT_RELATIVE_PATH}`
}

const FLAGS = new Set(["--check", "--print-summary"])

if (import.meta.main) {
  const args = process.argv.slice(2)
  const unknown = args.filter((arg) => !FLAGS.has(arg))
  if (unknown.length > 0) throw new Error(`unknown argument(s) ${unknown.join(", ")}: expected --check or --print-summary`)

  const data = await collectMd3Tokens()
  const rendered = renderGeneratedFile(data)

  if (args.includes("--print-summary")) {
    console.log(summaryLines(data).join("\n"))
  } else if (args.includes("--check")) {
    const onDisk = await readFile(OUTPUT_PATH, "utf8").catch(() => null)
    if (onDisk === null) {
      console.error(`FAIL  ${OUTPUT_RELATIVE_PATH} does not exist.`)
      throw new Error(`run: bun run gen:md3-tokens`)
    }
    if (onDisk !== rendered) {
      for (const line of describeGeneratedDrift(onDisk, rendered)) console.error(`FAIL  ${line}`)
      console.error(`      run: bun run gen:md3-tokens, then review the diff of ${OUTPUT_RELATIVE_PATH}.`)
      throw new Error(`${OUTPUT_RELATIVE_PATH} no longer matches the installed ${data.source.package}@${data.source.version} token maps.`)
    }
    console.log(`OK md3 tokens: ${sourceCheck(data)}.`)
  } else {
    await mkdir(join(REPO_ROOT, "src/lib/design-theme/md3"), { recursive: true })
    await writeFile(OUTPUT_PATH, rendered, "utf8")
    console.log(`md3 tokens: wrote ${OUTPUT_RELATIVE_PATH}`)
    console.log(summaryLines(data).join("\n"))
  }
}
