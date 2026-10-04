import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import type { NodeHelp } from "../packages/contract/src/index.ts"

import {
  acceptedHelpText,
  checkNodeHelpText,
  deriveHelpBlock,
  describeHelpDrift,
  readMissingDictionaryBaseline,
  withHelpTextSourced,
  withoutActionHelpKeys,
} from "./audit-node-help-text.ts"

const dictionary = (overrides: Partial<NodeHelp> = {}): NodeHelp => ({
  title: "Sample Node",
  short: "Base tagline.",
  description: "Base tagline.",
  workflows: [],
  commands: [],
  ...overrides,
})

const definition = (title: { zh: string; en: string }, description: { zh: string; en: string }) => ({
  definitionVersion: 1,
  nodeId: "sample",
  title,
  description,
})

test("text quoted from the dictionary passes on both locales", () => {
  const help = dictionary({ translations: { "zh-CN": { short: "基础文案。" } } })
  const report = checkNodeHelpText("sample", "sample.json", definition({ zh: "Sample Node", en: "Sample Node" }, { zh: "基础文案。", en: "Base tagline." }), help)
  expect(report.problems).toEqual([])
  expect(report.missingDictionary).toBe(false)
})

test("an invented description is a drift, and the accepted set is the dictionary's own text", () => {
  const help = dictionary({ translations: { "zh-CN": { short: "基础文案。", description: "基础文案。" } } })
  const report = checkNodeHelpText("sample", "sample.json", definition({ zh: "Sample Node", en: "Sample Node" }, { zh: "我编的一句", en: "Something I paraphrased" }), help)
  expect(report.problems.length).toBe(2)
  expect(report.problems.map((problem) => problem.locale).sort()).toEqual(["en", "zh"])
  expect(report.problems.find((problem) => problem.locale === "zh")?.accepted).toEqual(["基础文案。"])
})

test("a drifted title is caught separately from the description", () => {
  const report = checkNodeHelpText("sample", "sample.json", definition({ zh: "Sample Node", en: "Sample" }, { zh: "Base tagline.", en: "Base tagline." }), dictionary())
  expect(report.problems.length).toBe(1)
  expect(report.problems.every((problem) => problem.field === "title")).toBe(true)
  expect(report.problems[0]?.accepted).toEqual(["Sample Node"])
})

test("the zh side must come from the zh-CN translation, not the base text", () => {
  const help = dictionary({ translations: { "zh-CN": { title: "示例节点", short: "中文标题。", description: "中文标题。" } } })
  const report = checkNodeHelpText("sample", "sample.json", definition({ zh: "Sample Node", en: "Sample Node" }, { zh: "Base tagline.", en: "Base tagline." }), help)
  expect(report.problems.length).toBe(2)
  expect(report.problems.map((problem) => `${problem.field}.${problem.locale}→${problem.accepted.join("/")}`)).toEqual([
    "title.zh→示例节点",
    "description.zh→中文标题。",
  ])
})

test("without a zh translation the zh side is the base text, exactly as localizeNodeHelp falls back", () => {
  const expected = acceptedHelpText(dictionary())
  expect(expected.title.zh).toBe("Sample Node")
  expect(expected.description.zh).toEqual(["Base tagline."])
})

test("either short or description is an accepted quote of the dictionary", () => {
  const help = dictionary({ short: "Short form.", description: "Longer form." })
  const expected = acceptedHelpText(help)
  expect(expected.description.en).toEqual(["Short form.", "Longer form."])
  const report = checkNodeHelpText("sample", "sample.json", definition({ zh: "Sample Node", en: "Sample Node" }, { zh: "Short form.", en: "Longer form." }), help)
  expect(report.problems).toEqual([])
})

test("a node without a help dictionary leaves its text unbacked instead of silently passing", () => {
  const report = checkNodeHelpText("sample", "sample.json", definition({ zh: "x", en: "x" }, { zh: "y", en: "y" }), null)
  expect(report.missingDictionary).toBe(true)
  expect(report.problems).toEqual([])
})

