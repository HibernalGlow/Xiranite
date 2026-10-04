import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, test } from "bun:test"

import {
  CONDITION_KINDS,
  DANGER_KINDS,
  NODE_FIELD_KINDS,
  RULE_KINDS,
  TRANSFORMS,
  parseAndValidateDefinition,
  validateNodeDefinition,
} from "./lib/node-definition.ts"

const RUST_SOURCE = join(import.meta.dir, "..", "crates", "xiranite-plugin-api", "src", "node_definition.rs")

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
  expect((await rustVariants("Rule")).map(camel)).toEqual([...RULE_KINDS])
  expect((await rustVariants("DangerGate")).map(camel)).toEqual([...DANGER_KINDS])
  expect((await rustVariants("Transform")).map(camel)).toEqual([...TRANSFORMS])
})

test("field kinds keep the wire labels the TypeScript union already uses", async () => {
  const source = await readFile(RUST_SOURCE, "utf8")
  const labels = [...source.matchAll(/Self::\w+ => "([\w-]+)",/g)].map((match) => match[1] ?? "")
  expect(labels.slice(0, 6)).toEqual([...NODE_FIELD_KINDS])
})

/** The snf schema, transcribed from `packages/nodes/snf/src/interaction.ts`. */
function snfDefinition(): Record<string, unknown> {
  const bilingual = (zh: string, en: string) => ({ zh, en })
  return {
    definitionVersion: 1,
    nodeId: "snf",
    title: bilingual("目录序号修复", "Sequence repair"),
    description: bilingual("目录序号缺口扫描与顺序修复", "Folder sequence gap scan and repair"),
    actions: [
      { id: "scan", label: bilingual("⌕ 扫描", "⌕ Scan"), helpKey: "action.scan" },
      { id: "plan", label: bilingual("⌁ 预览", "⌁ Preview"), helpKey: "action.plan" },
      { id: "rename", label: bilingual("⇄ 修复", "⇄ Repair"), helpKey: "action.rename" },
    ],
    fields: [
      {
        id: "action",
        label: bilingual("命令", "Command"),
        kind: "select",
        isActionSelector: true,
        options: [
          { value: { text: "scan" }, label: bilingual("⌕ 扫描", "⌕ Scan") },
          { value: { text: "plan" }, label: bilingual("⌁ 预览", "⌁ Preview") },
          { value: { text: "rename" }, label: bilingual("⇄ 修复", "⇄ Repair") },
        ],
        default: { text: "plan" },
        visible: { type: "always" },
        rules: [{ rule: { type: "oneOfDeclaredOptions" } }],
      },
      {
        id: "pathsText",
        label: bilingual("目录路径", "Folder paths"),
        kind: "path-list",
        lines: 3,
        default: { text: "" },
        visible: { type: "always" },
        rules: [{ rule: { type: "atLeastLines", minimum: 1 } }],
      },
      {
        id: "mode",
        label: bilingual("扫描模式", "Scan mode"),
        kind: "select",
        options: [
          { value: { text: "library" }, label: bilingual("▦ 资料库", "▦ Library") },
          { value: { text: "artist" }, label: bilingual("▤ 作者目录", "▤ Artist") },
        ],
        default: { text: "library" },
        visible: { type: "always" },
        rules: [],
      },
      {
        id: "priorityKeywords",
        label: bilingual("优先关键词", "Priority keywords"),
        kind: "text",
        default: { text: "同人志,商业,单行,CG,画集" },
        visible: { type: "always" },
        rules: [],
      },
      { id: "keepTimestamp", label: bilingual("保留时间", "Keep timestamps"), kind: "boolean", default: { boolean: true }, visible: { type: "always" }, rules: [] },
      {
        id: "dryRun",
        label: bilingual("仅预演", "Dry run"),
        kind: "boolean",
        default: { boolean: true },
        visible: { type: "actionIs", actionField: "action", allowed: ["rename"] },
        rules: [],
      },
    ],
    groups: [
      {
        id: "sequence",
        title: bilingual("序号修复", "Sequence repair"),
        fieldIds: ["action", "pathsText", "mode", "priorityKeywords", "keepTimestamp", "dryRun"],
      },
    ],
    inputBindings: [
      { fieldId: "action", slot: "action", transform: "trim" },
      { fieldId: "pathsText", slot: "paths", transform: "lines" },
      { fieldId: "mode", slot: "mode", transform: "trim" },
      { fieldId: "priorityKeywords", slot: "priorityKeywords", transform: "lines" },
      { fieldId: "keepTimestamp", slot: "keepTimestamp", transform: "asBoolean" },
      { fieldId: "dryRun", slot: "dryRun", transform: "asBoolean" },
    ],
    danger: {
      type: "all",
      conditions: [
        { type: "actionIs", actionField: "action", allowed: ["rename"] },
        { type: "not", condition: { type: "fieldTrue", fieldId: "dryRun" } },
      ],
    },
    dangerPrompt: {
      title: bilingual("确认修复目录序号", "Confirm sequence repair"),
      body: bilingual("就绪目录将被重命名并重新编号。", "Ready folders will be renamed and resequenced."),
      confirmLabel: bilingual("确认修复", "Repair"),
    },
    previewExport: "preview",
    resultExport: "result_view",
    reportsProgress: true,
    publishesOutputPath: false,
  }
}

test("a transcribed node schema passes, so the gate is not vacuous", () => {
  expect(validateNodeDefinition(snfDefinition()).problems).toEqual([])
})

