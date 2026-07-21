import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../../../../../..")
const prototypeRoot = resolve(root, "migration/neoview/frontend/image-settings-prototype/tsx-scaffold")

describe("MediaSettingsCard migration prototype", () => {
  it("freezes the legacy Image settings wrapper and panel before production changes", async () => {
    const manifest = JSON.parse(await readFile(resolve(prototypeRoot, "manifest.json"), "utf8")) as {
      scaffolds: Array<{ sourceFile: string; outputFile: string; unsupported: string[] }>
    }
    expect(manifest.scaffolds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceFile: "src/lib/cards/settings/ImageSettingsCard.svelte",
        outputFile: "src/lib/cards/settings/ImageSettingsCard.tsx",
        unsupported: [],
      }),
      expect.objectContaining({
        sourceFile: "src/lib/components/panels/ImageSettingsPanel.svelte",
        outputFile: "src/lib/components/panels/ImageSettingsPanel.tsx",
        unsupported: ["attribute BindDirective"],
      }),
    ]))

    const wrapper = await readFile(resolve(prototypeRoot, "src/lib/cards/settings/ImageSettingsCard.tsx"), "utf8")
    const panel = await readFile(resolve(prototypeRoot, "src/lib/components/panels/ImageSettingsPanel.tsx"), "utf8")
    const production = await readFile(resolve(root, "src/nodes/neoview/features/settings/cards/MediaSettingsCard.tsx"), "utf8")
    expect(wrapper).toContain('<div className="settings-card-wrapper space-y-4">')
    expect(wrapper).toContain("<ImageSettingsPanel>")
    expect(panel).toContain("<Tabs.Root")
    expect(panel).toContain("autoPlayAnimatedImages")
    expect(panel).toContain("nativeJxl")
    expect(panel).toContain("videoPlaybackRateStep")
    expect(production).not.toContain("migration/neoview/frontend")
    expect(production).not.toContain("$lib/")
  })
})