test("apply fixes drift and leaves an accepted quote untouched", () => {
  const help = dictionary({ short: "Short form.", description: "Longer form.", translations: { "zh-CN": { short: "中文短句。" } } })
  const drifted = withHelpTextSourced(definition({ zh: "Sample Node", en: "Sample Node" }, { zh: "我编的一句", en: "Something I paraphrased" }), help)
  expect(drifted.description).toEqual({ zh: "中文短句。", en: "Short form." })

  const alreadySourced = definition({ zh: "Sample Node", en: "Sample Node" }, { zh: "中文短句。", en: "Longer form." })
  expect(withHelpTextSourced(alreadySourced, help)).toEqual(alreadySourced)

  expect(checkNodeHelpText("sample", "sample.json", drifted as Record<string, unknown>, help).problems).toEqual([])
})

test("the non-English base text is disclosed, not failed", () => {
  const report = checkNodeHelpText("sample", "sample.json", definition({ zh: "示例节点", en: "示例节点" }, { zh: "中文基础文案。", en: "中文基础文案。" }), dictionary({ title: "示例节点", short: "中文基础文案。", description: "中文基础文案。" }))
  expect(report.nonEnglishBase).toBe(true)
  expect(report.problems).toEqual([])
})

test("the one-time strip removes action helpKey and is a no-op afterwards", () => {
  const withKeys = {
    nodeId: "sample",
    actions: [
      { id: "scan", label: { zh: "扫描", en: "Scan" }, helpKey: "action.scan" },
      { id: "apply", label: { zh: "应用", en: "Apply" } },
    ],
  }
  const stripped = withoutActionHelpKeys(withKeys)
  expect(stripped.actions).toEqual([
    { id: "scan", label: { zh: "扫描", en: "Scan" } },
    { id: "apply", label: { zh: "应用", en: "Apply" } },
  ])
  expect(withoutActionHelpKeys(stripped)).toBe(stripped)
  expect(withoutActionHelpKeys({ nodeId: "sample" })).not.toHaveProperty("actions")
})

test("the baseline file is read when present and empty when absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-help-baseline-"))
  const path = join(dir, "baseline.json")
  expect(await readMissingDictionaryBaseline(path)).toEqual([])
  await writeFile(path, JSON.stringify({ nodesWithoutDictionary: ["comfygure", 42, "findz"] }), "utf8")
  expect(await readMissingDictionaryBaseline(path)).toEqual(["comfygure", "findz"])
})

/** A dictionary with the shape the real nodes use: prose in the base fields and a `zh-CN` translation. */
const documented = (): NodeHelp => ({
  title: "Sample Node",
  short: "Base tagline.",
  description: "Base tagline.",
  whenToUse: ["Reach for this when the folder needs sorting."],
  workflows: [
    {
      title: "Workspace UI",
      summary: "Deploy and run from the node surface.",
      ui: ["Open the registry.", "Fill the fields."],
    },
    {
      title: "CLI",
      cli: ["Run `xiranite sample`.", "Add --help for flags."],
    },
  ],
  commands: [
    {
      title: "Node CLI",
      command: "xiranite sample",
      description: "Open the guided run.",
      examples: [
        { label: "Guided mode", command: "xiranite sample", description: "Ask for the missing answers." },
        { command: "xiranite sample --help", description: "Show the flags." },
      ],
    },
  ],
  safety: { defaultMode: "preview", notes: ["Nothing is written until you confirm."] },
  translations: {
    "zh-CN": {
      title: "示例节点",
      short: "基础说明。",
      description: "基础说明。",
      whenToUse: ["当目录需要整理时使用本节点。"],
      workflows: [
        { title: "工作区 UI", summary: "从节点面板部署并运行。", ui: ["打开模块库。", "填写字段。"] },
        { title: "CLI", cli: ["运行 `xiranite sample`。", "加 --help 查看参数。"] },
      ],
      commands: [
        {
          title: "节点 CLI",
          command: "xiranite sample",
          description: "打开引导式运行。",
          examples: [
            { label: "引导模式", command: "xiranite sample", description: "询问缺失的答案。" },
            { command: "xiranite sample --help", description: "展示参数。" },
          ],
        },
      ],
      safety: { defaultMode: "preview", notes: ["未确认前不会写入任何文件。"] },
    },
  },
})

