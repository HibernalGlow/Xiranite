import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "bun:test"

import {
  CONDITION_KINDS,
  HELP_SURFACES,
  DANGER_KINDS,
  TEST_KINDS,
  NODE_FIELD_KINDS,
  RULE_KINDS,
  TRANSFORMS,
  VALUE_SOURCE_KINDS,
  parseAndValidateDefinition,
  validateNodeDefinition,
} from "./lib/node-definition.ts"

const RUST_SOURCE = join(import.meta.dir, "..", "crates", "xiranite-plugin-api", "src", "node_definition.rs")
const RUST_HELP_SOURCE = join(import.meta.dir, "..", "crates", "xiranite-plugin-api", "src", "node_definition", "help.rs")
const SNF_DEFINITION = join(import.meta.dir, "..", "plugins", "snf", "definition.json")
const PUBLISHED = ["snf", "nameu", "logx", "timeu", "transq"]

/** Variant names of one `pub enum X { .. }` block in the Rust source. */
async function rustVariants(enumName: string): Promise<string[]> {
  const source = await readFile(RUST_SOURCE, "utf8")
  const start = source.indexOf(`pub enum ${enumName} {`)
  if (start < 0) throw new Error(`${enumName} is not declared in ${RUST_SOURCE}`)
  const body = source.slice(start + `pub enum ${enumName} {`.length)
  const end = body.indexOf("\n}")
  if (end < 0) throw new Error(`${enumName} block is unterminated`)
  return [...body.slice(0, end).matchAll(/^ {4}([A-Z][A-Za-z]*)/gm)].map((match) => match[1] ?? "")
}

const camel = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1)
/** `PathList` -> `path-list`, which is the wire label the Rust `as_str` returns. */
const kebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()

test("the TypeScript vocabulary equals the Rust contract, in both directions", async () => {
  // A drift here is the fork ADR-0068 exists to prevent: a gate accepting a predicate the runtime types
  // cannot represent means a definition file that no face can render.
  expect((await rustVariants("FieldKind")).map(kebab)).toEqual([...NODE_FIELD_KINDS])
  expect((await rustVariants("Condition")).map(camel)).toEqual([...CONDITION_KINDS])
  expect((await rustVariants("Test")).map(camel)).toEqual([...TEST_KINDS])
  expect((await rustVariants("ValueSource")).map(camel)).toEqual([...VALUE_SOURCE_KINDS])
  expect((await rustVariants("Rule")).map(camel)).toEqual([...RULE_KINDS])
  expect((await rustVariants("DangerGate")).map(camel)).toEqual([...DANGER_KINDS])
  expect((await rustVariants("Transform")).map(camel)).toEqual([...TRANSFORMS])
  expect((await rustVariants("ValueSource")).map(camel)).toEqual([...VALUE_SOURCE_KINDS])
})

test("field kinds keep the wire labels the TypeScript union already uses", async () => {
  const source = await readFile(RUST_SOURCE, "utf8")
  const labels = [...source.matchAll(/Self::\w+ => "([\w-]+)",/g)].map((match) => match[1] ?? "")
  expect(labels.slice(0, 6)).toEqual([...NODE_FIELD_KINDS])
})

const loadSnf = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(SNF_DEFINITION, "utf8")) as Record<string, unknown>

const fields = (definition: Record<string, unknown>): Record<string, unknown>[] =>
  definition.fields as Record<string, unknown>[]

const bindings = (definition: Record<string, unknown>): Record<string, unknown>[] =>
  definition.inputBindings as Record<string, unknown>[]

test("every published definition validates, so the gate is not vacuous", async () => {
  for (const nodeId of PUBLISHED) {
    const path = join(import.meta.dir, "..", "plugins", nodeId, "definition.json")
    const report = parseAndValidateDefinition(await readFile(path, "utf8"))
    expect(report.problems, `${nodeId}: ${report.problems.join(" | ")}`).toEqual([])
  }
})

test("a malformed file is reported instead of silently skipped", () => {
  expect(parseAndValidateDefinition("{not json").problems[0]).toContain("not valid JSON")
})

