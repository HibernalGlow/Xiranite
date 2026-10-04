/**
 * Controls for the interaction-parity gate.
 *
 * Every rule the gate claims gets a fixture that must pass and a fixture that must fail with the named
 * problem, because a parity checker is only worth its green line: a comparison that silently reports
 * "matched" for a definition that dropped an action is worse than no gate. The refusal-to-guess cases are
 * asserted the other way round — an unreducible closure must produce a manual-review item and *no* verdict,
 * so incompleteness can never read as progress.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, expect, test } from "bun:test"

import { assertNonEmptyScan, auditInteractionParity, type NodeParity, type ParityReport } from "./audit-node-interaction-parity.ts"
import { definitionGateForm, gateFormText, normalizeGateForm } from "./lib/node-gate-form.ts"

const roots: string[] = []

const localized = (zh: string, en: string): Record<string, string> => ({ zh, en })

/**
 * One node's `interaction.ts`, as a fixture: the same shape the real nodes write (a factory returning a
 * schema object, `role: "action"`, boolean fields), and closure text supplied per test.
 */
const schemaSource = (options: {
  isDangerous?: string
  dangerPrompt?: string
  actions?: string[]
  initialValues?: string
  extraFields?: string
}): string => {
  const actions = options.actions ?? ["scan", "rename"]
  return `
export function createDemoInteractionSchema(d: Record<string, unknown> = {}, language = "zh") {
  const zh = language === "zh"
  return {
    id: "demo",
    title: "Demo",
    description: "demo node",
    initialValues: { action: "${actions[0]}", paths: "", dryRun: true, mode: "normal"${options.initialValues ? `, ${options.initialValues}` : ""}, ...d },
    fields: [
      {
        id: "action",
        label: zh ? "操作" : "Action",
        kind: "select",
        role: "action",
        options: [${actions.map((value) => `{ value: "${value}", label: "${value}" }`).join(", ")}],
      },
      { id: "paths", label: zh ? "目录" : "Folders", kind: "text" },
      { id: "dryRun", label: zh ? "仅预演" : "Dry run", kind: "boolean" },
      { id: "mode", label: zh ? "规则" : "Rule", kind: "select", options: [{ value: "normal", label: "Normal" }] },
      ${options.extraFields ?? ""}
    ],
    toInput: (values: Record<string, unknown>) => values,
    preview: () => [],
    result: (result: Record<string, unknown>) => result,
    ${options.isDangerous ? `isDangerous: ${options.isDangerous},` : ""}
    ${options.dangerPrompt ? `dangerPrompt: ${options.dangerPrompt},` : ""}
  }
}
`
}

/** The definition that says exactly what `schemaSource()` with the default options says. */
const matchingDefinition = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  definitionVersion: 1,
  nodeId: id,
  actions: [
    { id: "scan", label: localized("扫描", "Scan") },
    { id: "rename", label: localized("重命名", "Rename") },
  ],
  fields: [
    {
      id: "action",
      kind: "select",
      isActionSelector: true,
      options: [{ value: { text: "scan" } }, { value: { text: "rename" } }],
      default: { text: "scan" },
    },
    { id: "paths", kind: "text", default: { text: "" } },
    { id: "dryRun", kind: "boolean", default: { boolean: true } },
    { id: "mode", kind: "select", options: [{ value: { text: "normal" } }], default: { text: "normal" } },
  ],
  inputBindings: [
    { fieldId: "action", slot: "action", transform: "identity" },
    { fieldId: "paths", slot: "paths", transform: "identity" },
    { fieldId: "dryRun", slot: "dryRun", transform: "asBoolean" },
    { fieldId: "mode", slot: "mode", transform: "identity" },
  ],
  // The default fixture's gate: rename with the dry-run flag off, exactly as trename writes it.
  danger: {
    type: "all",
    predicates: [
      { test: { type: "actionIs", actionField: "action", allowed: ["rename"] }, negated: false },
      { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: true },
    ],
  },
  dangerPrompt: {
    title: localized("确认真实改名", "Confirm live rename"),
    body: localized("文件将被移动。", "Files will be moved."),
    confirmLabel: localized("确认移动", "Move files"),
  },
  reportsProgress: false,
  publishesOutputPath: false,
  ...extra,
})

const defaultPromptClosure = `() => { const zh = language === "zh"; return { title: zh ? "确认真实改名" : "Confirm live rename", body: zh ? "文件将被移动。" : "Files will be moved.", confirmLabel: zh ? "确认移动" : "Move files" } }`

