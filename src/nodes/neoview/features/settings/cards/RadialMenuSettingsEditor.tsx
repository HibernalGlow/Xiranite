/**
 * Radial menu settings editor — ring-slot layout inspired by legacy
 * RadialMenuSettingsPanel.svelte, adapted to XR DTO (menus[].layers[]).
 * Single interactive ring (no separate runtime preview) to keep the card compact.
 */
import {
  cloneReaderRadialMenuConfig,
  READER_INPUT_ACTION_CATEGORIES,
  READER_INPUT_ACTION_CATEGORY_LABELS,
  READER_INPUT_ACTION_LABELS,
  READER_INPUT_ACTION_METADATA,
  type ReaderInputAction,
  type ReaderRadialMenuConfig,
  type ReaderRadialMenuItem,
} from "@xiranite/node-neoview/ui-core"
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Eye,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ReaderRadialMenuPatch } from "../../../adapters/reader-http-client"
import { GUI_READER_INPUT_ACTIONS } from "../../input/ReaderInputActionCapabilities"
import { ReaderRadialMenuOverlay } from "../../input/ReaderRadialMenuOverlay"

const CENTER = 260
const MIN_SLOT_COUNT = 8
const EDITOR_RADIUS = 252
const SUBMENU_RADIUS_STEP = 60
const DEFAULT_NEW_ITEM_ACTION: ReaderInputAction = "reader.next-page"

interface EditorSlot {
  id: string
  item: ReaderRadialMenuItem | null
  level: 1 | 2 | 3
  index: number
  disabled: boolean
  d: string
  labelX: number
  labelY: number
  label: string
  hint: string
}