test("the same content as text still validates through the file path", () => {
  expect(parseAndValidateDefinition(JSON.stringify(snfDefinition())).problems).toEqual([])
  expect(parseAndValidateDefinition("{not json").problems[0]).toContain("not valid JSON")
})

test("every guard fires on its own mistake, not on a neighbouring one", () => {
  const mutate = (change: (definition: Record<string, unknown>) => void) => {
    const definition = snfDefinition()
    change(definition)
    return definition
  }

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["version", mutate((definition) => { definition.definitionVersion = 2 }), "definitionVersion must be 1"],
    ["blank language", mutate((definition) => { definition.title = { zh: "", en: "Sequence repair" } }), "title.zh is blank"],
    ["half text", mutate((definition) => { definition.description = { zh: "目录序号缺口扫描与顺序修复" } }), "must carry exactly {zh, en}"],
    ["no actions", mutate((definition) => { definition.actions = [] }), "actions must not be empty"],
    ["duplicate action", mutate((definition) => { definition.actions.push(definition.actions[0]) }), "duplicate action id"],
    ["unknown condition", mutate((definition) => {
      (definition.fields as Record<string, unknown>[])[1].visible = { type: "regexMatches" }
    }), "is not in the Rust Condition enum"],
    ["undeclared reference", mutate((definition) => {
      (definition.fields as Record<string, unknown>[])[1].visible = { type: "fieldTrue", fieldId: "ghost" }
    }), 'reads undeclared field "ghost"'],
    ["duplicate field", mutate((definition) => {
      const fields = definition.fields as Record<string, unknown>[]
      fields.push({ ...fields[1] })
    }), 'duplicate field id "pathsText"'],
    ["select without options", mutate((definition) => {
      (definition.fields as Record<string, unknown>[])[2].options = []
    }), "a select field must offer options"],
    ["range on non-number", mutate((definition) => {
      (definition.fields as Record<string, unknown>[])[1].range = { min: 0, max: 2, step: 1 }
    }), "range belongs to number fields only"],
    ["inverted range", mutate((definition) => {
      ;(definition.fields as Record<string, unknown>[])[3].kind = "number"
      ;(definition.fields as Record<string, unknown>[])[3].range = { min: 9, max: 1, step: 1 }
      ;(definition.fields as Record<string, unknown>[])[3].default = { number: 5 }
    }), "exceeds range.max"],
    ["default kind mismatch", mutate((definition) => {
      (definition.fields as Record<string, unknown>[])[4].default = { text: "true" }
    }), "does not match kind boolean"],
    ["unguarded rule", mutate((definition) => {
      ;(definition.fields as Record<string, unknown>[])[1].rules = [{ type: "atLeastLines", minimum: 1 }]
    }), "holds GuardedRule, not a bare rule"],
    ["rule condition reference", mutate((definition) => {
      ;(definition.fields as Record<string, unknown>[])[1].rules = [{ rule: { type: "required" }, when: { type: "fieldTrue", fieldId: "ghost" } }]
    }), "rules reads undeclared field"],
    ["custom rule unnamed", mutate((definition) => {
      ;(definition.fields as Record<string, unknown>[])[1].rules = [{ rule: { type: "custom" } }]
    }), "must name the plugin export implementing it"],
    ["selector mismatch", mutate((definition) => {
      definition.actions = (definition.actions as Record<string, unknown>[]).slice(0, 2)
    }), "options are not exactly the declared actions"],
    ["group reference", mutate((definition) => {
      (definition.groups as Record<string, unknown>[])[0].fieldIds = ["ghost"]
    }), 'references undeclared field "ghost"'],
    ["binding without fields", mutate((definition) => { definition.inputBindings = [] }), "inputBindings must not be empty"],
    ["binding reference", mutate((definition) => {
      (definition.inputBindings as Record<string, unknown>[])[0].fieldId = "ghost"
    }), 'references undeclared field "ghost"'],
    ["unknown transform", mutate((definition) => {
      (definition.inputBindings as Record<string, unknown>[])[1].transform = "shout"
    }), `is not one of ${TRANSFORMS.join(", ")}`],
    ["danger unknown action", mutate((definition) => {
      definition.danger = { type: "actionIn", actionField: "action", dangerous: ["delete-everything"] }
    }), "which is not declared"],
    ["danger ghost field", mutate((definition) => {
      definition.danger = { type: "fieldFlag", fieldId: "ghost", inverted: false }
    }), "must reference a declared field"],
    ["prompt with none", mutate((definition) => {
      definition.danger = { type: "none" }
    }), "the prompt would never show"],
    ["progress flag not boolean", mutate((definition) => { definition.reportsProgress = "yes" }), "reportsProgress must be a boolean"],
    ["empty preview export", mutate((definition) => { definition.previewExport = "  " }), "previewExport must name a plugin export"],
  ]

  for (const [label, definition, expected] of cases) {
    const problems = validateNodeDefinition(definition).problems
    // Named failures: a loop that only asserts `true` cannot say which guard stopped working.
    if (!problems.some((problem) => problem.includes(expected))) {
      throw new Error(`guard "${label}" did not report "${expected}"; problems were: ${problems.join(" | ") || "(none)"}`)
    }
  }
})

test("a scalar must be exactly one of text, number or boolean", () => {
  const definition = snfDefinition()
  ;(definition.fields as Record<string, unknown>[])[4].default = { boolean: true, text: "true" }
  expect(validateNodeDefinition(definition).problems).toContain(
    'fields[4].default must be exactly one of text/number/boolean, got {boolean, text}',
  )
})
