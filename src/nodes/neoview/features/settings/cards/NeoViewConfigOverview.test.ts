import { describe, expect, test } from "vitest"
import { buildOverview } from "./NeoViewConfigOverview"
import { summarizeConfig } from "@/nodes/shared/NodeConfigSourceView"

describe("NeoViewConfigOverview", () => {
  test("visualizes the config envelope by NeoView domain without treating the envelope as a section", () => {
    const overview = buildOverview({
      config: {
        view_defaults: { fit_mode: "fit-width", dual_page: true },
        shell: { accent: "#22c55e", panel_layout: { left: "folder" } },
        input_bindings: { bindings: [{ key: "ArrowRight", action: "next" }] },
        emm: { enabled: true, database_paths: ["D:/NeoView/thumbnails.db"] },
      },
    })

    expect(overview.sections.map((section) => section.key)).toEqual(["view_defaults", "shell", "input_bindings", "emm"])
    expect(overview.categories.map((category) => category.id)).toEqual(["reading", "layout", "input", "data"])
    expect(overview.leafCount).toBeGreaterThanOrEqual(7)
    expect(overview.collectionItems).toBe(2)
  })

  test("extracts visual summaries for generic node TOML views", () => {
    const summary = summarizeConfig({
      enabled: true,
      dry_run: false,
      accent: "#22c55e",
      roots: ["D:/A", "D:/B"],
    })

    expect(summary).toMatchObject({ sections: 4, booleans: 2, enabled: 1, collectionItems: 2 })
    expect(summary.colors).toEqual(["#22c55e"])
  })
})
