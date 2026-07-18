import {
  READER_INPUT_ACTIONS,
  readerInputActionFromLegacyId,
  type ReaderInputAction,
} from "../domain/input/ReaderInputBindings.js"
import type {
  ReaderRadialMenuConfig,
  ReaderRadialMenuDefinition,
  ReaderRadialMenuItem,
  ReaderRadialMenuVariant,
} from "../application/config/ReaderRadialMenuConfig.js"

export interface LegacyRadialMenuReportEntry {
  sourcePath: string
  status: "converted" | "skipped" | "invalid"
  message: string
}

export interface DecodedLegacyRadialMenu {
  config?: ReaderRadialMenuConfig
  report: LegacyRadialMenuReportEntry[]
}

interface ConversionState {
  report: LegacyRadialMenuReportEntry[]
  itemIds: Set<string>
  menuIds: Map<string, string>
}

export class LegacyRadialMenuCodec {
  decode(value: unknown, sourcePath = "radialMenus"): DecodedLegacyRadialMenu {
    if (!isRecord(value)) {
      return { report: [{ sourcePath, status: "invalid", message: "Expected a radial menu object." }] }
    }

    const report: LegacyRadialMenuReportEntry[] = []
    const rawMenus = Array.isArray(value.menus) && value.menus.length ? value.menus : [value]
    const menuSources = rawMenus.slice(0, 16)
    if (rawMenus.length > 16) report.push({ sourcePath: `${sourcePath}.menus`, status: "skipped", message: "Only the first 16 menus can be imported." })

    const menuIds = new Map<string, string>()
    const usedMenuIds = new Set<string>()
    for (const [index, candidate] of menuSources.entries()) {
      const rawId = isRecord(candidate) ? candidate.id : undefined
      const id = uniqueIdentifier(rawId, index === 0 ? "default" : `legacy-menu-${index + 1}`, usedMenuIds)
      if (typeof rawId === "string") menuIds.set(rawId, id)
      if (rawId !== id) report.push({ sourcePath: `${sourcePath}.menus[${index}].id`, status: "converted", message: `Normalized menu ID to ${id}.` })
    }

    const state: ConversionState = { report, itemIds: new Set(), menuIds }
    const layerCount = oneOf(value.layerCount, [1, 2, 3] as const, 3)
    const menus = menuSources.map((candidate, index) => convertMenu(candidate, index, layerCount, sourcePath, state, [...usedMenuIds][index]!))
    if (!menus.length) return { report: [{ sourcePath, status: "invalid", message: "No importable radial menus were found." }] }

    const rawActiveMenuId = typeof value.activeMenuId === "string" ? value.activeMenuId : undefined
    const activeMenuId = rawActiveMenuId ? menuIds.get(rawActiveMenuId) ?? menus[0]!.id : menus[0]!.id
    if (rawActiveMenuId && !menuIds.has(rawActiveMenuId)) {
      report.push({ sourcePath: `${sourcePath}.activeMenuId`, status: "skipped", message: "Unknown active menu; selected the first imported menu." })
    }

    for (const [menuIndex, menu] of menus.entries()) {
      for (const [layerIndex, layer] of menu.layers.entries()) {
        for (const item of layer) normalizeMoveTargets(item, menu.id, `${sourcePath}.menus[${menuIndex}].layers[${layerIndex}]`, state)
      }
    }

    const radius = boundedInteger(value.radius, 60, 300, 120, `${sourcePath}.radius`, report)
    const innerRadius = boundedInteger(value.innerRadius, 0, Math.min(100, radius - 1), 40, `${sourcePath}.innerRadius`, report)
    const config: ReaderRadialMenuConfig = {
      enabled: typeof value.enabled === "boolean" ? value.enabled : true,
      layerCount,
      activeMenuId,
      menus,
      radius,
      innerRadius,
      variant: oneOf(value.variant, ["slice", "bubble"] as const, "slice"),
      startAngle: boundedInteger(value.startAngle, -180, 180, -90, `${sourcePath}.startAngle`, report),
      sweepAngle: boundedInteger(value.sweepAngle, 90, 360, 360, `${sourcePath}.sweepAngle`, report),
    }
    report.push({ sourcePath, status: "converted", message: `Imported ${menus.length} radial menu(s).` })
    return { config, report }
  }
}

function convertMenu(
  value: unknown,
  index: number,
  layerCount: 1 | 2 | 3,
  rootPath: string,
  state: ConversionState,
  id: string,
): ReaderRadialMenuDefinition {
  const source = isRecord(value) ? value : {}
  const path = `${rootPath}.menus[${index}]`
  const name = text(source.name, index === 0 ? "默认轮盘" : `轮盘 ${index + 1}`, `${path}.name`, state.report)
  const rootItems = itemArray(source.items, `${path}.items`, 0, state)
  const rawLayers = Array.isArray(source.layers) ? source.layers : undefined
  const layers = rawLayers
    ? [0, 1, 2].map((layerIndex) => itemArray(rawLayers[layerIndex], `${path}.layers[${layerIndex}]`, layerIndex, state).map(withoutChildren))
    : flattenLayers(rootItems, layerCount)
  return { id, name, layers: layers as ReaderRadialMenuDefinition["layers"] }
}