/** Write one fixture node plus its definition, scan it, and hand back the single node's report. */
async function runFixture(options: {
  id?: string
  interaction?: string
  definition?: Record<string, unknown> | null
  published?: Record<string, unknown> | null
}): Promise<{ parity: NodeParity; report: ParityReport }> {
  const id = options.id ?? "demonode"
  const root = await mkdtemp(join(tmpdir(), "xiranite-parity-"))
  roots.push(root)
  const nodesRoot = join(root, "nodes")
  const draftsRoot = join(root, "drafts")
  const pluginsRoot = join(root, "plugins")
  await mkdir(join(nodesRoot, id, "src"), { recursive: true })
  await mkdir(draftsRoot, { recursive: true })
  await mkdir(pluginsRoot, { recursive: true })
  const interaction = options.interaction ?? schemaSource({ isDangerous: `(input) => input.action === "rename" && input.dryRun === false`, dangerPrompt: defaultPromptClosure })
  await writeFile(join(nodesRoot, id, "src", "interaction.ts"), interaction, "utf8")
  if (options.definition !== null) {
    await writeFile(join(draftsRoot, `${id}.json`), JSON.stringify(options.definition ?? matchingDefinition(id), null, 2), "utf8")
  }
  if (options.published) {
    await mkdir(join(pluginsRoot, id), { recursive: true })
    await writeFile(join(pluginsRoot, id, "definition.json"), JSON.stringify(options.published, null, 2), "utf8")
  }
  const report = await auditInteractionParity({ nodesRoot, pluginsRoot, draftsRoot })
  const parity = report.entries.find((entry) => entry.nodeId === id)
  if (!parity) throw new Error(`fixture ${id} produced no parity entry: ${JSON.stringify(report.withoutSchema.concat(report.withoutDefinition))}`)
  return { parity, report }
}

const hasProblem = (parity: NodeParity, pattern: RegExp): boolean => parity.problems.some((problem) => pattern.test(problem))

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------- the passing case

test("a definition that repeats its node's schema passes on every axis", async () => {
  const { parity } = await runFixture({})
  expect(parity.problems).toEqual([])
  expect(parity.gateVerdict).toBe("matched")
  expect(parity.gateSchema).toBe("action∈[rename] ∧ ¬true(dryRun)")
  expect(parity.promptVerdict).toBe("matched")
  expect(parity.actionFieldFrom).toBe("role")
  expect(parity.missingActions).toEqual([])
  expect(parity.missingFields).toEqual([])
  expect(parity.defaultsCompared).toBe(4)
})

test("the gate grammar prints what both sides really mean", () => {
  // `all[actionIs, ¬fieldTrue]` is trename's closure; the forms must collide, not merely be similar.
  const definition = definitionGateForm(
    matchingDefinition("demonode"),
  )
  expect(definition.reason).toBeNull()
  expect(gateFormText(definition.form ?? [])).toBe("action∈[rename] ∧ ¬true(dryRun)")
})

// ---------------------------------------------------------------- missing capability: hard fails

test("an action the schema offers and the definition dropped is a missing capability", async () => {
  const definition = matchingDefinition("demonode")
  definition.actions = [{ id: "scan", label: localized("扫描", "Scan") }]
  const { parity } = await runFixture({ definition })
  expect(parity.missingActions).toEqual(["rename"])
  expect(hasProblem(parity, /MISSING ACTION "rename"/)).toBe(true)
})

test("a field the definition dropped is a missing capability", async () => {
  const definition = matchingDefinition("demonode")
  definition.fields = (definition.fields as Record<string, unknown>[]).filter((field) => field.id !== "paths")
  definition.inputBindings = (definition.inputBindings as Record<string, unknown>[]).filter((binding) => binding.fieldId !== "paths")
  const { parity } = await runFixture({ definition })
  expect(parity.missingFields).toEqual(["paths"])
  expect(hasProblem(parity, /MISSING FIELD "paths"/)).toBe(true)
})

test("a default the definition rewrote is reported with both values", async () => {
  const definition = matchingDefinition("demonode")
  const dryRun = (definition.fields as Record<string, unknown>[]).find((field) => field.id === "dryRun")
  dryRun!.default = { boolean: false }
  const { parity } = await runFixture({ definition })
  expect(hasProblem(parity, /DEFAULT CHANGED for "dryRun": the schema starts it at "true" but the definition says "false"\./)).toBe(true)
})

