import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import type { NodeHelp } from "../packages/contract/src/index.ts"

import {
  acceptedHelpText,
  checkNodeHelpText,
  readMissingDictionaryBaseline,
  withHelpTextSourced,
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

test("the baseline file is read when present and empty when absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-help-baseline-"))
  const path = join(dir, "baseline.json")
  expect(await readMissingDictionaryBaseline(path)).toEqual([])
  await writeFile(path, JSON.stringify({ nodesWithoutDictionary: ["comfygure", 42, "findz"] }), "utf8")
  expect(await readMissingDictionaryBaseline(path)).toEqual(["comfygure", "findz"])
})