function itemArray(value: unknown, path: string, depth: number, state: ConversionState): ReaderRadialMenuItem[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    state.report.push({ sourcePath: path, status: "invalid", message: "Expected an item array." })
    return []
  }
  if (value.length > 64) state.report.push({ sourcePath: path, status: "skipped", message: "Only the first 64 items can be imported." })
  return value.slice(0, 64).flatMap((candidate, index) => {
    if (!isRecord(candidate)) {
      state.report.push({ sourcePath: `${path}[${index}]`, status: "invalid", message: "Expected an item object." })
      return []
    }
    return [convertItem(candidate, index, `${path}[${index}]`, depth, state)]
  })
}

function convertItem(source: Record<string, unknown>, index: number, path: string, depth: number, state: ConversionState): ReaderRadialMenuItem {
  const id = uniqueIdentifier(source.id, `legacy-item-${state.itemIds.size + 1}`, state.itemIds)
  if (source.id !== id) state.report.push({ sourcePath: `${path}.id`, status: "converted", message: `Normalized item ID to ${id}.` })
  const action = convertAction(source.action, `${path}.action`, state.report)
  const children = depth >= 2 ? undefined : itemArray(source.children, `${path}.children`, depth + 1, state)
  if (depth >= 2 && Array.isArray(source.children) && source.children.length) {
    state.report.push({ sourcePath: `${path}.children`, status: "skipped", message: "Items deeper than three levels cannot be imported." })
  }
  return {
    id,
    label: text(source.label, `项目 ${index + 1}`, `${path}.label`, state.report),
    action,
    slotIndex: boundedInteger(source.slotIndex, 0, 63, index, `${path}.slotIndex`, state.report),
    ...(typeof source.moveToMenuId === "string" ? { moveToMenuId: source.moveToMenuId } : {}),
    ...(optionalText(source.icon, 80) ? { icon: optionalText(source.icon, 80) } : {}),
    ...(source.disabled === true ? { disabled: true } : {}),
    ...(children?.length ? { children } : {}),
  }
}

function convertAction(value: unknown, path: string, report: LegacyRadialMenuReportEntry[]): ReaderInputAction | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value !== "string") {
    report.push({ sourcePath: path, status: "invalid", message: "Expected an action ID or null." })
    return null
  }
  if (READER_INPUT_ACTIONS.includes(value as ReaderInputAction)) return value as ReaderInputAction
  const converted = readerInputActionFromLegacyId(value)
  if (converted) return converted
  report.push({ sourcePath: path, status: "skipped", message: `Unknown legacy action ${value}; preserved the slot without an action.` })
  return null
}

function flattenLayers(items: ReaderRadialMenuItem[], layerCount: 1 | 2 | 3): ReaderRadialMenuDefinition["layers"] {
  const layers: ReaderRadialMenuDefinition["layers"] = [[], [], []]
  const visit = (current: ReaderRadialMenuItem[], depth: 0 | 1 | 2) => {
    for (const item of current) {
      layers[depth].push(withoutChildren(item))
      if (depth < Math.min(2, layerCount - 1) && item.children?.length) visit(item.children, (depth + 1) as 0 | 1 | 2)
    }
  }
  visit(items, 0)
  return layers
}

function normalizeMoveTargets(item: ReaderRadialMenuItem, menuId: string, path: string, state: ConversionState): void {
  if (item.moveToMenuId) {
    const converted = state.menuIds.get(item.moveToMenuId)
    if (!converted || converted === menuId) {
      state.report.push({ sourcePath: `${path}.${item.id}.moveToMenuId`, status: "skipped", message: "Removed an invalid or self-referencing menu jump." })
      delete item.moveToMenuId
    } else {
      item.moveToMenuId = converted
      if (item.action) {
        state.report.push({ sourcePath: `${path}.${item.id}.action`, status: "skipped", message: "Menu jumps take precedence over actions." })
        item.action = null
      }
    }
  }
  for (const child of item.children ?? []) normalizeMoveTargets(child, menuId, `${path}.${item.id}.children`, state)
}

function uniqueIdentifier(value: unknown, fallback: string, used: Set<string>): string {
  const candidate = typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(value) ? value : fallback
  let id = candidate
  let suffix = 2
  while (used.has(id)) id = `${candidate.slice(0, 76)}-${suffix++}`
  used.add(id)
  return id
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number, path: string, report: LegacyRadialMenuReportEntry[]): number {
  if (Number.isInteger(value)) {
    const bounded = Math.min(maximum, Math.max(minimum, value as number))
    if (bounded !== value) report.push({ sourcePath: path, status: "converted", message: `Clamped value to ${bounded}.` })
    return bounded
  }
  if (value !== undefined) report.push({ sourcePath: path, status: "converted", message: `Replaced an invalid value with ${fallback}.` })
  return fallback
}

function text(value: unknown, fallback: string, path: string, report: LegacyRadialMenuReportEntry[]): string {
  if (typeof value === "string" && value.trim() && value.length <= 80 && !value.includes("\0")) return value.trim()
  report.push({ sourcePath: path, status: "converted", message: `Replaced invalid text with ${fallback}.` })
  return fallback
}

function optionalText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= maximum && !value.includes("\0") ? value.trim() : undefined
}

function withoutChildren(item: ReaderRadialMenuItem): ReaderRadialMenuItem {
  const { children: _children, ...rest } = item
  return rest
}

function oneOf<const T extends string | number>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
