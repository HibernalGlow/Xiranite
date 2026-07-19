import { describe, expect, it } from "bun:test"

import {
  aggregateCapabilityStatuses,
  blockedDimensions,
  capabilityStatusSchema,
  compactCapabilityStatus,
  detailedChecklistSchema,
  deriveOverallStatus,
  featureMatrixSchema,
  seedDetailedCapabilityStatus,
  type CapabilityStatus,
  type TestEvidenceIndex,
} from "./neoview-capability-status"

const complete: CapabilityStatus = {
  core: "complete",
  transport: "complete",
  gui: "complete",
  cli: "complete",
  tui: "complete",
  evidence: "complete",
}

const evidence: TestEvidenceIndex = {
  pathsById: new Map(),
  has: () => true,
  paths: (id) => id === "gui-e2e" ? ["tests/e2e/neoview/reader.spec.ts"] : [],
  dimensions(ids) {
    const dimensions = new Set<"core" | "transport" | "gui" | "cli" | "tui" | "evidence">()
    for (const id of ids) {
      if (id === "core") dimensions.add("core")
      if (id === "http") dimensions.add("transport")
      if (id === "gui-e2e") dimensions.add("gui")
      if (id === "cli") dimensions.add("cli")
      if (id === "tui") dimensions.add("tui")
    }
    return dimensions
  },
}

describe("NeoView capability status", () => {
  it("[neoview.compatibility.capability-schema] requires exactly six dimensions", () => {
    expect(capabilityStatusSchema.parse(complete)).toEqual(complete)
    expect(() => capabilityStatusSchema.parse({ ...complete, gui: undefined })).toThrow()
    expect(() => capabilityStatusSchema.parse({ ...complete, docs: "complete" })).toThrow()
    expect(() => capabilityStatusSchema.parse({ ...complete, cli: "done" })).toThrow()
  })

  it("[neoview.compatibility.capability-aggregate] derives conservative overall status and ignores not-applicable", () => {
    expect(deriveOverallStatus(complete)).toBe("complete")
    expect(deriveOverallStatus({ ...complete, cli: "not-applicable", tui: "not-applicable" })).toBe("complete")
    expect(deriveOverallStatus({ ...complete, gui: "partial" })).toBe("partial")
    expect(deriveOverallStatus({
      core: "pending", transport: "not-applicable", gui: "pending", cli: "not-applicable", tui: "not-applicable", evidence: "pending",
    })).toBe("pending")
    expect(blockedDimensions({ ...complete, gui: "partial", tui: "pending", cli: "not-applicable" })).toEqual(["gui", "tui"])
  })

  it("[neoview.compatibility.capability-rollup] aggregates each dimension without promoting mixed child states", () => {
    expect(aggregateCapabilityStatuses([
      complete,
      { ...complete, gui: "partial", cli: "not-applicable" },
    ])).toEqual({ ...complete, gui: "partial" })
    expect(aggregateCapabilityStatuses([
      { ...complete, tui: "not-applicable" },
      { ...complete, tui: "not-applicable" },
    ]).tui).toBe("not-applicable")
  })

  it("[neoview.compatibility.capability-migration] seeds dimensions from surfaces and tracked evidence without over-promoting partial work", () => {
    const partial = seedDetailedCapabilityStatus("partial", ["GUI", "CLI", "TUI"], ["core", "http", "gui-e2e", "cli", "tui"], evidence)
    expect(partial).toEqual({
      core: "complete",
      transport: "complete",
      gui: "complete",
      cli: "complete",
      tui: "complete",
      evidence: "partial",
    })
    expect(deriveOverallStatus(partial)).toBe("partial")

    expect(seedDetailedCapabilityStatus("complete", ["GUI", "CLI", "TUI"], ["core", "http", "gui-e2e", "cli", "tui"], evidence)).toEqual(complete)
    expect(seedDetailedCapabilityStatus("complete", ["GUI", "CLI"], ["core", "cli"], evidence)).toEqual({
      core: "complete",
      transport: "not-applicable",
      gui: "partial",
      cli: "complete",
      tui: "not-applicable",
      evidence: "partial",
    })

    expect(seedDetailedCapabilityStatus("pending", ["GUI"], [], evidence)).toEqual({
      core: "not-applicable",
      transport: "not-applicable",
      gui: "pending",
      cli: "not-applicable",
      tui: "not-applicable",
      evidence: "pending",
    })
  })

  it("[neoview.compatibility.capability-schema-v2] rejects persisted legacy scalar status fields", () => {
    const feature = {
      id: "demo",
      title: "Demo",
      legacySourcePatterns: ["demo"],
      legacyCommandPatterns: [],
      settingsKeys: [],
      dataStores: [],
      surfaces: ["gui"],
      disposition: "migrate",
      capabilityStatus: { ...complete, cli: "not-applicable", tui: "not-applicable" },
      behaviorCases: ["demo"],
      testIds: ["demo.gui"],
      plannedTestIds: ["demo.e2e"],
      benchmarkIds: [],
      knownDifferences: [],
    }
    expect(featureMatrixSchema.parse({ schemaVersion: 2, sourceRevision: "revision", features: [feature] }).features[0]?.plannedTestIds)
      .toEqual(["demo.e2e"])
    expect(() => featureMatrixSchema.parse({
      schemaVersion: 2,
      sourceRevision: "revision",
      features: [{ ...feature, status: "partial" }],
    })).toThrow()
  })

  it("[neoview.compatibility.detailed-checklist-schema] accepts frozen prototype and visual evidence while preserving strict item validation", () => {
    const status = { ...complete, cli: "not-applicable", tui: "not-applicable" }
    const checklist = {
      schemaVersion: 2,
      featureId: "demo-card",
      legacyCardId: "demoCard",
      sourceRoot: "legacy/neoview",
      sourceRevision: "revision",
      sourceHash: "sha256:source",
      storeHash: "sha256:store",
      utilityHash: "sha256:utility",
      astPrototype: "migration/neoview/demo.tsx",
      visualBaseline: "output/legacy.png",
      visualTarget: "output/current.png",
      inventorySummary: { sourceUiGroups: 1, controlsAndStates: 2, acceptanceItems: 3, sourceFiles: 4 },
      unsupportedNodes: [{ node: "rune", source: "$state", replacement: "React state" }],
      completionRule: "Preserve the demonstrated contract.",
      sourceUiInventory: [{
        id: "demo-ui",
        title: "Demo UI",
        sourceEvidence: ["src/lib/DemoCard.svelte"],
        acceptanceItems: ["Visible field"],
        mappedChecklistIds: ["demo.item"],
      }],
      items: [{
        id: "demo.item",
        category: "capabilities",
        title: "Demo item",
        sourceEvidence: ["src/lib/DemoCard.svelte"],
        targetContract: "Render one visible field.",
        surfaces: ["GUI"],
        capabilityStatus: status,
        testIds: ["neoview.demo.item"],
        plannedTestIds: [],
        notes: "Covered by a fixture.",
      }],
    }
    expect(detailedChecklistSchema.parse(checklist)).toMatchObject({ astPrototype: checklist.astPrototype, visualTarget: checklist.visualTarget })
    expect(() => detailedChecklistSchema.parse({ ...checklist, unsupportedNodes: [{ ...checklist.unsupportedNodes[0], unknown: true }] })).toThrow()
  })

  it("[neoview.compatibility.capability-render] renders stable compact summaries", () => {
    expect(compactCapabilityStatus({ ...complete, gui: "partial", tui: "not-applicable" }))
      .toBe("core=C transport=C gui=P cli=C tui=N/A evidence=C")
  })
})