test("every guard fires on its own mistake, not on a neighbouring one", async () => {
  const cases: Array<[string, (definition: Record<string, unknown>) => void, string]> = [
    ["version", (d) => { d.definitionVersion = 2 }, "definitionVersion must be 1"],
    ["blank language", (d) => { d.title = { zh: "", en: "Sequence repair" } }, "title.zh is blank"],
    ["half a text", (d) => { d.description = { zh: "目录序号缺口扫描与顺序修复" } }, "must carry exactly {zh, en}"],
    ["no actions", (d) => { d.actions = [] }, "actions must not be empty"],
    ["duplicate action", (d) => { (d.actions as unknown[]).push((d.actions as unknown[])[0]) }, "duplicate action id"],
    ["unknown condition kind", (d) => { fields(d)[1].visible = { type: "regexMatches" } }, "is not in the Rust Condition enum"],
    ["unknown test kind", (d) => {
      fields(d)[1].visible = { type: "single", predicate: { test: { type: "regexMatches" }, negated: false } }
    }, "is not in the Rust Test enum"],
    ["bare test instead of predicate", (d) => {
      fields(d)[1].visible = { type: "single", predicate: { type: "always" } }
    }, "must be a predicate object"],
    ["predicate without negated", (d) => {
      fields(d)[1].visible = { type: "single", predicate: { test: { type: "always" } } }
    }, "negated must be a boolean"],
    ["undeclared visibility reference", (d) => {
      fields(d)[1].visible = { type: "single", predicate: { test: { type: "fieldTrue", fieldId: "ghost" }, negated: false } }
    }, 'reads undeclared field "ghost"'],
    ["forward reference to a later field is legal", (d) => {
      // A field may be gated on one declared after it; ordering of `fields` is presentation, not scope.
      fields(d)[0].visible = { type: "single", predicate: { test: { type: "fieldTrue", fieldId: "dryRun" }, negated: false } }
    }, ""],
    ["duplicate field id", (d) => { fields(d).push({ ...fields(d)[1] }) }, 'duplicate field id "pathsText"'],
    ["select without options", (d) => { fields(d)[2].options = [] }, "a select field must offer options"],
    ["range on a non-number", (d) => { fields(d)[1].range = { min: 0, max: 2, step: 1 } }, "range belongs to number fields only"],
    ["inverted range", (d) => {
      fields(d)[3].kind = "number"
      fields(d)[3].range = { min: 9, max: 1, step: 1 }
      fields(d)[3].default = { number: 5 }
    }, "exceeds range.max"],
    ["default kind mismatch", (d) => { fields(d)[4].default = { text: "true" } }, "does not match kind boolean"],
    ["unguarded rule", (d) => { fields(d)[1].rules = [{ type: "atLeastLines", minimum: 1 }] }, "holds GuardedRule, not a bare rule"],
    ["rule without an export name", (d) => { fields(d)[1].rules = [{ rule: { type: "custom" } }] }, "must name the plugin export implementing it"],
    ["rule condition reference", (d) => {
      fields(d)[1].rules = [{ rule: { type: "required" }, when: { type: "single", predicate: { test: { type: "fieldTrue", fieldId: "ghost" }, negated: false } } }]
    }, "reads undeclared field"],
    ["selector disagrees with actions", (d) => { d.actions = (d.actions as unknown[]).slice(0, 2) }, "options are not exactly the declared actions"],
    ["action carrying a helpKey", (d) => { (d.actions as Record<string, unknown>[])[0].helpKey = "action.scan" }, "helpKey is not accepted vocabulary"],
    ["group reference", (d) => { (d.groups as Record<string, unknown>[])[0].fieldIds = ["ghost"] }, 'references undeclared field "ghost"'],
    ["no bindings at all", (d) => { d.inputBindings = [] }, "inputBindings must not be empty"],
    ["binding reference", (d) => { bindings(d)[0].fieldId = "ghost" }, 'references undeclared field "ghost"'],
    ["unknown transform", (d) => { bindings(d)[1].transform = "shout" }, `is not one of ${TRANSFORMS.join(", ")}`],
    ["unknown binding key", (d) => { bindings(d)[0].bogusKey = true }, "carries unknown key"],
    ["blank defaultExport", (d) => { bindings(d)[0].defaultExport = " " }, "must name the plugin export computing the value"],
    ["danger names an undeclared action", (d) => {
      d.danger = { type: "actionIn", actionField: "action", dangerous: ["delete-everything"] }
    }, "which is not declared"],
    ["danger reads a ghost field", (d) => { d.danger = { type: "fieldFlag", fieldId: "ghost", inverted: false } }, "must reference a declared field"],
    ["danger predicate reference", (d) => {
      d.danger = { type: "all", predicates: [{ test: { type: "fieldTrue", fieldId: "ghost" }, negated: true }] }
    }, "danger reads undeclared field"],
    ["prompt with a none gate", (d) => { d.danger = { type: "none" } }, "the prompt would never show"],
    ["progress flag not boolean", (d) => { d.reportsProgress = "yes" }, "reportsProgress must be a boolean"],
    ["blank preview export", (d) => { d.previewExport = "  " }, "previewExport must name a plugin export"],
    ["dashboard reads a ghost field", (d) => {
      d.dashboard = { title: { zh: "状态", en: "Status" }, primary: { type: "field", fieldId: "ghost" }, metrics: [] }
    }, "dashboard reads undeclared field"],
    ["dashboard literal is blank", (d) => {
      d.dashboard = { title: { zh: "状态", en: "Status" }, primary: { type: "literal", value: { zh: "", en: "Idle" } }, metrics: [] }
    }, "dashboard.primary.value.zh is blank"],
    ["dashboard fallback missing", (d) => {
      d.dashboard = { title: { zh: "状态", en: "Status" }, primary: { type: "firstNonEmpty", fieldIds: ["mode"] }, metrics: [] }
    }, "fallbackText must be a localized text object"],
    ["duplicate result column", (d) => {
      d.resultTable = { columns: [{ id: "path", label: { zh: "路径", en: "Path" } }, { id: "path", label: { zh: "路径", en: "Path" } }] }
    }, 'duplicate result column id "path"'],
    ["result table without columns", (d) => { d.resultTable = { columns: [] } }, "resultTable declares no columns"],
    ["empty conjunction", (d) => { fields(d)[1].visible = { type: "all", predicates: [] } }, "needs at least one predicate"],
    ["empty normal form clause", (d) => { fields(d)[1].visible = { type: "anyAll", clauses: [[]] } }, "clauses[0] is empty"],
    ["rule with an unknown key", (d) => { fields(d)[1].rules = [{ rule: { type: "required" }, note: "internal" }] }, "carries unknown key"],
    ["rule message missing a language", (d) => { fields(d)[1].rules = [{ rule: { type: "required" }, message: { zh: "请填写", en: " " } }] }, "rules[0].message.en is blank"],
    ["scalar with two keys", (d) => { fields(d)[4].default = { boolean: true, text: "true" } }, "must be exactly one of text/number/boolean"],
  ]

  for (const [label, change, expected] of cases) {
    const definition = await loadSnf()
    change(definition)
    const problems = validateNodeDefinition(definition).problems
    if (expected === "") {
      // The forward-reference control asserts the opposite of a guard: it must stay silent.
      if (problems.length > 0) throw new Error(`guard "${label}" should validate, got: ${problems.join(" | ")}`)
      continue
    }
    // Named failures: an anonymous `some(...)` assertion cannot say which guard stopped working.
    if (!problems.some((problem) => problem.includes(expected))) {
      throw new Error(`guard "${label}" did not report "${expected}"; got: ${problems.join(" | ") || "(none)"}`)
    }
  }
})

