import { describe, expect, it } from "vitest"

import { readerShellMaterialStyle, READER_SHELL_MATERIAL_PRESETS } from "./ReaderShellMaterial"

describe("ReaderShellMaterial", () => {
  it("[neoview.material.rendering] maps saturation, highlight and shadow into one bounded surface style", () => {
    const style = readerShellMaterialStyle({
      ...READER_SHELL_MATERIAL_PRESETS.frosted,
      saturation: { top: 132, bottom: 118, sidebar: 144 },
      highlight: { top: 50, bottom: 34, sidebar: 42 },
      shadow: { top: 60, bottom: 47, sidebar: 56 },
    }, "top")

    expect(style.backdropFilter).toBe("blur(16px) saturate(132%)")
    expect(style.borderColor).toContain("50%")
    expect(style.boxShadow).toContain("0.200")
    expect(style.boxShadow).toContain("0.300")
  })

  it("disables backdrop filtering for the solid preset", () => {
    expect(readerShellMaterialStyle(READER_SHELL_MATERIAL_PRESETS.solid, "sidebar").backdropFilter).toBe("none")
  })
})
