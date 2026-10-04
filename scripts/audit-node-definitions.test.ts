import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, expect, test } from "bun:test"

import { assertNonEmptyScan, auditNodeDefinitions } from "./audit-node-definitions.ts"

let root = ""
let nodesRoot = ""
let pluginsRoot = ""
let draftsRoot = ""

const addNode = async (id: string): Promise<void> => {
  await mkdir(join(nodesRoot, id), { recursive: true })
}

const validDefinition = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  definitionVersion: 1,
  nodeId: id,
  title: { zh: "标题", en: "Title" },
  description: { zh: "说明", en: "Description" },
  actions: [{ id: "run", label: { zh: "运行", en: "Run" }, helpKey: "action.run" }],
  fields: [
    {
      id: "action",
      label: { zh: "命令", en: "Command" },
      kind: "select",
      isActionSelector: true,
      options: [{ value: { text: "run" }, label: { zh: "运行", en: "Run" } }],
      default: { text: "run" },
      visible: { type: "always" },
      rules: [{ rule: { type: "oneOfDeclaredOptions" } }, { rule: { type: "custom", exportName: "check_extra" } }],
    },
  ],
  groups: [],
  inputBindings: [{ fieldId: "action", slot: "action", transform: "trim", defaultExport: "default_action" }],
  danger: { type: "pluginExport", exportName: "is_risky" },
  reportsProgress: false,
  publishesOutputPath: false,
  ...extra,
})

const writeDefinition = async (where: string, id: string, definition: Record<string, unknown>): Promise<void> => {
  const dir = where === pluginsRoot ? join(pluginsRoot, id) : where
  await mkdir(dir, { recursive: true })
  const file = where === pluginsRoot ? join(dir, "definition.json") : join(dir, `${id}.json`)
  await writeFile(file, `${JSON.stringify(definition, null, 2)}\n`, "utf8")
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "xiranite-node-definitions-"))
  nodesRoot = join(root, "nodes")
  pluginsRoot = join(root, "plugins")
  draftsRoot = join(root, "drafts")
  await mkdir(nodesRoot, { recursive: true })
  await mkdir(pluginsRoot, { recursive: true })
  await mkdir(draftsRoot, { recursive: true })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

test("an empty node scan is refused instead of reporting zero coverage as progress", async () => {
  const empty = await auditNodeDefinitions({ nodesRoot: join(root, "does-not-exist"), pluginsRoot, draftsRoot })
  expect(empty.nodes).toEqual([])
  expect(() => assertNonEmptyScan(empty, join(root, "does-not-exist"))).toThrow("the scan path is wrong")
})

test("published, drafted and missing nodes are counted separately", async () => {
  await addNode("pubnode")
  await addNode("draftnode")
  await addNode("missingnode")
  await writeDefinition(pluginsRoot, "pubnode", validDefinition("pubnode"))
  await writeDefinition(draftsRoot, "draftnode", validDefinition("draftnode"))

  const report = await auditNodeDefinitions({ nodesRoot, pluginsRoot, draftsRoot })
  expect(report.published).toBe(1)
  expect(report.drafted).toBe(1)
  expect(report.missing).toBe(1)
  expect(report.invalidPublished).toBe(0)
  expect(report.entries.find((entry) => entry.nodeId === "missingnode")?.source).toBe("missing")
})

test("the backlog counts are the plugin exports the faces will have to call", async () => {
  const report = await auditNodeDefinitions({ nodesRoot, pluginsRoot, draftsRoot })
  const published = report.entries.find((entry) => entry.nodeId === "pubnode")
  expect(published?.customRules).toEqual(["check_extra"])
  // defaultExport plus the gate's exportName, de-duplicated: two names, one per mechanism.
  expect(published?.pluginExports).toEqual(["default_action", "is_risky"])
  expect(report.customRuleCount).toBeGreaterThanOrEqual(1)
  expect(report.pluginExportCount).toBeGreaterThanOrEqual(2)
})

test("a published definition that no longer validates is the failing case", async () => {
  const broken = validDefinition("pubnode", { definitionVersion: 99 })
  ;(broken.fields as Record<string, unknown>[])[0].label = { zh: "", en: "Command" }
  await writeDefinition(pluginsRoot, "pubnode", broken)

  const report = await auditNodeDefinitions({ nodesRoot, pluginsRoot, draftsRoot })
  expect(report.invalidPublished).toBe(1)
  const entry = report.entries.find((candidate) => candidate.nodeId === "pubnode")
  expect(entry?.problems.some((problem) => problem.includes("definitionVersion must be 1"))).toBe(true)
  expect(entry?.problems.some((problem) => problem.includes("label.zh is blank"))).toBe(true)
})

test("a draft that does not validate is reported but never blocks the published set", async () => {
  await writeDefinition(draftsRoot, "draftnode", { definitionVersion: 1, nodeId: "draftnode" })
  const report = await auditNodeDefinitions({ nodesRoot, pluginsRoot, draftsRoot })
  const draft = report.entries.find((entry) => entry.nodeId === "draftnode")
  expect(draft?.problems.length).toBeGreaterThan(0)
  expect(report.invalidPublished).toBe(1, "only the earlier published break counts as a failure")
})