export function RadialMenuSettingsEditor({
  value,
  onSave,
}: {
  value: ReaderRadialMenuConfig
  onSave(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRadialMenuConfig>
}) {
  const [draft, setDraft] = useState(() => cloneReaderRadialMenuConfig(value))
  const [selected, setSelected] = useState<{ level: 1 | 2 | 3; itemId: string }>()
  const [preview, setPreview] = useState(0)
  const [geometryOpen, setGeometryOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string>()

  useEffect(() => {
    setDraft(cloneReaderRadialMenuConfig(value))
    setSelected(undefined)
  }, [value])

  const activeMenu = draft.menus.find((menu) => menu.id === draft.activeMenuId) ?? draft.menus[0]!
  const layerCount = draft.layerCount
  const editorBands = useMemo(
    () => getEditorBands(draft.radius, draft.innerRadius, layerCount),
    [draft.innerRadius, draft.radius, layerCount],
  )

  const selectedItem = useMemo(() => {
    if (!selected) return undefined
    return findItemById(activeMenu.layers[selected.level - 1] ?? [], selected.itemId)
  }, [activeMenu, selected])

  useEffect(() => {
    if (selected && !selectedItem) setSelected(undefined)
  }, [selected, selectedItem])

  const editorSlots = useMemo(() => {
    const slots: EditorSlot[] = []
    for (const level of [1, 2, 3] as const) {
      if (level > layerCount) continue
      slots.push(...buildSlots(level, activeMenu.layers[level - 1] ?? [], draft.startAngle, draft.sweepAngle, editorBands[level]))
    }
    return slots
  }, [activeMenu.layers, draft.startAngle, draft.sweepAngle, editorBands, layerCount])

  const otherMenus = draft.menus.filter((menu) => menu.id !== activeMenu.id)
  const actionGroups = useMemo(() => {
    return READER_INPUT_ACTION_CATEGORIES.map((category) => ({
      category,
      label: READER_INPUT_ACTION_CATEGORY_LABELS[category],
      actions: GUI_READER_INPUT_ACTIONS.filter(
        (action) =>
          READER_INPUT_ACTION_METADATA[action]?.category === category
          && action !== "radial.open-default"
          && action !== "radial.confirm",
      ),
    })).filter((group) => group.actions.length > 0)
  }, [])

  function updateDraft(update: (current: ReaderRadialMenuConfig) => void) {
    setDraft((current) => {
      const next = cloneReaderRadialMenuConfig(current)
      update(next)
      return next
    })
    setFeedback(undefined)
  }

  function mutateLayer(level: 1 | 2 | 3, update: (items: ReaderRadialMenuItem[]) => ReaderRadialMenuItem[]) {
    updateDraft((current) => {
      const menu = current.menus.find((candidate) => candidate.id === current.activeMenuId) ?? current.menus[0]!
      const layerIndex = level - 1
      menu.layers[layerIndex] = update(menu.layers[layerIndex].map(cloneItem))
    })
  }

  function updateSelected(patch: Partial<ReaderRadialMenuItem>) {
    if (!selected) return
    mutateLayer(selected.level, (items) => items.map((item) => (item.id === selected.itemId ? { ...item, ...patch } : item)))
  }

  async function commit(patch: ReaderRadialMenuPatch["radialMenu"]) {
    if (saving) return
    setSaving(true)
    setFeedback(undefined)
    try {
      const updated = await onSave(patch)
      setDraft(cloneReaderRadialMenuConfig(updated))
      setFeedback(patch.reset ? "已恢复默认轮盘。" : "轮盘设置已保存并立即生效。")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function switchMenu(menuId: string) {
    updateDraft((current) => {
      current.activeMenuId = menuId
    })
    setSelected(undefined)
  }

  function addMenu() {
    updateDraft((current) => {
      if (current.menus.length >= 16) return
      const id = uniqueId("menu", current.menus.map((menu) => menu.id))
      current.menus.push({ id, name: `轮盘 ${current.menus.length + 1}`, layers: [[], [], []] })
      current.activeMenuId = id
    })
    setSelected(undefined)
  }

  function deleteMenu() {
    updateDraft((current) => {
      if (current.menus.length <= 1) return
      const removed = current.activeMenuId
      current.menus = current.menus.filter((menu) => menu.id !== removed)
      current.activeMenuId = current.menus[0]!.id
      for (const menu of current.menus) {
        for (const layer of menu.layers) clearMenuReferences(layer, removed)
      }
    })
    setSelected(undefined)
  }

  function handleSlotClick(slot: EditorSlot) {
    if (slot.disabled) return
    if (slot.item) {
      setSelected({ level: slot.level, itemId: slot.item.id })
      return
    }
    const item = newItem(activeMenu.layers[slot.level - 1] ?? [], slot.index)
    mutateLayer(slot.level, (items) => [...items, item])
    updateDraft((current) => {
      current.layerCount = Math.max(current.layerCount, slot.level) as 1 | 2 | 3
    })
    setSelected({ level: slot.level, itemId: item.id })
  }

  function removeSelected() {
    if (!selected) return
    mutateLayer(selected.level, (items) => items.filter((item) => item.id !== selected.itemId))
    setSelected(undefined)
  }

  function moveSelected(offset: -1 | 1) {
    if (!selected) return
    mutateLayer(selected.level, (items) => {
      const sorted = [...items].sort((left, right) => left.slotIndex - right.slotIndex)
      const index = sorted.findIndex((item) => item.id === selected.itemId)
      const target = index + offset
      if (index < 0 || target < 0 || target >= sorted.length) return items
      const next = [...sorted]
      const currentSlot = next[index]!.slotIndex
      next[index] = { ...next[index]!, slotIndex: next[target]!.slotIndex }
      next[target] = { ...next[target]!, slotIndex: currentSlot }
      return next
    })
  }

  const selectedActionLabel = selectedItem?.action
    ? READER_INPUT_ACTION_LABELS[selectedItem.action] ?? selectedItem.action
    : selectedItem?.moveToMenuId
      ? (draft.menus.find((menu) => menu.id === selectedItem.moveToMenuId)?.name ?? "跳转轮盘")
      : "未绑定"

  const hasSlots = activeMenu.layers.some((layer) => layer.length > 0)

  return (
    <div className="grid gap-3" data-neoview-settings-card="radial-menu">
      {/* Compact toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
          <Switch
            checked={draft.enabled}
            disabled={saving}
            onCheckedChange={(enabled) => updateDraft((current) => { current.enabled = enabled })}
            aria-label="启用轮盘"
          />
          <span className="text-muted-foreground">启用</span>
        </label>
        <select
          className="h-8 min-w-[7rem] rounded-md border border-input bg-background px-2 text-xs"
          value={draft.activeMenuId}
          disabled={saving}
          onChange={(event) => switchMenu(event.currentTarget.value)}
          aria-label="活动轮盘"
        >
          {draft.menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}
        </select>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={draft.layerCount}
          disabled={saving}
          onChange={(event) => {
            const next = Number(event.currentTarget.value) as 1 | 2 | 3
            updateDraft((current) => { current.layerCount = next })
            if (selected && selected.level > next) setSelected(undefined)
          }}
          aria-label="轮盘层数"
        >
          <option value={1}>1 层</option>
          <option value={2}>2 层</option>
          <option value={3}>3 层</option>
        </select>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" disabled={saving || draft.menus.length >= 16} onClick={addMenu}>
            <Plus />新轮盘
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={saving || draft.menus.length <= 1} onClick={deleteMenu}>
            <Trash2 />
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={saving || !hasSlots} onClick={() => setPreview((n) => n + 1)} title="全屏弹出预览">
            <Eye />
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void commit({ reset: "defaults" })}>
            <RotateCcw />
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void commit({ config: draft })}>
            <Save />保存
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {draft.enabled ? "已启用" : "已停用"} · {levelName(layerCount)} · 点空槽添加，点已有槽编辑
      </p>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
        {/* Single interactive ring */}
        <section className="grid content-start gap-2 rounded-lg border bg-card/40 p-2">
          <div className="flex justify-center">
            <svg
              viewBox="0 0 520 520"
              className="h-[min(52vh,22rem)] min-h-[16rem] w-full max-w-[22rem]"
              role="img"
              aria-label="轮盘槽位编辑器"
            >
              <circle cx={CENTER} cy={CENTER} r={EDITOR_RADIUS} className="fill-background stroke-border" />
              {layerCount >= 3 ? <circle cx={CENTER} cy={CENTER} r={editorBands[3].inner} className="fill-background stroke-border" /> : null}
              {layerCount >= 2 ? <circle cx={CENTER} cy={CENTER} r={editorBands[2].inner} className="fill-background stroke-border" /> : null}
              <circle cx={CENTER} cy={CENTER} r={editorBands[1].inner} className="fill-background stroke-border" />

              {editorSlots.map((slot) => {
                const isSelected = Boolean(slot.item && selected?.itemId === slot.item.id)
                return (
                  <g
                    key={slot.id}
                    data-radial-editor-level={slot.level}
                    data-radial-editor-slot={slot.index}
                    className={slot.disabled ? "opacity-35" : "cursor-pointer"}
                    onClick={() => handleSlotClick(slot)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        handleSlotClick(slot)
                      }
                    }}
                    tabIndex={slot.disabled ? -1 : 0}
                    role="button"
                    aria-label={slot.hint}
                    aria-pressed={isSelected}
                  >
                    <path
                      d={slot.d}
                      className={
                        slot.item
                          ? isSelected
                            ? "fill-primary/25 stroke-primary stroke-2"
                            : "fill-muted/40 stroke-border hover:fill-primary/10"
                          : "fill-muted/15 stroke-muted-foreground/30 stroke-dashed hover:fill-primary/15 hover:stroke-primary/60"
                      }
                    />
                    {slot.item ? (
                      <foreignObject x={slot.labelX - 36} y={slot.labelY - 16} width="72" height="32" className="pointer-events-none">
                        <div className="flex h-full w-full flex-col items-center justify-center overflow-hidden text-center">
                          <div className="max-w-full truncate px-1 text-[11px] font-medium leading-tight text-foreground">
                            {shortLabel(slot.label)}
                          </div>
                        </div>
                      </foreignObject>
                    ) : !slot.disabled ? (
                      <text
                        x={slot.labelX}
                        y={slot.labelY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="pointer-events-none fill-muted-foreground text-[16px]"
                      >
                        +
                      </text>
                    ) : null}
                  </g>
                )
              })}

              <circle cx={CENTER} cy={CENTER} r="22" className="fill-card stroke-border" />
              <text x={CENTER} y={CENTER} textAnchor="middle" dominantBaseline="middle" className="pointer-events-none fill-muted-foreground text-[10px] font-medium">
                {levelName(layerCount)}
              </text>
            </svg>
          </div>

          <button
            type="button"
            className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/40"
            onClick={() => setGeometryOpen((open) => !open)}
            aria-expanded={geometryOpen}
          >
            {geometryOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            外观与几何
            <span className="ml-auto tabular-nums opacity-80">
              r{draft.radius} · 内{draft.innerRadius} · {draft.variant === "slice" ? "扇区" : "气泡"}
            </span>
          </button>
          {geometryOpen ? (
            <div className="grid gap-2 border-t pt-2 sm:grid-cols-2 lg:grid-cols-5">
              <NumberField label="半径" value={draft.radius} min={60} max={300} onChange={(radius) => updateDraft((current) => { current.radius = radius })} />
              <NumberField label="内半径" value={draft.innerRadius} min={0} max={Math.min(100, draft.radius - 1)} onChange={(innerRadius) => updateDraft((current) => { current.innerRadius = innerRadius })} />
              <NumberField label="起始角" value={draft.startAngle} min={-180} max={180} onChange={(startAngle) => updateDraft((current) => { current.startAngle = startAngle })} />
              <NumberField label="扫过角" value={draft.sweepAngle} min={90} max={360} onChange={(sweepAngle) => updateDraft((current) => { current.sweepAngle = sweepAngle })} />
              <label className="grid gap-1 text-[11px] text-muted-foreground">
                样式
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={draft.variant}
                  onChange={(event) => updateDraft((current) => { current.variant = event.currentTarget.value as ReaderRadialMenuConfig["variant"] })}
                >
                  <option value="slice">扇区</option>
                  <option value="bubble">气泡</option>
                </select>
              </label>
            </div>
          ) : null}
        </section>

        {/* Slot inspector */}
        <aside className="flex flex-col gap-2.5 rounded-lg border bg-card/40 p-3">
          <div className="grid gap-0.5">
            <h3 className="text-sm font-medium">槽位</h3>
            <p className="text-[11px] text-muted-foreground">
              {selectedItem ? `${levelName(selected!.level)} · 索引 ${selectedItem.slotIndex}` : "点左侧空槽或已有槽"}
            </p>
          </div>

          <label className="grid gap-1 text-xs text-muted-foreground">
            轮盘名
            <Input
              value={activeMenu.name}
              maxLength={80}
              disabled={saving}
              aria-label="当前轮盘名"
              onChange={(event) => {
                const name = event.currentTarget.value
                updateDraft((current) => {
                  const menu = current.menus.find((candidate) => candidate.id === current.activeMenuId)
                  if (menu) menu.name = name
                })
              }}
            />
          </label>

          {selectedItem && selected ? (
            <>
              <div className="flex items-center gap-2 rounded-md border bg-background/70 px-2.5 py-2">
                <CircleDot className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{selectedItem.label || "未命名"}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{selectedActionLabel}</div>
                </div>
              </div>

              <label className="grid gap-1 text-xs text-muted-foreground">
                类型
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={selectedItem.moveToMenuId ? "moveTo" : "action"}
                  disabled={saving}
                  onChange={(event) => {
                    if (event.currentTarget.value === "moveTo") {
                      updateSelected({ action: null, moveToMenuId: otherMenus[0]?.id })
                    } else {
                      updateSelected({ moveToMenuId: undefined, action: selectedItem.action ?? "reader.next-page" })
                    }
                  }}
                >
                  <option value="action">执行动作</option>
                  <option value="moveTo" disabled={!otherMenus.length}>跳转轮盘</option>
                </select>
              </label>

              {selectedItem.moveToMenuId ? (
                <label className="grid gap-1 text-xs text-muted-foreground">
                  目标
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={selectedItem.moveToMenuId}
                    disabled={saving}
                    onChange={(event) => updateSelected({ moveToMenuId: event.currentTarget.value, action: null })}
                  >
                    {otherMenus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}
                  </select>
                </label>
              ) : (
                <label className="grid gap-1 text-xs text-muted-foreground">
                  动作
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={selectedItem.action ?? ""}
                    disabled={saving}
                    onChange={(event) => {
                      const next = event.currentTarget.value ? event.currentTarget.value as ReaderInputAction : null
                      const previousActionLabel = inputActionLabel(selectedItem.action)
                      const shouldFollowAction = selectedItem.label === "新操作" || selectedItem.label === previousActionLabel
                      updateSelected({
                        action: next,
                        moveToMenuId: undefined,
                        ...(shouldFollowAction ? { label: inputActionLabel(next) } : {}),
                      })
                    }}
                  >
                    <option value="">未绑定</option>
                    {actionGroups.map((group) => (
                      <optgroup key={group.category} label={group.label}>
                        {group.actions.map((action) => (
                          <option key={action} value={action}>{READER_INPUT_ACTION_LABELS[action]}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}

              <label className="grid gap-1 text-xs text-muted-foreground">
                显示文字
                <Input
                  value={selectedItem.label}
                  maxLength={80}
                  disabled={saving}
                  aria-label="轮盘项目名称"
                  onChange={(event) => updateSelected({ label: event.currentTarget.value })}
                />
              </label>

              <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  槽位
                  <Input
                    type="number"
                    min={0}
                    max={63}
                    value={selectedItem.slotIndex}
                    disabled={saving}
                    onChange={(event) => updateSelected({ slotIndex: Number(event.currentTarget.value) })}
                  />
                </label>
                <label className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs">
                  <Switch
                    checked={!selectedItem.disabled}
                    disabled={saving}
                    onCheckedChange={(enabled) => updateSelected({ disabled: enabled ? undefined : true })}
                    aria-label={`${selectedItem.label}启用`}
                  />
                  启用
                </label>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => moveSelected(-1)}>前移</Button>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => moveSelected(1)}>后移</Button>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={saving} onClick={removeSelected}>
                  <Trash2 />
                </Button>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center rounded-md border border-dashed px-3 py-8 text-center">
              <p className="text-xs text-muted-foreground">点左侧环上的 + 添加槽位</p>
            </div>
          )}
        </aside>
      </div>

      {feedback ? <p role="status" className="text-sm text-muted-foreground">{feedback}</p> : null}
      {preview ? (
        <ReaderRadialMenuOverlay
          config={draft}
          request={{ id: preview, x: window.innerWidth / 2, y: window.innerHeight / 2 }}
          onClose={() => setPreview(0)}
          onSelect={() => setPreview(0)}
        />
      ) : null}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange(value: number): void
}) {
  return (
    <label className="grid gap-1 text-[11px] text-muted-foreground">
      {label}
      <Input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.currentTarget.value))} />
    </label>
  )
}

function buildSlots(
  level: 1 | 2 | 3,
  items: readonly ReaderRadialMenuItem[],
  startAngle: number,
  sweepAngle: number,
  band: { inner: number; outer: number },
): EditorSlot[] {
  const slotCount = getSlotCount(items)
  const sweep = sweepAngle / slotCount
  const bySlot = new Map<number, ReaderRadialMenuItem>()
  items.forEach((item, index) => {
    const slotIndex = Number.isFinite(item.slotIndex) ? item.slotIndex : index
    bySlot.set(slotIndex, item)
  })

  return Array.from({ length: slotCount }, (_, index) => {
    const item = bySlot.get(index) ?? null
    const start = startAngle + index * sweep
    const end = start + sweep
    const labelPoint = polar((band.inner + band.outer) / 2, start + sweep / 2)
    return {
      id: `${level}-${index}-${item?.id ?? "empty"}`,
      item,
      level,
      index,
      disabled: false,
      d: sectorPath(band.inner, band.outer, start, end),
      labelX: labelPoint.x,
      labelY: labelPoint.y,
      label: item?.label || "+",
      hint: item ? `编辑${levelName(level)}：${item.label}` : `添加${levelName(level)}槽位 ${index}`,
    }
  })
}

function getSlotCount(items: readonly ReaderRadialMenuItem[]): number {
  const maxSlot = items.reduce((max, item, index) => Math.max(max, Number.isFinite(item.slotIndex) ? item.slotIndex : index), -1)
  return Math.max(MIN_SLOT_COUNT, maxSlot + 1)
}

function polar(radius: number, angleDeg: number): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) }
}

function getEditorBands(radius: number, innerRadius: number, layerCount: 1 | 2 | 3): Record<1 | 2 | 3, { inner: number; outer: number }> {
  const runtimeOuterRadius = radius + (layerCount - 1) * SUBMENU_RADIUS_STEP
  const scale = EDITOR_RADIUS / runtimeOuterRadius
  return {
    1: { inner: innerRadius * scale, outer: radius * scale },
    2: { inner: radius * scale, outer: (radius + SUBMENU_RADIUS_STEP) * scale },
    3: { inner: (radius + SUBMENU_RADIUS_STEP) * scale, outer: (radius + SUBMENU_RADIUS_STEP * 2) * scale },
  }
}

function sectorPath(innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): string {
  const outerStart = polar(outerRadius, startAngle)
  const outerEnd = polar(outerRadius, endAngle)
  const innerEnd = polar(innerRadius, endAngle)
  const innerStart = polar(innerRadius, startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ")
}

function newItem(items: readonly ReaderRadialMenuItem[], preferredSlot?: number): ReaderRadialMenuItem {
  const ids = items.map((item) => item.id)
  const used = new Set(items.map((item) => item.slotIndex))
  let slotIndex = preferredSlot ?? 0
  if (used.has(slotIndex)) {
    slotIndex = 0
    while (used.has(slotIndex) && slotIndex < 64) slotIndex += 1
  }
  return {
    id: uniqueId("item", ids),
    label: inputActionLabel(DEFAULT_NEW_ITEM_ACTION),
    action: DEFAULT_NEW_ITEM_ACTION,
    slotIndex: Math.min(63, slotIndex),
  }
}

function inputActionLabel(action: ReaderInputAction | null | undefined): string {
  return action ? READER_INPUT_ACTION_LABELS[action] ?? action : ""
}

function uniqueId(prefix: string, ids: readonly string[]): string {
  let index = ids.length + 1
  while (ids.includes(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function findItemById(items: readonly ReaderRadialMenuItem[], id: string): ReaderRadialMenuItem | undefined {
  return items.find((item) => item.id === id)
}

function clearMenuReferences(items: ReaderRadialMenuItem[], menuId: string): void {
  for (const item of items) {
    if (item.moveToMenuId === menuId) item.moveToMenuId = undefined
    if (item.children) clearMenuReferences(item.children, menuId)
  }
}

function cloneItem(item: ReaderRadialMenuItem): ReaderRadialMenuItem {
  return {
    ...item,
    children: item.children?.map(cloneItem),
  }
}

function shortLabel(label: string): string {
  return label.length > 5 ? `${label.slice(0, 5)}…` : label
}

function levelName(level: number): string {
  if (level <= 1) return "一级"
  if (level === 2) return "二级"
  return "三级"
}
