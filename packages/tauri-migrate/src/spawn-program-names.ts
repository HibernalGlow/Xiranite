import { type SgNode } from "@ast-grep/napi"

/**
 * How a spawn call site is read as a *closed set* of program names.
 *
 * Split out of `node-feasibility.ts` because this is the part of that audit with its own failure mode: an
 * answer here becomes an entry on the host's allowlist, so the only acceptable kinds of output are a name a
 * call site spells out and an explicit "nobody named this". The rule that earned the split is the ternary one
 * (`docs/migration/node-flavor-distribution.md` §8.5): `cond ? "open" : "xdg-open"` is closed and grantable,
 * `cond ? "open" : fallback` is not, and reporting the first set for the second would turn a partially
 * computed program into a permission.
 */

/**
 * How a program name was proved from the file that spawns it.
 *
 * `literal` — quoted at the call; `const` — a `const NAME = "…"` in the same file; `wrapper` — the spawn sits
 * inside a same-file helper that takes the program as a parameter, and *every* call site of that helper in the
 * same file passes a provable name. Call sites inside the clipboard block do not count in either direction,
 * because that block is not node demand (see `SurfaceFileAnalysis`).
 *
 * Measured on this tree (2026-10-06, after the ternary rule landed): 6 named programs across the retained nodes,
 * 2 `literal` (`tar`, `powershell.exe`) and 4 `wrapper` — all four of `kisaki`'s come through `runOrThrow`, and
 * `open` + `xdg-open` of those only appear once a *caller* is allowed to hand the helper a
 * `cond ? "open" : "xdg-open"`. The `const` arm has no live name yet (fixtures cover it: a same-file
 * `const SEVENZIP = "7z.exe"`),
 * and the located-path half is a host question, not an analyzer gap: `mvz`/`bandia`/`repacku`/`smartzip` pass
 * `process.platform === "win32" ? "where.exe" : "which"` and then the **located absolute path**
 * (`find7z()` → `C:\Program Files\7-Zip\7z.exe`), `bitv` a resolved `ffprobePath`, `gifu` one wrapper deeper. It is
 * recorded in `docs/migration/quickjs-substrate-evaluation.md` §21.2: the allowlist holds program *names*, and a
 * path-shaped request is refused by shape (`proc_operations.rs:127`).
 */
export type ProgramVia = "literal" | "const" | "wrapper"

/** A resolved program name plus the proof it was resolved by. */
export type ProgramName = { name: string; via: ProgramVia }

/** Named children of a node — `arguments` and `formal_parameters` also carry punctuation, which is unnamed. */
export function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed())
}

/**
 * The `const NAME = "literal"` bindings of one file, so `execFile(SEVENZIP, …)` is as grantable as
 * `execFile("7z.exe", …)`. Only same-file string constants are resolved on purpose: following an import to a
 * shared package would turn one string in `@xiranite/file-operations` into an allowlist entry for every node that
 * imports it, which is exactly the false grant this table exists to prevent.
 */
export function collectConstStringBindings(root: SgNode): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const declarator of root.findAll({ rule: { kind: "variable_declarator" } })) {
    const name = declarator.field("name")
    const value = declarator.field("value")
    if (!name || !value || value.kind() !== "string") continue
    const literal = value.text().replace(/^["'`]|["'`]$/g, "").trim()
    if (literal.length > 0) bindings.set(name.text(), literal)
  }
  return bindings
}

/** The first argument of a call, by earliest start offset (`findAll` is recursive, so position is the filter). */
export function firstArgumentOf(call: SgNode): SgNode | null {
  const args = call.field("arguments")
  if (!args) return null
  // The first *top-level* argument. Picking the earliest node of a few interesting kinds instead reaches
  // *inside* an expression: for `proc.exec(platform === "darwin" ? "open" : "xdg-open", [path])` it handed back
  // the `"darwin"` literal from the condition, so the site both mis-named the demand and could never be
  // resolved. A ternary whose branches are literals has a closed name set and deserves to be granted.
  for (const child of args.children()) {
    if (child.kind() === "(" || child.kind() === ")" || child.kind() === ",") continue
    return child
  }
  return null
}

/**
 * The program name a call argument spells: a quoted string or a same-file string constant answers one, anything
 * else answers `null` so the report can say "this one needs a human" instead of inventing a program.
 */
export function programNameOfNode(first: SgNode, constStrings: Map<string, string>): ProgramName | null {
  const text = first.text()
  if (first.kind() === "string") {
    const literal = text.replace(/^["'`]|["'`]$/g, "").trim()
    // A template-ish or interpolated literal is not a program name; `${…}` inside quotes means the caller decides.
    if (literal.length > 0 && !literal.includes("${")) return { name: literal, via: "literal" }
    return null
  }
  if (first.kind() === "identifier") {
    const resolved = constStrings.get(text)
    if (resolved !== undefined) return { name: resolved, via: "const" }
  }
  return null
}

/**
 * The program names a spawn argument can hold on **every** path.
 *
 * One literal answers one name; `cond ? "open" : "xdg-open"` answers two, and both are spelled out in the
 * source, so the closed set is exactly what an allowlist has to carry. Anything else — a parameter, a
 * template, a config read, or a ternary with such a branch — answers `[]`, and the site is disclosed as
 * unresolved rather than guessed: an invented program name on the allowlist is worse than a missing one.
 */
export function programNamesOfNode(node: SgNode, constStrings: Map<string, string>): ProgramName[] {
  const single = programNameOfNode(node, constStrings)
  if (single !== null) return [single]
  if (node.kind() !== "ternary_expression") return []
  const consequence = node.field("consequence")
  const alternative = node.field("alternative")
  if (!consequence || !alternative) return []
  const left = programNamesOfNode(consequence, constStrings)
  const right = programNamesOfNode(alternative, constStrings)
  // Both arms must be closed. `cond ? "open" : fallback` is not a name set — reporting `{open}` for it would
  // turn a partially-computed program into an allowlist entry, which is the one thing this rule exists to stop.
  if (left.length === 0 || right.length === 0) return []
  const names = [...left, ...right]
  const unique = new Map<string, ProgramName>()
  for (const entry of names) {
    const existing = unique.get(entry.name)
    // `literal` outranks `const`: a spelled-out branch is stronger evidence than an alias for the same name.
    if (!existing || (existing.via === "const" && entry.via === "literal")) unique.set(entry.name, entry)
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/** The argument at a positional index, skipping punctuation and comments; `null` when the call has fewer arguments. */
export function positionalArgumentOf(call: SgNode, index: number): SgNode | null {
  const args = call.field("arguments")
  if (!args) return null
  const positions = namedChildren(args).filter((child) => child.kind() !== "comment")
  return positions[index] ?? null
}

/**
 * What a spawn call asks the host to run. A quoted argument or a same-file string constant answers a name; a
 * locator function, a template, or anything else answers `[]` plus the text as written, so the report can say
 * "this one needs a human" instead of inventing a program.
 *
 * `argumentName` is set only for an unresolved bare identifier — the handle the wrapper pass needs in order to
 * ask "is this a parameter of the function this spawn sits in?".
 */
export function spawnProgramEvidence(
  call: SgNode,
  constStrings: Map<string, string>,
): { programs: ProgramName[]; argument: string; argumentName: string | null } {
  const first = firstArgumentOf(call)
  if (!first) return { programs: [], argument: "", argumentName: null }
  const programs = programNamesOfNode(first, constStrings)
  if (programs.length > 0) return { programs, argument: first.text(), argumentName: null }
  return {
    programs: [],
    argument: first.text(),
    argumentName: first.kind() === "identifier" ? first.text() : null,
  }
}
