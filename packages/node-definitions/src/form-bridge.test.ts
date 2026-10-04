import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { conditionHolds, dangerState, defaultValues, fieldIsVisible, visibleFields } from "./form-bridge.ts"
import { validateNodeDefinition } from "./contract.ts"

const REPO = join(import.meta.dir, "..", "..", "..")
const DEFINITION = join(REPO, "node-definitions", "trename.json")

/**
 * The equivalence claim ADR-0069 rests on.
 *
 * A node's old `interaction.ts` decided visibility and danger with closures over the same values. Once the
 * definition carries that information as data, the interpreter here must answer identically — otherwise
 * the Web form and the future `clap`/`ratatui` faces drift apart by construction. This compares the two
 * over the whole action cross-product instead of over a hand-picked example.
 */
const loadDefinition = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(DEFINITION, "utf8")) as Record<string, unknown>

const ACTIONS = ["scan", "import", "validate", "rename", "undo", "history"]

const combinations = (): Array<Record<string, string | number | boolean>> => {
  const combos: Array<Record<string, string | number | boolean>> = []
  for (const action of ACTIONS) {
    for (const dryRun of [true, false]) {
      for (const jsonContent of ["", "{}"]) {
        combos.push({ action, dryRun, jsonContent, paths: "D:/a\nD:/b", maxLines: 0, includeHidden: false, includeRoot: false, compact: false, basePath: "", batchId: "", undoPath: "" })
      }
    }
  }
  return combos
}

test("the transcribed trename definition validates", async () => {
  const definition = await loadDefinition()
  expect(validateNodeDefinition(definition).problems).toEqual([])
})

test("visibility agrees with the node's own visibleWhen closures", async () => {
  const { createTrenameInteractionSchema } = await import(join(REPO, "packages", "nodes", "trename", "src", "interaction.ts"))
  const schema = createTrenameInteractionSchema({}, "zh") as unknown as {
    fields: Array<{ id: string, visibleWhen?: (values: Record<string, unknown>) => boolean }>
  }
  const definition = await loadDefinition()
  const closureFor = new Map(schema.fields.map((field) => [field.id, field.visibleWhen]))
  const declared = (definition.fields as Array<Record<string, unknown>>).map((field) => String(field.id))

  let compared = 0
  for (const values of combinations()) {
    const shown = new Set(visibleFields(definition, values, "zh").map((field) => field.id))
    for (const fieldId of declared) {
      const closure = closureFor.get(fieldId)
      // Fields the node never gated are visible by definition; both sides must agree either way.
      const expected = closure ? closure(values) === true : true
      expect(shown.has(fieldId), `${fieldId} at ${JSON.stringify(values)}: closure said ${expected}`).toBe(expected)
      compared += 1
    }
  }
  // Non-vacuity by count, not by a magic threshold: every declared field in every combination ran.
  expect(compared).toBe(declared.length * combinations().length)
})

test("an ungated field is visible and a negated test inverts it", async () => {
  const definition = await loadDefinition()
  const values = { ...defaultValues(definition), action: "scan" }
  expect(fieldIsVisible(definition, { id: "paths", visible: { type: "always" } }, values)).toBe(true)
  expect(conditionHolds({ type: "single", predicate: { test: { type: "never" }, negated: false } }, values)).toBe(false)
  expect(conditionHolds({ type: "single", predicate: { test: { type: "never" }, negated: true } }, values)).toBe(true)
})

test("the danger gate agrees with isDangerous for the live rename", async () => {
  const { createTrenameInteractionSchema } = await import(join(REPO, "packages", "nodes", "trename", "src", "interaction.ts"))
  const schema = createTrenameInteractionSchema({}, "zh") as unknown as {
    isDangerous: (input: Record<string, unknown>) => boolean
    toInput: (values: Record<string, unknown>) => Record<string, unknown>
  }
  const definition = await loadDefinition()
  let liveRename = 0
  for (const values of combinations()) {
    const expected = schema.isDangerous(schema.toInput(values) as Record<string, unknown>) === true
    const actual = dangerState(definition, values).dangerous
    if (values.action === "rename" && values.dryRun === false) liveRename += 1
    expect(actual, `danger at ${JSON.stringify(values)}`).toBe(expected)
  }
  expect(liveRename).toBeGreaterThan(0, "the live-rename case must actually be exercised")
})
