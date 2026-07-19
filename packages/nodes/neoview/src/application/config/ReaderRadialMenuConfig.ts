import { READER_INPUT_ACTIONS, type ReaderInputAction } from "../../domain/input/ReaderInputBindings.js"

export type ReaderRadialMenuVariant = "slice" | "bubble"

export interface ReaderRadialMenuItem {
  id: string
  label: string
  action: ReaderInputAction | null
  slotIndex: number
  moveToMenuId?: string
  icon?: string
  disabled?: boolean
  children?: ReaderRadialMenuItem[]
}

export interface ReaderRadialMenuDefinition {
  id: string
  name: string
  layers: [ReaderRadialMenuItem[], ReaderRadialMenuItem[], ReaderRadialMenuItem[]]
}

export interface ReaderRadialMenuConfig {
  enabled: boolean
  layerCount: 1 | 2 | 3
  activeMenuId: string
  menus: ReaderRadialMenuDefinition[]
  radius: number
  innerRadius: number
  variant: ReaderRadialMenuVariant
  startAngle: number
  sweepAngle: number
}

export interface NeoviewRadialMenuPatch {
  radialMenu: { config?: ReaderRadialMenuConfig; reset?: "defaults" }
}

/**
 * Defaults from legacy export `migration/neoview/neoview-data-1784386950682.json`
 * → appSettings.radialMenus (via LegacyRadialMenuCodec). Empty placeholder slots
 * and the unused second menu were dropped; slot indices kept unique per layer.
 */
export const DEFAULT_READER_RADIAL_MENU_CONFIG: ReaderRadialMenuConfig = {
  enabled: true,
  layerCount: 2,
  activeMenuId: "default",
  menus: [{
    id: "default",
    name: "默认轮盘",
    layers: [
      [
        { id: "radial-temp-fit", label: "临时适应窗口", action: "reader.toggle-temporary-fit", slotIndex: 1 },
        { id: "radial-auto-upscale", label: "自动超分开关", action: "upscale.toggle-auto", slotIndex: 2 },
        { id: "radial-temp-fit-alt", label: "临时适应窗口", action: "reader.toggle-temporary-fit", slotIndex: 3 },
        { id: "radial-rotate-180", label: "旋转180度", action: "reader.rotate-180", slotIndex: 4 },
        { id: "radial-fullscreen", label: "全屏", action: "reader.fullscreen", slotIndex: 6 },
        { id: "radial-page-toast", label: "翻页提示开关", action: "viewer.toggle-page-switch-toast", slotIndex: 7 },
      ],
      [
        { id: "radial-next-page", label: "下一页", action: "reader.next-page", slotIndex: 0 },
        { id: "radial-last-page", label: "最后一页", action: "reader.last-page", slotIndex: 2 },
        { id: "radial-bottom-thumb-pin", label: "固定底部缩略图栏", action: "shell.toggle-bottom-thumbnail-pin", slotIndex: 3 },
      ],
      [],
    ],
  }],
  radius: 120,
  innerRadius: 40,
  variant: "slice",
  startAngle: -90,
  sweepAngle: 360,
}

export function cloneReaderRadialMenuConfig(config: ReaderRadialMenuConfig): ReaderRadialMenuConfig {
  return {
    ...config,
    menus: config.menus.map((menu) => ({ ...menu, layers: menu.layers.map((layer) => layer.map(cloneItem)) as ReaderRadialMenuDefinition["layers"] })),
  }
}

export function parseReaderRadialMenuConfig(value: unknown, label = "[nodes.neoview.bindings].radial_menus"): ReaderRadialMenuConfig {
  if (value === undefined) return cloneReaderRadialMenuConfig(DEFAULT_READER_RADIAL_MENU_CONFIG)
  const source = record(value, label)
  rejectUnknown(source, ["enabled", "layerCount", "activeMenuId", "menus", "radius", "innerRadius", "variant", "startAngle", "sweepAngle", "id", "name", "layers", "items"], label)
  const rawMenus = Array.isArray(source.menus) && source.menus.length
    ? source.menus
    : [{ id: source.id ?? "default", name: source.name ?? "默认轮盘", layers: source.layers, items: source.items }]
  if (rawMenus.length > 16) throw new Error(`${label}.menus must contain at most 16 menus.`)
  const menus = rawMenus.map((menu, index) => parseMenu(menu, `${label}.menus[${index}]`))
  const menuIds = uniqueIds(menus, `${label}.menus`)
  const activeMenuId = source.activeMenuId === undefined ? menus[0]!.id : identifier(source.activeMenuId, `${label}.activeMenuId`)
  if (!menuIds.has(activeMenuId)) throw new Error(`${label}.activeMenuId must reference an existing menu.`)
  for (const [menuIndex, menu] of menus.entries()) {
    const itemIds = new Set<string>()
    for (const [layerIndex, layer] of menu.layers.entries()) {
      for (const item of layer) validateItemReferences(item, menu.id, menuIds, itemIds, `${label}.menus[${menuIndex}].layers[${layerIndex}]`)
    }
  }
  const radius = integer(source.radius ?? 120, 60, 300, `${label}.radius`)
  const innerRadius = integer(source.innerRadius ?? 40, 0, 100, `${label}.innerRadius`)
  if (innerRadius >= radius) throw new Error(`${label}.innerRadius must be smaller than radius.`)
  return {
    enabled: boolean(source.enabled ?? true, `${label}.enabled`),
    layerCount: enumeration(source.layerCount ?? 3, [1, 2, 3] as const, `${label}.layerCount`),
    activeMenuId,
    menus,
    radius,
    innerRadius,
    variant: enumeration(source.variant ?? "slice", ["slice", "bubble"] as const, `${label}.variant`),
    startAngle: integer(source.startAngle ?? -90, -180, 180, `${label}.startAngle`),
    sweepAngle: integer(source.sweepAngle ?? 360, 90, 360, `${label}.sweepAngle`),
  }
}