test("declaring the dashboard and the result table keeps a definition valid", async () => {
  const definition = await loadSnf()
  definition.dashboard = {
    title: { zh: "状态", en: "Status" },
    primary: { type: "actionLabel" },
    secondary: { type: "firstNonEmpty", fieldIds: ["pathsText", "mode"], fallbackText: { zh: "空闲", en: "Idle" } },
    metrics: [{ label: { zh: "模式", en: "Mode" }, source: { type: "field", fieldId: "mode" } }],
  }
  definition.resultTable = {
    columns: [
      { id: "artist", label: { zh: "作者", en: "Artist" }, width: 30 },
      { id: "gap", label: { zh: "缺口", en: "Gap" }, width: 12 },
    ],
    emptyMessage: { zh: "无结果", en: "No results" },
  }
  expect(validateNodeDefinition(definition).problems).toEqual([])
})

test("the help block's surface keys are the same table on both sides", async () => {
  // `help.ts` authors a workflow's steps under `ui`/`cli`/`tips`, and the Rust face reads those spellings back
  // out of `HelpSurface::as_str`. A drift here means a published block whose steps no face can find.
  const source = await readFile(RUST_HELP_SOURCE, "utf8")
  const start = source.indexOf("pub enum HelpSurface {")
  expect(start, "HelpSurface is declared in node_definition/help.rs").toBeGreaterThanOrEqual(0)
  const arms = [...source.slice(start).matchAll(/Self::([A-Z][A-Za-z]*) => "([a-z]+)"/g)].slice(0, 3)
  expect(arms.map((match) => match[1])).toEqual(["WorkspaceUi", "CommandLine", "Tips"])
  expect(arms.map((match) => match[2])).toEqual([...HELP_SURFACES])
})