test("a default the definition forgot entirely is reported, not silently re-defaulted", async () => {
  const definition = matchingDefinition("demonode")
  const dryRun = (definition.fields as Record<string, unknown>[]).find((field) => field.id === "dryRun")
  delete dryRun!.default
  const { parity } = await runFixture({ definition })
  expect(hasProblem(parity, /DEFAULT UNDECLARED for "dryRun"/)).toBe(true)
})

test("a select default the definition points at another option is reported", async () => {
  const definition = matchingDefinition("demonode")
  const action = (definition.fields as Record<string, unknown>[]).find((field) => field.id === "action")
  action!.default = { text: "rename" }
  const { parity } = await runFixture({ definition })
  expect(hasProblem(parity, /DEFAULT CHANGED for "action"/)).toBe(true)
})

test("a confirmation dialog the definition never carries is a missing fact", async () => {
  const definition = matchingDefinition("demonode")
  delete definition.dangerPrompt
  const { parity } = await runFixture({ definition })
  expect(parity.promptVerdict).toBe("mismatched")
  expect(hasProblem(parity, /DANGER PROMPT MISSING/)).toBe(true)
})

test("reworded confirmation copy is drift, and the locale that drifted is named", async () => {
  const definition = matchingDefinition("demonode")
  const prompt = definition.dangerPrompt as Record<string, Record<string, string>>
  prompt.title.zh = "确认执行"
  const { parity } = await runFixture({ definition })
  expect(parity.promptVerdict).toBe("mismatched")
  expect(hasProblem(parity, /title\.zh = "确认执行" but the node writes "确认真实改名"/)).toBe(true)
  expect(parity.problems.join(" ").includes("title.en")).toBe(false)
})

test("a flipped danger gate is a mismatch rather than a disclosure", async () => {
  const definition = matchingDefinition("demonode")
  definition.danger = {
    type: "all",
    predicates: [
      { test: { type: "actionIs", actionField: "action", allowed: ["rename"] }, negated: false },
      // asking when dry-run is ON is the opposite promise, and the one an editing mistake produces.
      { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: false },
    ],
  }
  const { parity } = await runFixture({ definition })
  expect(parity.gateVerdict).toBe("mismatched")
  expect(hasProblem(parity, /DANGER GATE MISMATCH: .*asks when action∈\[rename\] ∧ ¬true\(dryRun\), but the definition declares action∈\[rename\] ∧ true\(dryRun\)/)).toBe(true)
})

test("a gate that dropped the dry-run condition is a mismatch, not a subset match", async () => {
  const definition = matchingDefinition("demonode")
  definition.danger = { type: "actionIn", actionField: "action", dangerous: ["rename"] }
  const { parity } = await runFixture({ definition })
  expect(parity.gateVerdict).toBe("mismatched")
  expect(hasProblem(parity, /DANGER GATE MISMATCH/)).toBe(true)
})

// ---------------------------------------------------------------- the equivalences it must prove

const gateFixture = async (isDangerous: string, danger: Record<string, unknown>): Promise<NodeParity> => {
  const { parity } = await runFixture({
    interaction: schemaSource({ isDangerous, dangerPrompt: defaultPromptClosure }),
    definition: matchingDefinition("demonode", { danger }),
  })
  return parity
}

test("an OR of live actions factors into one actionIs, the way the gate language has to say it", async () => {
  // enginev: `(rename || delete) && !dryRun` and `all[actionIs([rename, delete]), ¬fieldTrue(dryRun)]`.
  const parity = await gateFixture(
    `(input) => (input.action === "rename" || input.action === "scan") && input.dryRun === false`,
    {
      type: "all",
      predicates: [
        { test: { type: "actionIs", actionField: "action", allowed: ["rename", "scan"] }, negated: false },
        { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: true },
      ],
    },
  )
  expect(parity.gateVerdict).toBe("matched")
  expect(parity.problems).toEqual([])
})

test("two negated actions merge into one negated value set", async () => {
  // smartzip: `action !== "status" && action !== "inspect_codepage" && dryRun === false`.
  const parity = await gateFixture(
    `(input) => input.action !== "rename" && input.action !== "scan" && input.dryRun === false`,
    {
      type: "all",
      predicates: [
        { test: { type: "actionIs", actionField: "action", allowed: ["rename", "scan"] }, negated: true },
        { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: true },
      ],
    },
  )
  expect(parity.gateVerdict).toBe("matched")
  expect(parity.problems).toEqual([])
})

