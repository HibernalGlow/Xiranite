import { describe, expect, test } from "bun:test"
import { findNodeCli, formatHelp, formatNodeList, NODE_CLI_REGISTRY, normalizeNodeId } from "./index"

describe("@xiranite/cli registry", () => {
  test("registers every migrated aestivus node", () => {
    expect(NODE_CLI_REGISTRY).toHaveLength(26)
    expect(NODE_CLI_REGISTRY.map((entry) => entry.id)).toContain("cleanf")
    expect(NODE_CLI_REGISTRY.map((entry) => entry.id)).toContain("weibospider")
  })

  test("normalizes direct bin names to node ids", () => {
    expect(normalizeNodeId("xiranite-cleanf")).toBe("cleanf")
    expect(normalizeNodeId("CleanF")).toBe("cleanf")
  })

  test("finds nodes by id or package-local bin name", () => {
    expect(findNodeCli("linedup")?.packageName).toBe("@xiranite/node-linedup")
    expect(findNodeCli("xiranite-linedup")?.id).toBe("linedup")
    expect(findNodeCli("missing")).toBeUndefined()
  })

  test("formats useful command discovery output", () => {
    expect(formatHelp()).toContain("xiranite <node> [args]")
    expect(formatNodeList()).toContain("xiranite-cleanf")
  })
})