export function parseReaderRadialMenuPatch(value: unknown): { patch: NeoviewRadialMenuPatch; tomlPatch: Record<string, unknown> } {
  const root = record(value, "reader radial menu patch")
  rejectUnknown(root, ["radialMenu"], "reader radial menu patch")
  const source = record(root.radialMenu, "reader radial menu patch.radialMenu")
  rejectUnknown(source, ["config", "reset"], "reader radial menu patch.radialMenu")
  if (source.reset !== undefined) {
    if (source.reset !== "defaults" || source.config !== undefined) throw new Error("reader radial menu reset must be defaults and cannot include config.")
    const config = cloneReaderRadialMenuConfig(DEFAULT_READER_RADIAL_MENU_CONFIG)
    return { patch: { radialMenu: { reset: "defaults" } }, tomlPatch: { bindings: { radial_menus: config } } }
  }
  const config = parseReaderRadialMenuConfig(source.config, "reader radial menu patch.radialMenu.config")
  return { patch: { radialMenu: { config } }, tomlPatch: { bindings: { radial_menus: config } } }
}

function parseMenu(value: unknown, label: string): ReaderRadialMenuDefinition {
  const source = record(value, label)
  rejectUnknown(source, ["id", "name", "layers", "items"], label)
  const rootItems = source.items === undefined ? [] : itemArray(source.items, `${label}.items`, 0)
  const sourceLayers = source.layers === undefined ? [rootItems] : source.layers
  if (!Array.isArray(sourceLayers) || sourceLayers.length > 3) throw new Error(`${label}.layers must contain at most 3 layers.`)
  const layers = [0, 1, 2].map((index) => sourceLayers[index] === undefined ? [] : itemArray(sourceLayers[index], `${label}.layers[${index}]`, index)) as ReaderRadialMenuDefinition["layers"]
  return { id: identifier(source.id, `${label}.id`), name: text(source.name, `${label}.name`, 80), layers }
}

function itemArray(value: unknown, label: string, depth: number): ReaderRadialMenuItem[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error(`${label} must contain at most 64 items.`)
  return value.map((item, index) => parseItem(item, `${label}[${index}]`, depth))
}

function parseItem(value: unknown, label: string, depth: number): ReaderRadialMenuItem {
  if (depth > 2) throw new Error(`${label} exceeds the maximum submenu depth of 3.`)
  const source = record(value, label)
  rejectUnknown(source, ["id", "label", "action", "slotIndex", "moveToMenuId", "icon", "disabled", "children"], label)
  const action = source.action === null || source.action === undefined ? null : enumeration(source.action, READER_INPUT_ACTIONS, `${label}.action`)
  const moveToMenuId = source.moveToMenuId === undefined ? undefined : identifier(source.moveToMenuId, `${label}.moveToMenuId`)
  if (action && moveToMenuId) throw new Error(`${label} cannot combine action and moveToMenuId.`)
  return {
    id: identifier(source.id, `${label}.id`),
    label: text(source.label, `${label}.label`, 80),
    action,
    slotIndex: integer(source.slotIndex ?? 0, 0, 63, `${label}.slotIndex`),
    ...(moveToMenuId ? { moveToMenuId } : {}),
    ...(source.icon === undefined ? {} : { icon: text(source.icon, `${label}.icon`, 80) }),
    ...(source.disabled === true ? { disabled: boolean(source.disabled, `${label}.disabled`) } : source.disabled === undefined || source.disabled === false ? {} : { disabled: boolean(source.disabled, `${label}.disabled`) }),
    ...(source.children === undefined ? {} : { children: itemArray(source.children, `${label}.children`, depth + 1) }),
  }
}

function validateItemReferences(item: ReaderRadialMenuItem, menuId: string, menuIds: Set<string>, itemIds: Set<string>, label: string): void {
  if (itemIds.has(item.id)) throw new Error(`${label} contains duplicate item id ${item.id}.`)
  itemIds.add(item.id)
  if (item.moveToMenuId && (!menuIds.has(item.moveToMenuId) || item.moveToMenuId === menuId)) {
    throw new Error(`${label}.${item.id}.moveToMenuId must reference another existing menu.`)
  }
  for (const child of item.children ?? []) validateItemReferences(child, menuId, menuIds, itemIds, `${label}.${item.id}.children`)
}

function cloneItem(item: ReaderRadialMenuItem): ReaderRadialMenuItem {
  return { ...item, children: item.children?.map(cloneItem) }
}

function uniqueIds(values: readonly { id: string }[], label: string): Set<string> {
  const ids = new Set(values.map((value) => value.id))
  if (ids.size !== values.length) throw new Error(`${label} contains duplicate ids.`)
  return ids
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function rejectUnknown(source: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unsupported = Object.keys(source).filter((key) => !allowed.includes(key))
  if (unsupported.length) throw new Error(`${label} contains unsupported fields: ${unsupported.join(", ")}.`)
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(value)) throw new Error(`${label} must be a valid identifier.`)
  return value
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) throw new Error(`${label} must be non-empty text up to ${maximum} characters.`)
  return value.trim()
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`)
  return value as number
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`)
  return value
}

function enumeration<const T extends string | number>(value: unknown, values: readonly T[], label: string): T {
  if (!values.includes(value as T)) throw new Error(`${label} is invalid.`)
  return value as T
}
