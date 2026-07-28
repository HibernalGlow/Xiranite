import { expect, test } from "vitest"
import { applyMarkuModule, isMarkuModuleId } from "./core.js"
import type { MarkuWorkflow } from "./workflow.js"
import {
  evaluateMarkuWorkflowSource,
  normalizeMarkuWorkflow,
  normalizeMarkuWorkflowLibrary,
  validateMarkuWorkflowForRun,
} from "./workflow.js"

const realTransform = (module: string, text: string, config: Record<string, unknown>) => {
  if (!isMarkuModuleId(module)) throw new Error(`Unknown module: ${module}`)
  return applyMarkuModule(module, text, config)
}

test("normalizes a saved workflow with trimmed name and unique stable ids", () => {
  const workflow = normalizeMarkuWorkflow({
    id: " wf-1 ",
    name: "  清理管线  ",
    steps: [
      { id: "s1", module: "markt", config: { mode: "h2l" } },
      { id: "s1", module: "content_dedup", config: {} },
      { module: "title_convert" },
      { id: "bad", module: "" },
      "not a step",
    ],
  })

  expect(workflow).not.toBeNull()
  expect(workflow?.id).toBe("wf-1")
  expect(workflow?.name).toBe("清理管线")
  expect(workflow?.steps).toHaveLength(3)
  expect(workflow?.steps[0]).toEqual({ id: "s1", module: "markt", config: { mode: "h2l" } })
  expect(workflow?.steps[1]?.id).not.toBe("s1")
  expect(workflow?.steps[2]?.module).toBe("title_convert")
  const ids = new Set(workflow?.steps.map((step) => step.id))
  expect(ids.size).toBe(3)
})

test("normalization deep-clones configuration snapshots", () => {
  const config = { patterns: [{ from: "a", to: "b" }] }
  const workflow = normalizeMarkuWorkflow({ id: "wf", name: "x", steps: [{ id: "s", module: "content_replace", config }] })

  config.patterns[0]!.to = "mutated"
  config.patterns.push({ from: "c", to: "d" })

  expect(workflow?.steps[0]?.config).toEqual({ patterns: [{ from: "a", to: "b" }] })
})

test("rejects non-workflow values and keeps unknown modules for run-time validation", () => {
  expect(normalizeMarkuWorkflow(null)).toBeNull()
  expect(normalizeMarkuWorkflow("text")).toBeNull()
  expect(normalizeMarkuWorkflow({ id: "wf", name: "x" })).toBeNull()

  const workflow = normalizeMarkuWorkflow({ id: "wf", name: "x", steps: [{ id: "s", module: "ghost_module" }] })
  expect(workflow?.steps[0]?.module).toBe("ghost_module")
  expect(validateMarkuWorkflowForRun(workflow!, isMarkuModuleId)).toContain("unknown module: ghost_module")
})

test("rejects an empty workflow at execution", () => {
  const workflow = normalizeMarkuWorkflow({ id: "wf", name: "empty", steps: [] })
  expect(workflow?.steps).toEqual([])
  expect(validateMarkuWorkflowForRun(workflow!, isMarkuModuleId)).toContain("no steps")
})

test("normalizes a library, discarding malformed workflows and duplicate ids", () => {
  const library = normalizeMarkuWorkflowLibrary({
    schemaVersion: 1,
    futureField: { ignored: true },
    workflows: [
      { id: "a", name: "one", steps: [{ id: "s", module: "markt", config: {} }] },
      { id: "a", name: "dup-id", steps: [] },
      { name: "no steps array" },
      42,
    ],
  })

  expect(library.schemaVersion).toBe(1)
  expect(library.workflows).toHaveLength(2)
  expect(library.workflows[0]?.id).toBe("a")
  expect(library.workflows[1]?.id).not.toBe("a")
  expect(normalizeMarkuWorkflowLibrary(undefined)).toEqual({ schemaVersion: 1, workflows: [] })
})

test("evaluates steps sequentially, feeding each step the previous output", () => {
  const workflow: MarkuWorkflow = {
    id: "wf",
    name: "seq",
    steps: [
      { id: "s1", module: "content_replace", config: { patterns: [{ from: "alpha", to: "beta" }] } },
      { id: "s2", module: "content_replace", config: { patterns: [{ from: "beta", to: "gamma" }] } },
    ],
  }

  const result = evaluateMarkuWorkflowSource(workflow, { sourceId: "input.md", sourceLabel: "input.md", text: "alpha\n" }, realTransform)

  expect(result.error).toBeUndefined()
  expect(result.originalText).toBe("alpha\n")
  expect(result.steps[0]).toMatchObject({ stepId: "s1", inputText: "alpha\n", outputText: "beta\n", changed: true })
  expect(result.steps[1]).toMatchObject({ stepId: "s2", inputText: "beta\n", outputText: "gamma\n", changed: true })
  expect(result.outputText).toBe("gamma\n")
})

test("stops at the first failing step and retains prior step results", () => {
  const workflow: MarkuWorkflow = {
    id: "wf",
    name: "fail",
    steps: [
      { id: "s1", module: "content_replace", config: { patterns: [{ from: "a", to: "b" }] } },
      { id: "s2", module: "boom", config: {} },
      { id: "s3", module: "markt", config: {} },
    ],
  }

  const result = evaluateMarkuWorkflowSource(workflow, { sourceId: "x", sourceLabel: "x.md", text: "a" }, realTransform)

  expect(result.error).toContain("Step 2 (boom) failed")
  expect(result.steps).toHaveLength(2)
  expect(result.steps[0]?.outputText).toBe("b")
  expect(result.steps[1]?.error).toContain("Unknown module: boom")
  expect(result.outputText).toBe("b")
})
