import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RULE_TREE_FORMAT, type RuleTree } from "@xiranite/shared/rules"
import { RuleTreeEditor, queryBuilderToRuleTree, ruleTreeToQueryBuilder, type RuleTreeField } from "./RuleTreeEditor"

const fields: RuleTreeField[] = [
  { name: "batch.text", label: "Batch text", type: "text" },
  { name: "image.width", label: "Width", type: "number" },
]

const tree: RuleTree = {
  format: RULE_TREE_FORMAT,
  version: 1,
  root: {
    id: "root",
    kind: "group",
    combinator: "all",
    not: false,
    children: [{ id: "prompt", kind: "condition", field: "batch.text", operator: "contains", value: "uniform" }],
  },
}

afterEach(cleanup)

describe("RuleTreeEditor", () => {
  it("round-trips the stable RuleTree instead of persisting query-builder state", () => {
    expect(queryBuilderToRuleTree(ruleTreeToQueryBuilder(tree), fields)).toEqual(tree)
  })

  it("renders semantic theme classes and mature query-builder controls", () => {
    const { container } = render(<RuleTreeEditor value={tree} fields={fields} onValueChange={() => {}} />)
    expect(screen.getByTestId("rule-tree-editor").getAttribute("data-theme-surface")).toBe("semantic")
    expect(container.querySelector(".ruleGroup")?.classList.contains("bg-muted/20")).toBe(true)
    expect(container.querySelector(".rule-fields")?.classList.contains("bg-background")).toBe(true)
    expect(screen.getByTitle("Drag to reorder")).toBeTruthy()
  })

  it("emits the shared protocol when a condition is added", () => {
    const onValueChange = vi.fn()
    render(<RuleTreeEditor value={tree} fields={fields} onValueChange={onValueChange} />)
    fireEvent.click(screen.getByTitle("Add condition"))
    expect(onValueChange).toHaveBeenCalledWith(expect.objectContaining({ format: RULE_TREE_FORMAT, version: 1 }))
    expect(onValueChange.mock.calls.at(-1)?.[0].root.children).toHaveLength(2)
  })
})