test("a negated action set is not read as an affirmed one", async () => {
  const parity = await gateFixture(
    `(input) => input.action !== "scan" && input.dryRun === false`,
    {
      type: "all",
      predicates: [
        { test: { type: "actionIs", actionField: "action", allowed: ["scan"] }, negated: false },
        { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: true },
      ],
    },
  )
  expect(parity.gateVerdict).toBe("mismatched")
})

test("a falsy flag check and a negated fieldTrue collide for a boolean field", async () => {
  // timeu: `action !== "scan" && !dryRun`.
  const parity = await gateFixture(
    `(input) => input.action !== "rename" && !input.dryRun`,
    {
      type: "all",
      predicates: [
        { test: { type: "actionIs", actionField: "action", allowed: ["rename"] }, negated: true },
        { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: true },
      ],
    },
  )
  expect(parity.gateVerdict).toBe("matched")
  expect(parity.problems).toEqual([])
})

test("a literal list through includes() is read as a value set", async () => {
  // formatv: `["add_nov", "remove_nov"].includes(input.action ?? "") && input.dryRun === false`.
  const parity = await gateFixture(
    `(input) => ["rename", "scan"].includes(input.action ?? "") && input.dryRun === false`,
    {
      type: "all",
      predicates: [
        { test: { type: "actionIs", actionField: "action", allowed: ["rename", "scan"] }, negated: false },
        { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: true },
      ],
    },
  )
  expect(parity.gateVerdict).toBe("matched")
  expect(parity.problems).toEqual([])
})

test("a negated includes() is read as a negated value set", async () => {
  // dissolvef: `!['plan','history'].includes(String(i.action)) && i.preview === false`.
  const parity = await gateFixture(
    `(i) => !["rename", "scan"].includes(String(i.action)) && i.dryRun === false`,
    {
      type: "all",
      predicates: [
        { test: { type: "actionIs", actionField: "action", allowed: ["rename", "scan"] }, negated: true },
        { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: true },
      ],
    },
  )
  expect(parity.gateVerdict).toBe("matched")
})

test("a constant never-dangerous node matches a none gate", async () => {
  // soundw/logx/linedup: `() => false` with `danger: {type:"none"}`.
  const parity = await gateFixture(`() => false`, { type: "none" })
  expect(parity.gateVerdict).toBe("matched")
  expect(parity.gateSchema).toBe("never")
  expect(parity.problems).toEqual([])
})

test("a constant never-dangerous node does not match a gate that asks", async () => {
  const parity = await gateFixture(`() => false`, { type: "actionIn", actionField: "action", dangerous: ["rename"] })
  expect(parity.gateVerdict).toBe("mismatched")
  expect(hasProblem(parity, /DANGER GATE MISMATCH: .*never, but the definition declares action∈\[rename\]/)).toBe(true)
})

// ---------------------------------------------------------------- refusing to guess

test("a closure the grammar cannot name becomes manual review with no verdict", async () => {
  const parity = await gateFixture(`(input) => summarize(input) === "risky"`, { type: "pluginExport", exportName: "is_dangerous" })
  expect(parity.gateVerdict).toBe("review")
  expect(parity.problems).toEqual([])
  const item = parity.manualReview.find((entry) => entry.subject === "isDangerous")
  expect(item?.file).toBe("packages/nodes/demonode/src/interaction.ts")
  expect(item?.line).toBeGreaterThan(1)
  expect(item?.source).toContain("summarize(input)")
})

test("a field that is not boolean on both sides is never matched to a truthiness gate", async () => {
  // The rule this proves: `mode === false` and `¬fieldTrue(mode)` are different claims for a select field,
  // so the gate has to say "I cannot tell" instead of scoring it.
  const parity = await gateFixture(`(input) => input.mode === false`, {
    type: "all",
    predicates: [{ test: { type: "fieldTrue", fieldId: "mode" }, negated: true }],
  })
  expect(parity.gateVerdict).toBe("review")
  expect(parity.problems).toEqual([])
  expect(parity.manualReview.some((entry) => /boolean/.test(entry.reason))).toBe(true)
})

test("a slot the definition binds to no field is refused, not mapped by name", async () => {
  const definition = matchingDefinition("demonode")
  definition.inputBindings = (definition.inputBindings as Record<string, unknown>[]).filter((binding) => binding.fieldId !== "dryRun")
  definition.fields = (definition.fields as Record<string, unknown>[]).filter((field) => field.id !== "dryRun")
  const { parity } = await runFixture({
    interaction: schemaSource({ isDangerous: `(input) => input.action === "rename" && input.dryRun === false`, dangerPrompt: defaultPromptClosure }),
    definition,
  })
  expect(parity.missingFields).toEqual(["dryRun"])
  expect(parity.gateVerdict).toBe("review")
  expect(parity.manualReview.some((entry) => /dryRun/.test(entry.reason))).toBe(true)
})

