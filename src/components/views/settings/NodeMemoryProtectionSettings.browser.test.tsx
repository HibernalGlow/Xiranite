import { describe, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import type { NodeMemoryProtectionSettingsDTO } from "@xiranite/shared"

import i18n from "@/i18n"
import { NodeMemoryProtectionSettings } from "./NodeMemoryProtectionSettings"

describe("NodeMemoryProtectionSettings browser behavior", () => {
  test("edits and hot-applies the XLchemy memory override", async () => {
    await i18n.changeLanguage("en")
    const initial: NodeMemoryProtectionSettingsDTO = {
      defaultPolicy: {
        maxRssGrowthMiB: 8_192,
        maxHeapGrowthMiB: 4_096,
        maxRetainedEvents: 1_000,
        sampleIntervalMs: 250,
      },
      nodePolicies: {
        xlchemy: {
          maxRssGrowthMiB: 16_384,
          maxHeapGrowthMiB: 2_048,
          maxRetainedEvents: 256,
          sampleIntervalMs: 100,
        },
      },
    }
    const loadSettings = vi.fn(async () => ({ supported: true, settings: initial }))
    const saveSettings = vi.fn(async (settings: NodeMemoryProtectionSettingsDTO) => ({ supported: true, settings }))
    const screen = await render(
      <div className="@container/settings max-w-4xl p-4">
        <NodeMemoryProtectionSettings
          available
          loadSettings={loadSettings}
          saveSettings={saveSettings}
        />
      </div>,
    )

    await expect.element(screen.getByRole("heading", { name: "Node memory protection" })).toBeVisible()
    const xlchemyRss = screen.getByRole("spinbutton", { name: /XLchemy limits.*RSS growth limit/ })
    await expect.element(xlchemyRss).toHaveValue(16_384)
    await xlchemyRss.fill("3072")

    const apply = screen.getByRole("button", { name: "Apply settings" })
    await expect.element(apply).toBeEnabled()
    await apply.click()

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      defaultPolicy: initial.defaultPolicy,
      nodePolicies: expect.objectContaining({
        xlchemy: expect.objectContaining({ maxRssGrowthMiB: 3_072 }),
      }),
    }))
    await expect.element(screen.getByText("Applied")).toBeVisible()
    await expect.element(apply).toBeDisabled()
  })
})
