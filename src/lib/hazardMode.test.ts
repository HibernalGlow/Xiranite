import { describe, expect, test, vi } from "vitest"
import { countHazardAffectedNodes, disableAllNodeDryRuns } from "./hazardMode"
import type { ComponentInstance } from "@/types/workspace"

const component = (moduleId: string, data: Record<string, unknown> = {}): ComponentInstance => ({
  id: `component-${moduleId}`,
  moduleId,
  state: "docked",
  workspaceId: "workspace",
  data,
})

describe("hazard mode", () => {
  test("turns off each supported preflight mode without touching unrelated nodes", () => {
    const components = [
      component("classq"),
      component("cleanf"),
      component("dissolvef"),
      component("transq", { preview: true }),
      component("bitv"),
      component("nameu", { dryRun: false }),
      component("transq", { preview: false }),
      component("recycleu", { interval: 30 }),
    ]
    const patchComponentData = vi.fn()

    expect(countHazardAffectedNodes(components)).toBe(5)
    expect(disableAllNodeDryRuns(components, patchComponentData)).toBe(5)
    expect(patchComponentData).toHaveBeenCalledWith("component-classq", { dryRun: false })
    expect(patchComponentData).toHaveBeenCalledWith("component-cleanf", { previewMode: false })
    expect(patchComponentData).toHaveBeenCalledWith("component-dissolvef", { preview: false })
    expect(patchComponentData).toHaveBeenCalledWith("component-transq", { preview: false })
    expect(patchComponentData).toHaveBeenCalledWith("component-bitv", { dryRun: false })
    expect(patchComponentData).toHaveBeenCalledTimes(5)
  })
})
