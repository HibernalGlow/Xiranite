import { describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../../adapters/reader-http-client"
import { LEGACY_SIDEBAR_HEIGHT_KEY, migrateLegacySidebarHeight } from "./LegacySidebarHeightMigration"

describe("migrateLegacySidebarHeight", () => {
  it("[neoview.sidebar-height.legacy-import] imports bounded legacy geometry and removes the old key after persistence", async () => {
    const values = new Map([[LEGACY_SIDEBAR_HEIGHT_KEY, JSON.stringify({
      leftSidebarWidth: 410,
      leftSidebarHeight: "2/3",
      leftSidebarCustomHeight: 68,
      leftSidebarVerticalAlign: 30,
      leftSidebarHorizontalPos: 15,
      rightSidebarWidth: 270,
      rightSidebarHeight: "custom",
      rightSidebarCustomHeight: 55,
      rightSidebarVerticalAlign: 70,
      rightSidebarHorizontalPos: 20,
      showDragHandle: true,
      enableBlankAreaCollapse: false,
      blankAreaCollapseMode: "double",
    })]])
    const persist = vi.fn(async () => undefined)
    const result = await migrateLegacySidebarHeight({
      storage: { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) },
      canonical: shell(),
      persist,
    })

    expect(result).toBe("imported")
    expect(persist).toHaveBeenCalledWith({
      left: { side: "left", width: 410, height: "two-thirds", customHeight: 68, verticalAlign: 30, horizontalPosition: 15 },
      right: { side: "right", width: 270, height: "custom", customHeight: 55, verticalAlign: 70, horizontalPosition: 20 },
      interaction: { showDragHandle: true, enableBlankAreaCollapse: false, blankAreaCollapseMode: "double" },
    })
    expect(values.has(LEGACY_SIDEBAR_HEIGHT_KEY)).toBe(false)
  })

  it("[neoview.sidebar-height.canonical-precedence] keeps non-default TOML and discards stale legacy storage", async () => {
    const values = new Map([[LEGACY_SIDEBAR_HEIGHT_KEY, "{}"]])
    const canonical = shell()
    canonical.sidebars.left.customHeight = 72
    canonical.sidebars.left.height = "custom"
    const persist = vi.fn()
    expect(await migrateLegacySidebarHeight({
      storage: { getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) },
      canonical,
      persist,
    })).toBe("canonical-won")
    expect(persist).not.toHaveBeenCalled()
    expect(values.has(LEGACY_SIDEBAR_HEIGHT_KEY)).toBe(false)
  })
})

function shell(): ReaderShellConfigDto {
  return {
    revision: 0,
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: true, pinned: true, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    sidebarInteraction: { showDragHandle: false, enableBlankAreaCollapse: true, blankAreaCollapseMode: "single" },
    panelLayout: {},
    cardLayout: {},
  }
}
