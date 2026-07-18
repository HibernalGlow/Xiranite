import {
  cloneReaderRadialMenuConfig,
  READER_INPUT_ACTIONS,
  READER_INPUT_ACTION_LABELS,
  type ReaderInputAction,
  type ReaderRadialMenuConfig,
  type ReaderRadialMenuItem,
} from "@xiranite/node-neoview/ui-core"
import { ArrowDown, ArrowUp, Eye, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { ReaderRadialMenuPatch } from "../../../adapters/reader-http-client"
import { ReaderRadialMenuOverlay } from "../../input/ReaderRadialMenuOverlay"

export function RadialMenuSettingsEditor({ value, onSave }: {
  value: ReaderRadialMenuConfig
  onSave(patch: ReaderRadialMenuPatch["radialMenu"]): Promise<ReaderRadialMenuConfig>
}) {
  const [draft, setDraft] = useState(() => cloneReaderRadialMenuConfig(value))
  const [layer, setLayer] = useState<0 | 1 | 2>(0)
  const [preview, setPreview] = useState(0)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string>()
  useEffect(() => setDraft(cloneReaderRadialMenuConfig(value)), [value])

  const activeMenu = draft.menus.find((menu) => menu.id === draft.activeMenuId) ?? draft.menus[0]!

  async function commit(patch: ReaderRadialMenuPatch["radialMenu"]) {
    if (saving) return
    setSaving(true)
    setFeedback(undefined)
    try {
      const updated = await onSave(patch)
      setDraft(cloneReaderRadialMenuConfig(updated))
      setLayer((current) => Math.min(current, updated.layerCount - 1) as 0 | 1 | 2)
      setFeedback(patch.reset ? "已恢复默认轮盘。" : "轮盘设置已保存并立即生效。")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function updateConfig(update: (current: ReaderRadialMenuConfig) => ReaderRadialMenuConfig) {
    setDraft((current) => update(cloneReaderRadialMenuConfig(current)))
    setFeedback(undefined)
  }

  function updateList(parentPath: number[], update: (items: ReaderRadialMenuItem[]) => ReaderRadialMenuItem[]) {
    updateConfig((current) => {
      const menu = current.menus.find((candidate) => candidate.id === current.activeMenuId) ?? current.menus[0]!
      let items = menu.layers[layer]
      for (const index of parentPath) {
        const item = items[index]
        if (!item) return current
        item.children ??= []
        items = item.children
      }
      const next = update(items)
      items.splice(0, items.length, ...next)
      return current
    })
  }

  function addMenu() {
    updateConfig((current) => {
      if (current.menus.length >= 16) return current
      const id = uniqueId("menu", current.menus.map((menu) => menu.id))
      current.menus.push({ id, name: `轮盘 ${current.menus.length + 1}`, layers: [[], [], []] })
      current.activeMenuId = id
      return current
    })
    setLayer(0)
  }

  function deleteMenu() {
    updateConfig((current) => {
      if (current.menus.length <= 1) return current
      current.menus = current.menus.filter((menu) => menu.id !== current.activeMenuId)
      current.activeMenuId = current.menus[0]!.id
      for (const menu of current.menus) for (const items of menu.layers) clearMenuReferences(items, activeMenu.id)
      return current
    })
    setLayer(0)
  }

  return <section className="grid gap-4 border-t pt-5" data-neoview-settings-card="radial-menu">
    <header className="flex flex-wrap items-center gap-2">
      <Switch checked={draft.enabled} disabled={saving} onCheckedChange={(enabled) => updateConfig((current) => ({ ...current, enabled }))} aria-label="启用轮盘" />
      <h2 className="mr-auto text-base font-semibold">轮盘菜单</h2>
      <Button type="button" size="sm" variant="outline" disabled={saving || !activeMenu.layers.some((items) => items.length)} onClick={() => setPreview((current) => current + 1)}><Eye />预览</Button>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void commit({ reset: "defaults" })}><RotateCcw />恢复默认</Button>
      <Button type="button" size="sm" disabled={saving} onClick={() => void commit({ config: draft })}><Save />保存轮盘</Button>
    </header>

    <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-2 border-r pr-3">
        <label className="grid gap-1 text-xs text-muted-foreground">活动轮盘
          <select className="h-9 rounded border border-input bg-background px-2 text-sm" value={draft.activeMenuId} onChange={(event) => { const id = event.currentTarget.value; updateConfig((current) => ({ ...current, activeMenuId: id })); setLayer(0) }}>
            {draft.menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">名称
          <Input value={activeMenu.name} maxLength={80} onChange={(event) => { const name = event.currentTarget.value; updateConfig((current) => { current.menus.find((menu) => menu.id === current.activeMenuId)!.name = name; return current }) }} />
        </label>
        <div className="grid grid-cols-2 gap-1">
          <Button type="button" size="sm" variant="outline" disabled={draft.menus.length >= 16} onClick={addMenu}><Plus />新增</Button>
          <Button type="button" size="sm" variant="ghost" disabled={draft.menus.length <= 1} onClick={deleteMenu}><Trash2 />删除</Button>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">层数
          <select className="h-9 rounded border border-input bg-background px-2 text-sm" value={draft.layerCount} onChange={(event) => { const layerCount = Number(event.currentTarget.value) as 1 | 2 | 3; updateConfig((current) => ({ ...current, layerCount })); setLayer((current) => Math.min(current, layerCount - 1) as 0 | 1 | 2) }}>
            <option value={1}>1 层</option><option value={2}>2 层</option><option value={3}>3 层</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-1" aria-label="选择轮盘层">
          {([0, 1, 2] as const).slice(0, draft.layerCount).map((index) => <Button key={index} type="button" size="sm" variant={layer === index ? "default" : "outline"} onClick={() => setLayer(index)}>{index + 1}</Button>)}
        </div>
      </aside>

      <div className="grid min-w-0 content-start gap-3">
        <div className="flex items-center gap-2">
          <h3 className="mr-auto text-sm font-medium">第 {layer + 1} 层槽位</h3>
          <Button type="button" size="sm" variant="outline" disabled={activeMenu.layers[layer].length >= 64} onClick={() => updateList([], (items) => [...items, newItem(items)])}><Plus />添加槽位</Button>
        </div>
        <div className="grid gap-2" role="list" aria-label={`轮盘第 ${layer + 1} 层项目`}>
          {activeMenu.layers[layer].map((item, index) => <RadialItemEditor key={item.id} item={item} index={index} depth={1} menus={draft.menus.map((menu) => ({ id: menu.id, name: menu.name })).filter((menu) => menu.id !== activeMenu.id)} parentPath={[]} onListChange={updateList} />)}
          {!activeMenu.layers[layer].length ? <p className="py-6 text-center text-sm text-muted-foreground">此层尚无槽位</p> : null}
        </div>
      </div>
    </div>

    <fieldset className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-5">
      <legend className="px-1 text-sm font-medium">外观与几何</legend>
      <NumberField label="半径" value={draft.radius} min={60} max={300} onChange={(radius) => updateConfig((current) => ({ ...current, radius }))} />
      <NumberField label="内半径" value={draft.innerRadius} min={0} max={Math.min(100, draft.radius - 1)} onChange={(innerRadius) => updateConfig((current) => ({ ...current, innerRadius }))} />
      <NumberField label="起始角" value={draft.startAngle} min={-180} max={180} onChange={(startAngle) => updateConfig((current) => ({ ...current, startAngle }))} />
      <NumberField label="扫过角" value={draft.sweepAngle} min={90} max={360} onChange={(sweepAngle) => updateConfig((current) => ({ ...current, sweepAngle }))} />
      <label className="grid gap-1 text-xs text-muted-foreground">样式
        <select className="h-9 rounded border border-input bg-background px-2 text-sm" value={draft.variant} onChange={(event) => { const variant = event.currentTarget.value as ReaderRadialMenuConfig["variant"]; updateConfig((current) => ({ ...current, variant })) }}><option value="slice">扇区</option><option value="bubble">气泡</option></select>
      </label>
    </fieldset>
    {feedback ? <p role="status" className="text-sm text-muted-foreground">{feedback}</p> : null}
    {preview ? <ReaderRadialMenuOverlay config={draft} request={{ id: preview, x: window.innerWidth / 2, y: window.innerHeight / 2 }} onClose={() => setPreview(0)} onSelect={() => setPreview(0)} /> : null}
  </section>
}

function RadialItemEditor({ item, index, depth, menus, parentPath, onListChange }: {
  item: ReaderRadialMenuItem
  index: number
  depth: number
  menus: Array<{ id: string; name: string }>
  parentPath: number[]
  onListChange(parentPath: number[], update: (items: ReaderRadialMenuItem[]) => ReaderRadialMenuItem[]): void
}) {
  const target = item.moveToMenuId ? `menu:${item.moveToMenuId}` : item.action ? `action:${item.action}` : "none"
  const change = (patch: Partial<ReaderRadialMenuItem>) => onListChange(parentPath, (items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, ...patch } : current))
  const move = (offset: number) => onListChange(parentPath, (items) => {
    const targetIndex = index + offset
    if (targetIndex < 0 || targetIndex >= items.length) return items
    const next = [...items]
    ;[next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!]
    return next
  })
  return <div role="listitem" className="grid gap-2 rounded border border-border/70 p-2" style={{ marginLeft: `${(depth - 1) * 12}px` }}>
    <div className="grid gap-2 md:grid-cols-[minmax(7rem,1fr)_5rem_minmax(10rem,1.4fr)_auto] md:items-center">
      <Input value={item.label} maxLength={80} onChange={(event) => change({ label: event.currentTarget.value })} aria-label="轮盘项目名称" />
      <Input type="number" min={0} max={63} value={item.slotIndex} onChange={(event) => change({ slotIndex: Number(event.currentTarget.value) })} aria-label="槽位索引" />
      <select className="h-9 min-w-0 rounded border border-input bg-background px-2 text-sm" value={target} onChange={(event) => {
        const [kind, value] = event.currentTarget.value.split(":", 2)
        change(kind === "action" ? { action: value as ReaderInputAction, moveToMenuId: undefined } : kind === "menu" ? { action: null, moveToMenuId: value } : { action: null, moveToMenuId: undefined })
      }} aria-label="轮盘项目动作">
        <option value="none">无动作</option>
        <optgroup label="操作">{READER_INPUT_ACTIONS.filter((action) => action !== "radial.open-default").map((action) => <option key={action} value={`action:${action}`}>{READER_INPUT_ACTION_LABELS[action]}</option>)}</optgroup>
        {menus.length ? <optgroup label="跳转轮盘">{menus.map((menu) => <option key={menu.id} value={`menu:${menu.id}`}>{menu.name}</option>)}</optgroup> : null}
      </select>
      <div className="flex items-center justify-end gap-1">
        <label className="mr-1 flex items-center gap-1 text-xs"><Switch checked={!item.disabled} onCheckedChange={(enabled) => change({ disabled: enabled ? undefined : true })} aria-label={`${item.label}启用`} />启用</label>
        <Button type="button" size="icon-xs" variant="ghost" disabled={index === 0} onClick={() => move(-1)} title="上移"><ArrowUp /></Button>
        <Button type="button" size="icon-xs" variant="ghost" onClick={() => move(1)} title="下移"><ArrowDown /></Button>
        <Button type="button" size="icon-xs" variant="ghost" onClick={() => onListChange(parentPath, (items) => items.filter((_, currentIndex) => currentIndex !== index))} title="删除"><Trash2 /></Button>
      </div>
    </div>
    {depth < 3 ? <div className="flex justify-end"><Button type="button" size="xs" variant="ghost" disabled={(item.children?.length ?? 0) >= 64} onClick={() => onListChange([...parentPath, index], (items) => [...items, newItem(items)])}><Plus />添加子项</Button></div> : null}
    {item.children?.map((child, childIndex) => <RadialItemEditor key={child.id} item={child} index={childIndex} depth={depth + 1} menus={menus} parentPath={[...parentPath, index]} onListChange={onListChange} />)}
  </div>
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange(value: number): void }) {
  return <label className="grid gap-1 text-xs text-muted-foreground">{label}<Input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.currentTarget.value))} /></label>
}

function newItem(items: readonly ReaderRadialMenuItem[]): ReaderRadialMenuItem {
  const ids = items.flatMap(flatItemIds)
  return { id: uniqueId("item", ids), label: "新操作", action: "reader.next-page", slotIndex: nextSlot(items) }
}

function flatItemIds(item: ReaderRadialMenuItem): string[] {
  return [item.id, ...(item.children?.flatMap(flatItemIds) ?? [])]
}

function uniqueId(prefix: string, ids: readonly string[]): string {
  let index = ids.length + 1
  while (ids.includes(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function nextSlot(items: readonly ReaderRadialMenuItem[]): number {
  const used = new Set(items.map((item) => item.slotIndex))
  for (let index = 0; index < 64; index += 1) if (!used.has(index)) return index
  return 63
}

function clearMenuReferences(items: ReaderRadialMenuItem[], menuId: string): void {
  for (const item of items) {
    if (item.moveToMenuId === menuId) item.moveToMenuId = undefined
    if (item.children) clearMenuReferences(item.children, menuId)
  }
}