test("a gate delegated to a plugin export is manual review, not a match", async () => {
  // repacku/marku/migratef/bandia chose `DangerGate::PluginExport`; the export's body is not this file.
  const parity = await gateFixture(`(input) => input.dryRun === false || input.action === "rename"`, { type: "pluginExport", exportName: "is_dangerous" })
  expect(parity.gateVerdict).toBe("review")
  expect(parity.gateReason).toContain('plugin export "is_dangerous"')
  expect(parity.problems).toEqual([])
})

test("a prompt that reads its argument is reviewed rather than compared to static copy", async () => {
  const { parity } = await runFixture({
    interaction: schemaSource({
      isDangerous: `(input) => input.action === "rename" && input.dryRun === false`,
      dangerPrompt: `(input) => { const zh = language === "zh"; return { title: input.action === "rename" ? (zh ? "确认真实改名" : "Confirm live rename") : (zh ? "确认" : "Confirm"), body: zh ? "文件将被移动。" : "Files will be moved.", confirmLabel: zh ? "确认移动" : "Move files" } }`,
    }),
  })
  expect(parity.promptVerdict).toBe("review")
  expect(parity.problems).toEqual([])
  expect(parity.manualReview.some((entry) => entry.subject === "dangerPrompt" && /depends on the input/.test(entry.reason))).toBe(true)
})

test("a prompt delegated to an export is disclosed with the export's name", async () => {
  const definition = matchingDefinition("demonode")
  delete definition.dangerPrompt
  definition.dangerPromptExport = "danger_prompt"
  const { parity } = await runFixture({
    interaction: schemaSource({
      isDangerous: `(input) => input.action === "rename" && input.dryRun === false`,
      dangerPrompt: `(input) => { const zh = language === "zh"; return { title: input.dryRun ? (zh ? "甲" : "A") : (zh ? "乙" : "B"), body: zh ? "文件将被移动。" : "Files will be moved.", confirmLabel: zh ? "确认移动" : "Move files" } }`,
    }),
    definition,
  })
  expect(parity.promptVerdict).toBe("declared-by-export")
  expect(parity.problems).toEqual([])
  expect(parity.disclosed.join(" ")).toContain('plugin export "danger_prompt"')
})

// ---------------------------------------------------------------- disclosure, not failure

test("an action the definition added is disclosed and still passes", async () => {
  const definition = matchingDefinition("demonode")
  definition.actions = [...(definition.actions as Record<string, unknown>[]), { id: "history", label: localized("历史", "History") }]
  const { parity } = await runFixture({
    interaction: schemaSource({ isDangerous: `() => false`, dangerPrompt: defaultPromptClosure }),
    definition: { ...definition, danger: { type: "none" } },
  })
  expect(parity.addedActions).toEqual(["history"])
  expect(parity.problems).toEqual([])
})

test("a field the definition added is disclosed and still passes", async () => {
  const definition = matchingDefinition("demonode")
  definition.fields = [...(definition.fields as Record<string, unknown>[]), { id: "extra", kind: "text", default: { text: "" } }]
  definition.inputBindings = [...(definition.inputBindings as Record<string, unknown>[]), { fieldId: "extra", slot: "extra", transform: "identity" }]
  const { parity } = await runFixture({ definition })
  expect(parity.addedFields).toEqual(["extra"])
  expect(parity.problems).toEqual([])
})

test("the published definition wins over the draft, and its break is the one reported", async () => {
  const broken = matchingDefinition("demonode")
  broken.fields = (broken.fields as Record<string, unknown>[]).filter((field) => field.id !== "paths")
  broken.inputBindings = (broken.inputBindings as Record<string, unknown>[]).filter((binding) => binding.fieldId !== "paths")
  const { parity } = await runFixture({ definition: matchingDefinition("demonode"), published: broken })
  expect(parity.definitionSource).toBe("published")
  expect(parity.definitionPath).toContain(join("plugins", "demonode", "definition.json"))
  expect(hasProblem(parity, /MISSING FIELD "paths"/)).toBe(true)
})

// ---------------------------------------------------------------- scan hygiene

