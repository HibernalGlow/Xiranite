import type { ReaderShellConfigDto, ReaderSidebarLayoutPatch } from "../../../adapters/reader-http-client"

export const LEGACY_SIDEBAR_HEIGHT_KEY = "neoview-sidebar-config"

export interface LegacySidebarHeightImport {
  left: ReaderSidebarLayoutPatch
  right: ReaderSidebarLayoutPatch
  interaction: NonNullable<ReaderShellConfigDto["sidebarInteraction"]>
}

export async function migrateLegacySidebarHeight(options: {
  storage: Pick<Storage, "getItem" | "removeItem">
  canonical: ReaderShellConfigDto
  persist(value: LegacySidebarHeightImport): Promise<void>
}): Promise<"absent" | "canonical-won" | "imported" | "invalid"> {
  const raw = options.storage.getItem(LEGACY_SIDEBAR_HEIGHT_KEY)
  if (raw === null) return "absent"
  if (!isCanonicalDefault(options.canonical)) {
    options.storage.removeItem(LEGACY_SIDEBAR_HEIGHT_KEY)
    return "canonical-won"
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return "invalid"
  }
  if (!isRecord(value)) return "invalid"
  const imported = decodeLegacySidebarHeight(value)
  if (!imported) return "invalid"
  await options.persist(imported)
  options.storage.removeItem(LEGACY_SIDEBAR_HEIGHT_KEY)
  return "imported"
}

function decodeLegacySidebarHeight(value: Record<string, unknown>): LegacySidebarHeightImport | undefined {
  const leftHeight = height(value.leftSidebarHeight)
  const rightHeight = height(value.rightSidebarHeight)
  const mode = value.blankAreaCollapseMode ?? "single"
  if (!leftHeight || !rightHeight || (mode !== "single" && mode !== "double")) return undefined
  return {
    left: {
      side: "left",
      width: bounded(value.leftSidebarWidth, 200, 600, 320),
      height: leftHeight,
      customHeight: bounded(value.leftSidebarCustomHeight, 10, 100, 100),
      verticalAlign: bounded(value.leftSidebarVerticalAlign, 0, 100, 0),
      horizontalPosition: bounded(value.leftSidebarHorizontalPos, 0, 100, 0),
    },
    right: {
      side: "right",
      width: bounded(value.rightSidebarWidth, 200, 600, 280),
      height: rightHeight,
      customHeight: bounded(value.rightSidebarCustomHeight, 10, 100, 100),
      verticalAlign: bounded(value.rightSidebarVerticalAlign, 0, 100, 0),
      horizontalPosition: bounded(value.rightSidebarHorizontalPos, 0, 100, 0),
    },
    interaction: {
      showDragHandle: boolean(value.showDragHandle, false),
      enableBlankAreaCollapse: boolean(value.enableBlankAreaCollapse, true),
      blankAreaCollapseMode: mode,
    },
  }
}

function isCanonicalDefault(shell: ReaderShellConfigDto): boolean {
  const interaction = shell.sidebarInteraction
  return sameSidebar(shell.sidebars.left, 320)
    && sameSidebar(shell.sidebars.right, 280)
    && (!interaction || (!interaction.showDragHandle && interaction.enableBlankAreaCollapse && interaction.blankAreaCollapseMode === "single"))
}

function sameSidebar(value: ReaderShellConfigDto["sidebars"]["left"], width: number): boolean {
  return value.width === width && value.height === "full" && value.customHeight === 100
    && value.verticalAlign === 0 && value.horizontalPosition === 0
}

function height(value: unknown): ReaderSidebarLayoutPatch["height"] | undefined {
  if (value === undefined || value === "full") return "full"
  if (value === "2/3" || value === "two-thirds") return "two-thirds"
  if (value === "half") return "half"
  if (value === "1/3" || value === "one-third") return "one-third"
  if (value === "custom") return "custom"
  return undefined
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