test("the derived block pairs every line with its zh-CN translation, verbatim", () => {
  const { block, disclosures } = deriveHelpBlock(documented())
  expect(disclosures).toEqual([])
  expect(block).toEqual({
    whenToUse: { zh: ["当目录需要整理时使用本节点。"], en: ["Reach for this when the folder needs sorting."] },
    workflows: [
      {
        title: { zh: "工作区 UI", en: "Workspace UI" },
        summary: { zh: "从节点面板部署并运行。", en: "Deploy and run from the node surface." },
        ui: { zh: ["打开模块库。", "填写字段。"], en: ["Open the registry.", "Fill the fields."] },
      },
      {
        title: { zh: "CLI", en: "CLI" },
        cli: { zh: ["运行 `xiranite sample`。", "加 --help 查看参数。"], en: ["Run `xiranite sample`.", "Add --help for flags."] },
      },
    ],
    commands: [
      {
        title: { zh: "节点 CLI", en: "Node CLI" },
        command: "xiranite sample",
        description: { zh: "打开引导式运行。", en: "Open the guided run." },
        examples: [
          { label: { zh: "引导模式", en: "Guided mode" }, command: "xiranite sample", description: { zh: "询问缺失的答案。", en: "Ask for the missing answers." } },
          { command: "xiranite sample --help", description: { zh: "展示参数。", en: "Show the flags." } },
        ],
      },
    ],
    safety: {
      defaultMode: "preview",
      notes: { zh: ["未确认前不会写入任何文件。"], en: ["Nothing is written until you confirm."] },
    },
  })
})

test("a definition without the block is failed, so a face never falls back to invented help", () => {
  const report = checkNodeHelpText("sample", "node-definitions/sample.json", definition({ zh: "示例节点", en: "Sample Node" }, { zh: "基础说明。", en: "Base tagline." }), documented())
  expect(report.missingHelpBlock, "the dictionary publishes help, so the block is required").toBe(true)
  expect(report.helpDrift, "a missing block is not also reported as drift").toEqual([])
})

test("a reworded help line is reported at its own path, not as a whole-block mismatch", () => {
  const published = structuredClone(deriveHelpBlock(documented()).block) as Record<string, unknown>
  const workflows = published.workflows as Record<string, Record<string, unknown>>[]
  const ui = workflows[0].ui as { zh: string[]; en: string[] }
  ui.en[1] = "Fill the inputs."
  const drift = describeHelpDrift(published, deriveHelpBlock(documented()).block)
  expect(drift.length, "one reworded line").toBe(1)
  expect(drift[0]).toContain("help.workflows[0].ui.en[1]")
  expect(drift[0]).toContain("Fill the inputs.")
})

test("a help key the dictionary does not publish is a drift in the other direction", () => {
  const published = structuredClone(deriveHelpBlock(documented()).block) as Record<string, unknown>
  published.gotchas = { zh: ["自己加的"], en: ["invented"] }
  const drift = describeHelpDrift(published, deriveHelpBlock(documented()).block)
  expect(drift, "extra top-level key").toEqual(["help.gotchas is not published by the dictionary"])
})

test("a partial translation mirrors the English base and is disclosed rather than failed", () => {
  const halfTranslated = documented()
  // The node translated only the node-level text and the workflows, leaving commands and safety in English.
  halfTranslated.translations = { "zh-CN": { workflows: documented().translations?.["zh-CN"]?.workflows } }
  const { block, disclosures } = deriveHelpBlock(halfTranslated)
  const commands = block.commands as Record<string, { description?: { zh: string; en: string } }>[]
  expect(commands[0]?.description, "the untranslated side still quotes the authored English, in both slots").toEqual({
    zh: "Open the guided run.",
    en: "Open the guided run.",
  })
  const paths = disclosures.map((disclosure) => disclosure.path)
  expect(paths).toContain("help.whenToUse")
  expect(paths).toContain("help.commands[0]")
  expect(paths).toContain("help.safety")
  expect(paths, "a workflow the translation does carry is not reported").not.toContain("help.workflows[0]")
  expect(disclosures.every((disclosure) => disclosure.reason === "no Chinese side"), "only the mirror reason exists")
})

test("apply publishes the block and is a no-op on the second run", () => {
  const help = documented()
  const first = withHelpTextSourced(definition({ zh: "示例节点", en: "Sample Node" }, { zh: "基础说明。", en: "Base tagline." }), help)
  expect(first.help).toEqual(deriveHelpBlock(help).block)
  const second = withHelpTextSourced(first, help)
  expect(second).toEqual(first)
  expect(checkNodeHelpText("sample", "node-definitions/sample.json", second, help).helpDrift).toEqual([])
})