test("a file with no terminal schema is kept out of the comparison instead of passing", async () => {
  const root = await mkdtemp(join(tmpdir(), "xiranite-parity-"))
  roots.push(root)
  const nodesRoot = join(root, "nodes")
  const draftsRoot = join(root, "drafts")
  const pluginsRoot = join(root, "plugins")
  await mkdir(join(nodesRoot, "strippednode", "src"), { recursive: true })
  await mkdir(draftsRoot, { recursive: true })
  await mkdir(pluginsRoot, { recursive: true })
  // findz is this case: the node deleted its schema, so there is no vocabulary to compare against.
  await writeFile(join(nodesRoot, "strippednode", "src", "interaction.ts"), 'export const REMOVED = "the node deleted its terminal schema."\n', "utf8")
  await writeFile(join(draftsRoot, "strippednode.json"), JSON.stringify(matchingDefinition("strippednode"), null, 2), "utf8")
  const report = await auditInteractionParity({ nodesRoot, pluginsRoot, draftsRoot })
  expect(report.scanned).toEqual([])
  expect(report.withoutSchema).toEqual(["strippednode"])
  expect(report.counts.problems).toBe(0)
})

test("a schema module that will not load is a problem, not a silent pass", async () => {
  const { parity } = await runFixture({
    id: "brokennode",
    interaction: [
      'import { nope } from "@xiranite/this-package-does-not-exist"',
      "export function createDemoInteractionSchema() {",
      "  return { fields: [], initialValues: {}, toInput: (values) => values, isDangerous: () => false, nope }",
      "}",
    ].join("\n"),
  })
  expect(parity.problems.join(" ")).toContain("UNLOADABLE")
  expect(parity.gateVerdict).toBe("absent")
})

test("an unparseable definition fails the node rather than comparing nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "xiranite-parity-"))
  roots.push(root)
  const nodesRoot = join(root, "nodes")
  const draftsRoot = join(root, "drafts")
  const pluginsRoot = join(root, "plugins")
  await mkdir(join(nodesRoot, "garbage", "src"), { recursive: true })
  await mkdir(draftsRoot, { recursive: true })
  await mkdir(pluginsRoot, { recursive: true })
  await writeFile(join(nodesRoot, "garbage", "src", "interaction.ts"), schemaSource({ isDangerous: `() => false` }), "utf8")
  await writeFile(join(draftsRoot, "garbage.json"), "{ not json", "utf8")
  const report = await auditInteractionParity({ nodesRoot, pluginsRoot, draftsRoot })
  const entry = report.entries.find((candidate) => candidate.nodeId === "garbage")
  expect(entry?.problems.join(" ")).toContain("UNREADABLE DEFINITION")
})

test("an empty scan is refused rather than reported as full parity", async () => {
  const root = await mkdtemp(join(tmpdir(), "xiranite-parity-"))
  roots.push(root)
  const nodesRoot = join(root, "nodes")
  await mkdir(nodesRoot, { recursive: true })
  const empty = await auditInteractionParity({ nodesRoot, pluginsRoot: join(root, "plugins"), draftsRoot: join(root, "drafts") })
  expect(empty.scanned).toEqual([])
  expect(() => assertNonEmptyScan(empty, nodesRoot)).toThrow("the scan path is wrong")
})

test("nodes without a definition are counted but never invented", async () => {
  const root = await mkdtemp(join(tmpdir(), "xiranite-parity-"))
  roots.push(root)
  const nodesRoot = join(root, "nodes")
  const draftsRoot = join(root, "drafts")
  const pluginsRoot = join(root, "plugins")
  await mkdir(join(nodesRoot, "orphan", "src"), { recursive: true })
  await mkdir(draftsRoot, { recursive: true })
  await mkdir(pluginsRoot, { recursive: true })
  await writeFile(join(nodesRoot, "orphan", "src", "interaction.ts"), schemaSource({ isDangerous: `() => false` }), "utf8")
  const report = await auditInteractionParity({ nodesRoot, pluginsRoot, draftsRoot })
  expect(report.withoutDefinition).toEqual(["orphan"])
  expect(report.scanned).toEqual([])
  expect(report.counts.problems).toBe(0)
  expect(() => assertNonEmptyScan(report, nodesRoot)).toThrow("no node with both an interaction.ts and a definition")
})

test("normalising a gate form refuses a clause that needs both polarities of one field", () => {
  const contradictory = normalizeGateForm([
    [{ kind: "oneOf", field: "action", values: ["rename"], negated: false }, { kind: "oneOf", field: "action", values: ["scan"], negated: true }],
  ])
  expect(contradictory.ok).toBe(false)
})