const helpFixture = (): Record<string, unknown> => ({
  whenToUse: { zh: ["目录需要整理时"], en: ["When a folder needs sorting"] },
  workflows: [
    {
      title: { zh: "工作区 UI", en: "Workspace UI" },
      summary: { zh: "从节点面板运行。", en: "Run it from the node surface." },
      ui: { zh: ["打开模块库。"], en: ["Open the registry."] },
    },
  ],
  commands: [
    {
      title: { zh: "节点 CLI", en: "Node CLI" },
      command: "xiranite sample",
      description: { zh: "打开引导式运行。", en: "Open the guided run." },
      examples: [{ label: { zh: "引导模式", en: "Guided mode" }, command: "xiranite sample" }],
    },
  ],
  safety: { defaultMode: "preview", notes: { zh: ["未确认前不写入。"], en: ["Nothing is written yet."] } },
})

test("a help block quoted from the dictionary validates", async () => {
  const definition = await loadSnf()
  definition.help = helpFixture()
  expect(validateNodeDefinition(definition).problems).toEqual([])
})

test("each help mistake is named by its own path", async () => {
  const cases: Array<[string, (help: Record<string, unknown>) => void, string]> = [
    ["two shapes per language are legal", (help) => { (help.whenToUse as { zh: string[] }).zh.push("第二句") }, "__no_problem__"],
    ["an invented key", (help) => { help.gotchas = { zh: [], en: [] } }, 'help carries unknown key "gotchas"'],
    ["a workflow with no steps", (help) => { delete (help.workflows as Record<string, unknown>[])[0]!.ui }, "must carry steps under at least one of"],
    ["a command without its line", (help) => { delete (help.commands as Record<string, unknown>[])[0]!.command }, "command must be the literal command line"],
    ["a blank step", (help) => { ((help.workflows as Record<string, unknown>[])[0]!.ui as { en: string[] }).en = ["  "] }, "is blank"],
    ["safety that says nothing", (help) => { help.safety = {} }, "neither destructive nor notes"],
    ["prose where a list belongs", (help) => { help.whenToUse = "When a folder needs sorting." }, "help.whenToUse must be a localized list object"],
  ]
  for (const [name, mutate, expected] of cases) {
    const definition = await loadSnf()
    const help = helpFixture()
    mutate(help)
    definition.help = help
    const problems = validateNodeDefinition(definition).problems
    if (expected === "__no_problem__") {
      expect(problems, `${name} must stay legal: each language keeps the steps it authored`).toEqual([])
      continue
    }
    expect(problems.some((problem) => problem.includes(expected)), `${name}: ${problems.join(" | ")}`).toBe(true)
  }
})

test("a block written as prose instead of pairs cannot pass", async () => {
  const definition = await loadSnf()
  definition.help = { whenToUse: "When a folder needs sorting." }
  const problems = validateNodeDefinition(definition).problems
  expect(problems.some((problem) => problem.includes("help.whenToUse must be a localized list object"))).toBe(true)
})

test("every definition whose node publishes a dictionary carries the help block", async () => {
  // Positive control for the publisher: the gate that writes the block and the contract that reads it have to
  // agree on which files are covered, or a face ships a node with no help at all.
  const report = await (await import("./audit-node-help-text.ts")).auditNodeHelpText({
    definitionsRoot: join(import.meta.dir, "..", "node-definitions"),
    pluginsRoot: join(import.meta.dir, "..", "plugins"),
    nodesRoot: join(import.meta.dir, "..", "packages", "nodes"),
    baselinePath: join(import.meta.dir, "..", "docs", "node-help-text-baseline.json"),
  })
  expect(report.length, "the scan is not vacuous").toBeGreaterThan(30)
  const documented = report.filter((entry) => !entry.missingDictionary)
  expect(documented.length).toBeGreaterThan(30)
  for (const entry of documented) {
    const definition = JSON.parse(await readFile(entry.definitionPath, "utf8")) as Record<string, unknown>
    expect(definition.help, `${entry.nodeId} ships no help block`).toBeObject()
    expect(entry.missingHelpBlock, `${entry.nodeId} is missing its block`).toBe(false)
    expect(entry.helpDrift, `${entry.nodeId}: ${entry.helpDrift.join(" | ")}`).toEqual([])
  }
})
