/**
 * One-off migration: definition files written before ADR-0069's conditions were flattened.
 *
 * `Condition` used to be a recursive tree (`not(all(...))`, `all[any(...)]`). Recursive variants cannot be
 * expressed in WIT, so ADR-0068 forbids them: the contract is now `single(predicate)`, `all[predicates]`,
 * `any[predicates]` where a predicate is `{test, negated}`. This script rewrites the old shape into that
 * one — distributing `all[any(..)]` into `any[all(..), ..]` (disjunctive normal form) where needed — so a
 * transcription made against the old encoding becomes valid without re-reading the node's TypeScript.
 *
 * Delete once every definition under `plugins/` and `node-definitions/` is authored in the flat
 * form; until then re-run it after any batch of transcriptions lands.
 */
import { glob, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

type Json = Record<string, unknown>

const TEST_KINDS = ["always", "actionIs", "fieldEquals", "fieldFilled", "fieldTrue", "numberAtLeast"]

const isPredicate = (node: Json): boolean => "test" in node

function asTest(node: Json): Json {
  const kind = node.type
  if (typeof kind !== "string") throw new Error("condition without a type")
  if (!TEST_KINDS.includes(kind)) throw new Error(`not a test: ${kind}`)
  if (kind === "always") return { type: "always" }
  if (kind === "actionIs") return { type: "actionIs", actionField: node.actionField, allowed: node.allowed }
  if (kind === "fieldEquals") return { type: "fieldEquals", fieldId: node.fieldId, value: node.value }
  if (kind === "numberAtLeast") return { type: "numberAtLeast", fieldId: node.fieldId, minimum: node.minimum }
  return { type: kind, fieldId: node.fieldId }
}

/**
 * Every node of an old or new tree, as a list of conjunctive clauses.
 *
 * Negation of a compound is only accepted where the source can actually produce one today: the
 * transcriptions used `not(leaf)` and `not(actionIs)` exclusively, so a `not` over `all`/`any` is reported
 * rather than silently mis-distibuted.
 */
function clauses(node: unknown): Json[][] {
  const record = node as Json
  if (typeof record !== "object" || record === null) throw new Error("condition is not an object")
  if (isPredicate(record)) return [[{ test: record.test, negated: Boolean(record.negated) }]]
  const kind = record.type
  if (kind === "single") return clauses(record.predicate)
  if (kind === "not") {
    const inner = clauses(record.condition)
    return inner.map((clause) => clause.map((predicate) => ({ test: predicate.test, negated: !predicate.negated })))
  }
  if (kind === "all" || kind === "any") {
    const items = (record.predicates ?? record.conditions ?? []) as unknown[]
    const parts = items.map((item) => clauses(item))
    if (kind === "any") return parts.flat()
    return parts.reduce<Json[][]>((acc, part) => acc.flatMap((existing) => part.map((extra) => [...existing, ...extra])), [[]])
  }
  if (typeof kind === "string" && TEST_KINDS.includes(kind)) {
    return [[{ test: asTest(record), negated: Boolean(record.negated) }]]
  }
  throw new Error(`unknown condition: ${JSON.stringify(kind)}`)
}

function normalize(node: unknown): Json {
  const all = clauses(node)
  if (all.length === 1 && all[0]?.length === 1) return { type: "single", predicate: all[0][0] }
  if (all.length === 1) return { type: "all", predicates: all[0] }
  // `any` of conjunctions needs a nesting level the contract does not have; that only happens for
  // genuinely disjunctive-of-conjunctive sources, which are reported for hand authoring.
  if (all.every((clause) => clause.length === 1)) return { type: "any", predicates: all.flat() }
  return { type: "anyAll", clauses: all }
}

function normalizeRule(item: unknown): unknown {
  const rule = item as Json
  if (rule && typeof rule === "object" && "rule" in rule) {
    return rule.when ? { rule: rule.rule, when: normalize(rule.when) } : { rule: rule.rule }
  }
  return { rule }
}

const paths: string[] = []
for await (const path of glob("plugins/*/definition.json")) paths.push(path)
for await (const path of glob("node-definitions/*.json")) if (!paths.includes(path)) paths.push(path)
paths.sort()

let rewritten = 0
const problems: string[] = []
for (const path of paths) {
  try {
    const doc = JSON.parse(await readFile(path, "utf8")) as Json
    const before = JSON.stringify(doc)
    for (const entry of (doc.fields ?? []) as Json[]) {
      if (entry.visible) entry.visible = normalize(entry.visible)
      if (Array.isArray(entry.rules)) entry.rules = (entry.rules as unknown[]).map(normalizeRule)
    }
    if (typeof doc.danger === "object" && doc.danger !== null) {
      const danger = doc.danger as Json
      if (danger.type === "all" || danger.type === "any") doc.danger = normalize(danger)
    }
    if (JSON.stringify(doc) !== before) {
      await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8")
      rewritten += 1
    }
  } catch (error) {
    // Reported, never swallowed: a file this script cannot normalize still needs a human pass.
    problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log(`node definition encoding: scanned ${paths.length} file(s), rewrote ${rewritten}.`)
for (const problem of problems) console.error(problem)
if (problems.length > 0) process.exitCode = 1
