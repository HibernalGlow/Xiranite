import { useDeferredValue, useRef, useState } from "react"
import type { MouseEvent, PointerEvent, UIEvent } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown, ClipboardCopy, Copy, ExternalLink, FolderOpen, ListFilter, MousePointer2 } from "lucide-react"
import type { CzkawkaEntry, CzkawkaGroup, CzkawkaTool } from "@xiranite/node-czkawka/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { TableBody, TableCell, TableComponent, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { LocalImagePreview } from "@/nodes/shared/LocalImagePreview"

export type CzkawkaResultColumnId = "name" | "path" | "size" | "groupSize" | "modified" | "similarity" | "dimensions" | "title" | "artist" | "year" | "bitrate" | "length" | "target" | "error" | "currentExtension" | "properExtension"

export interface CzkawkaResultColumn {
  id: CzkawkaResultColumnId
  label: string
  align?: "right"
  value: (entry: CzkawkaEntry, group: CzkawkaGroup) => string | number
  display?: (entry: CzkawkaEntry, group: CzkawkaGroup) => string
}

const column = (id: CzkawkaResultColumnId, label: string, value: CzkawkaResultColumn["value"], display?: CzkawkaResultColumn["display"], align?: "right"): CzkawkaResultColumn => ({ id, label, value, display, align })
const NAME = column("name", "名称", (entry) => entry.name)
const PATH = column("path", "路径", (entry) => entry.path)
const SIZE = column("size", "大小", (entry) => entry.size, (entry) => formatBytes(entry.size), "right")
const GROUP_SIZE = column("groupSize", "组大小", (_entry, group) => group.totalBytes, (_entry, group) => formatBytes(group.totalBytes), "right")
const MODIFIED = column("modified", "修改时间", (entry) => entry.modifiedDate, (entry) => formatDate(entry.modifiedDate))
const SIMILARITY = column("similarity", "相似度", (entry) => numeric(entry.similarity), (entry) => entry.similarity || "—")
const DIMENSIONS = column("dimensions", "分辨率", (entry) => (entry.width ?? 0) * (entry.height ?? 0), (entry) => entry.width && entry.height ? `${entry.width}×${entry.height}` : "—")
const TITLE = column("title", "标题", (entry) => entry.title ?? "")
const ARTIST = column("artist", "艺术家", (entry) => entry.artist ?? "")
const YEAR = column("year", "年份", (entry) => numeric(entry.year))
const BITRATE = column("bitrate", "码率", (entry) => entry.bitrate ?? 0, (entry) => entry.bitrate ? `${entry.bitrate} kbps` : "—", "right")
const LENGTH = column("length", "时长", (entry) => numeric(entry.length), (entry) => entry.length || "—")
const TARGET = column("target", "目标路径", (entry) => entry.secondaryPath ?? "")
const ERROR = column("error", "错误类型", (entry) => entry.detail ?? "")
const CURRENT_EXTENSION = column("currentExtension", "当前扩展名", (entry) => extension(entry.name))
const PROPER_EXTENSION = column("properExtension", "正确扩展名", (entry) => entry.properExtension ?? "")

export const CZKAWKA_RESULT_COLUMNS: Record<CzkawkaTool, readonly CzkawkaResultColumn[]> = {
  "duplicate-files": [SIZE, GROUP_SIZE, NAME, PATH, MODIFIED],
  "empty-folders": [NAME, PATH, MODIFIED],
  "big-files": [SIZE, NAME, PATH, MODIFIED],
  "empty-files": [NAME, PATH, MODIFIED],
  "temporary-files": [NAME, PATH, MODIFIED],
  "similar-images": [SIMILARITY, SIZE, GROUP_SIZE, DIMENSIONS, NAME, PATH, MODIFIED],
  "similar-videos": [SIMILARITY, SIZE, GROUP_SIZE, DIMENSIONS, NAME, PATH, MODIFIED],
  "duplicate-music": [SIZE, GROUP_SIZE, NAME, TITLE, ARTIST, YEAR, BITRATE, LENGTH, PATH, MODIFIED],
  "invalid-symlinks": [NAME, PATH, TARGET, ERROR, MODIFIED],
  "broken-files": [NAME, PATH, ERROR, SIZE, MODIFIED],
  "bad-extensions": [NAME, PATH, CURRENT_EXTENSION, PROPER_EXTENSION, MODIFIED],
}

type SortState = { id: CzkawkaResultColumnId; descending: boolean }
type ColumnWidths = Partial<Record<CzkawkaResultColumnId, number>>
type ResultRowItem = { entry: CzkawkaEntry; group: CzkawkaGroup; indexInGroup: number }
type ResizeState = { tool: CzkawkaTool; id: CzkawkaResultColumnId; startX: number; startWidth: number }
type ViewportState = { scrollTop: number; height: number }
type GroupSelection = { paths: string[]; selected: boolean }
type BoxSelectionMode = "replace" | "add" | "remove"
type BoxSelectionState = { pointerId: number; startY: number; currentY: number; mode: BoxSelectionMode }

const SELECT_WIDTH = 44
const PREVIEW_WIDTH = 60
const GROUP_WIDTH = 68
const RESULT_ROW_HEIGHT = 52
const MIN_COLUMN_WIDTH = 72
const MAX_COLUMN_WIDTH = 640

export interface CzkawkaResultTableProps {
  tool: CzkawkaTool
  groups: CzkawkaGroup[]
  running: boolean
  selectedPaths: string[]
  getFileUrl?: (path: string) => string
  onCopyText?: (text: string) => Promise<void>
  onOpenPath?: (path: string) => Promise<void>
  onRevealPath?: (path: string) => Promise<void>
  onSelectionChange: (paths: string[]) => void
}

export function CzkawkaResultTable(props: CzkawkaResultTableProps) {
  const resizeRef = useRef<ResizeState | null>(null)
  const boxInitialSelectionRef = useRef<string[]>([])
  const [filters, setFilters] = useState<Partial<Record<CzkawkaTool, string>>>({})
  const [sorts, setSorts] = useState<Partial<Record<CzkawkaTool, SortState>>>({})
  const [anchors, setAnchors] = useState<Partial<Record<CzkawkaTool, string>>>({})
  const [widths, setWidths] = useState<Partial<Record<CzkawkaTool, ColumnWidths>>>({})
  const [viewports, setViewports] = useState<Partial<Record<CzkawkaTool, ViewportState>>>({})
  const [boxSelection, setBoxSelection] = useState<BoxSelectionState | null>(null)
  const filter = filters[props.tool] ?? ""
  const deferredFilter = useDeferredValue(filter)
  const sort = sorts[props.tool] ?? { id: defaultSort(props.tool), descending: false }
  const columns = CZKAWKA_RESULT_COLUMNS[props.tool]
  const visibleGroups = filterAndSortResultGroups(props.groups, columns, deferredFilter, sort)
  const rows = flattenResultRows(visibleGroups)
  const visibleEntries = selectableEntries(rows)
  const selectedSet = new Set(props.selectedPaths)
  const groupSelections = buildGroupSelections(visibleGroups, selectedSet)
  const toolWidths = widths[props.tool] ?? {}
  const gridTemplateColumns = [SELECT_WIDTH, PREVIEW_WIDTH, GROUP_WIDTH, ...columns.map((item) => toolWidths[item.id] ?? defaultColumnWidth(item.id))].map((width) => `${width}px`).join(" ")
  const tableWidth = SELECT_WIDTH + PREVIEW_WIDTH + GROUP_WIDTH + columns.reduce((total, item) => total + (toolWidths[item.id] ?? defaultColumnWidth(item.id)), 0)
  const viewport = viewports[props.tool] ?? { scrollTop: 0, height: 520 }
  const window = calculateVirtualWindow(rows.length, viewport.scrollTop, viewport.height, RESULT_ROW_HEIGHT, 8)
  const renderedRows = rows.slice(window.start, window.end).map((_row, offset) => ({ index: window.start + offset, start: (window.start + offset) * RESULT_ROW_HEIGHT }))

  function select(entry: CzkawkaEntry, checked: boolean, event: MouseEvent) {
    if (entry.isReference) return
    const mode = event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "replace"
    props.onSelectionChange(applyResultSelection(props.selectedPaths, visibleEntries, entry.path, checked, mode, anchors[props.tool]))
    setAnchors((current) => ({ ...current, [props.tool]: entry.path }))
  }

  function selectGroup(_group: CzkawkaGroup, selection: GroupSelection) {
    props.onSelectionChange(selection.selected ? props.selectedPaths.filter((path) => !selection.paths.includes(path)) : unique([...props.selectedPaths, ...selection.paths]))
  }

  function changeSort(id: CzkawkaResultColumnId) {
    setSorts((current) => ({ ...current, [props.tool]: current[props.tool]?.id === id ? { id, descending: !current[props.tool]!.descending } : { id, descending: false } }))
  }

  function startResize(event: PointerEvent<HTMLSpanElement>, id: CzkawkaResultColumnId) {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    resizeRef.current = { tool: props.tool, id, startX: event.clientX, startWidth: toolWidths[id] ?? defaultColumnWidth(id) }
  }

  function resizeColumn(event: PointerEvent<HTMLSpanElement>) {
    const active = resizeRef.current
    if (!active || active.tool !== props.tool) return
    const width = clamp(active.startWidth + event.clientX - active.startX, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH)
    setWidths((current) => ({ ...current, [props.tool]: { ...current[props.tool], [active.id]: width } }))
  }

  function finishResize(event: PointerEvent<HTMLSpanElement>) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId)
    resizeRef.current = null
  }

  function updateViewport(event: UIEvent<HTMLDivElement>) {
    const scrollTop = event.currentTarget.scrollTop
    const height = event.currentTarget.clientHeight || viewport.height
    setViewports((current) => ({ ...current, [props.tool]: { scrollTop, height } }))
  }

  function startBoxSelection(event: PointerEvent<HTMLTableSectionElement>) {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const y = event.clientY - event.currentTarget.getBoundingClientRect().top
    const mode: BoxSelectionMode = event.altKey ? "remove" : event.ctrlKey || event.metaKey || event.shiftKey ? "add" : "replace"
    boxInitialSelectionRef.current = props.selectedPaths
    setBoxSelection({ pointerId: event.pointerId, startY: y, currentY: y, mode })
  }

  function moveBoxSelection(event: PointerEvent<HTMLTableSectionElement>) {
    if (!boxSelection || boxSelection.pointerId !== event.pointerId) return
    const currentY = event.clientY - event.currentTarget.getBoundingClientRect().top
    setBoxSelection({ ...boxSelection, currentY })
    props.onSelectionChange(applyBoxSelection(boxInitialSelectionRef.current, rows, boxSelection.startY, currentY, RESULT_ROW_HEIGHT, boxSelection.mode))
  }

  function finishBoxSelection(event: PointerEvent<HTMLTableSectionElement>) {
    if (!boxSelection || boxSelection.pointerId !== event.pointerId) return
    const currentY = event.clientY - event.currentTarget.getBoundingClientRect().top
    props.onSelectionChange(applyBoxSelection(boxInitialSelectionRef.current, rows, boxSelection.startY, currentY, RESULT_ROW_HEIGHT, boxSelection.mode))
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId)
    setBoxSelection(null)
  }

  return <section className="flex min-h-0 flex-col rounded-md border bg-card" data-testid="czkawka-result-table" aria-busy={filter !== deferredFilter}><div className="flex items-center justify-between gap-2 border-b px-2 py-1.5"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]"><ListFilter className="size-3.5 text-primary" />结果组</div><Input aria-label="filter results" className="h-7 w-48 text-xs" placeholder="过滤当前工具结果" value={filter} onChange={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, [props.tool]: value })) }} /></div><div className="min-h-0 flex-1 overflow-auto" data-testid="czkawka-result-viewport" onScroll={updateViewport}><TableComponent className="grid text-xs" style={{ minWidth: tableWidth }}><TableHeader className="sticky top-0 z-10 grid bg-card"><TableRow className="grid" style={{ gridTemplateColumns }}><TableHead /><TableHead>预览</TableHead><TableHead>组</TableHead>{columns.map((item) => <TableHead key={item.id} className={cn("relative overflow-hidden", item.align === "right" && "text-right")} style={{ width: toolWidths[item.id] ?? defaultColumnWidth(item.id) }}><Button className="h-7 max-w-[calc(100%-6px)] px-1 text-xs" variant="ghost" onClick={() => changeSort(item.id)}>{item.label}{sort.id !== item.id ? <ChevronsUpDown className="size-3 opacity-40" /> : sort.descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}</Button><span role="separator" aria-label={`调整${item.label}列宽`} aria-orientation="vertical" className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none hover:bg-primary/40" onPointerDown={(event) => startResize(event, item.id)} onPointerMove={resizeColumn} onPointerUp={finishResize} onPointerCancel={finishResize} /></TableHead>)}</TableRow></TableHeader><TableBody className="relative grid select-none" style={{ height: rows.length * RESULT_ROW_HEIGHT }} onPointerDown={startBoxSelection} onPointerMove={moveBoxSelection} onPointerUp={finishBoxSelection} onPointerCancel={finishBoxSelection}>{renderedRows.map((virtualRow) => { const row = rows[virtualRow.index]!; return <VirtualResultRow key={row.entry.id} row={row} columns={columns} gridTemplateColumns={gridTemplateColumns} selectedSet={selectedSet} groupSelection={groupSelections.get(row.group)!} getFileUrl={props.getFileUrl} onCopyText={props.onCopyText} onOpenPath={props.onOpenPath} onRevealPath={props.onRevealPath} onSelect={select} onSelectGroup={selectGroup} start={virtualRow.start} /> })}{boxSelection ? <div data-testid="czkawka-selection-box" className="pointer-events-none absolute left-0 z-20 w-full border border-primary bg-primary/10" style={{ top: Math.min(boxSelection.startY, boxSelection.currentY), height: Math.abs(boxSelection.currentY - boxSelection.startY) }}><MousePointer2 className="size-3 text-primary" /></div> : null}</TableBody></TableComponent>{rows.length === 0 ? <div className="grid h-56 place-items-center text-xs text-muted-foreground">{props.running ? "正在分析文件…" : deferredFilter ? "没有匹配当前筛选的结果。" : "添加目录并开始扫描。"}</div> : null}</div></section>
}

function VirtualResultRow({ row, columns, gridTemplateColumns, selectedSet, groupSelection, getFileUrl, onCopyText, onOpenPath, onRevealPath, onSelect, onSelectGroup, start }: { row: ResultRowItem; columns: readonly CzkawkaResultColumn[]; gridTemplateColumns: string; selectedSet: Set<string>; groupSelection: GroupSelection; getFileUrl?: (path: string) => string; onCopyText?: (text: string) => Promise<void>; onOpenPath?: (path: string) => Promise<void>; onRevealPath?: (path: string) => Promise<void>; onSelect: (entry: CzkawkaEntry, checked: boolean, event: MouseEvent) => void; onSelectGroup: (group: CzkawkaGroup, selection: GroupSelection) => void; start: number }) {
  const { entry, group, indexInGroup } = row
  const selected = selectedSet.has(entry.path)
  return <ContextMenu><ContextMenuTrigger asChild><TableRow data-index={entry.id} data-state={selected ? "selected" : undefined} className="absolute left-0 grid w-full" style={{ gridTemplateColumns, height: RESULT_ROW_HEIGHT, transform: `translateY(${start}px)` }}><TableCell><Checkbox aria-label={`选择 ${entry.name}`} disabled={entry.isReference} checked={selected} onClick={(event) => { event.preventDefault(); onSelect(entry, !selected, event) }} /></TableCell><TableCell className="py-2"><LocalImagePreview path={entry.path} getFileUrl={getFileUrl} className="size-9" /></TableCell><TableCell><button className="flex items-center gap-1 font-mono" onClick={() => onSelectGroup(group, groupSelection)}><span className={cn("size-2 rounded-full", groupSelection.selected ? "bg-primary" : "bg-muted-foreground/40")} />{String(group.id + 1).padStart(2, "0")}{indexInGroup === 0 && group.entries.length > 1 ? <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px]">{group.entries.length}</Badge> : null}</button></TableCell>{columns.map((item) => <TableCell key={item.id} className={cn("min-w-0 truncate overflow-hidden", item.align === "right" && "text-right font-mono")} title={String(item.display?.(entry, group) ?? item.value(entry, group))}>{item.id === "path" ? <div className="flex min-w-0 items-center gap-1">{entry.isReference ? <Badge variant="secondary" className="h-4 px-1 text-[9px]">参考</Badge> : null}<span className="truncate font-mono">{entry.path}</span></div> : item.display?.(entry, group) ?? String(item.value(entry, group) || "—")}</TableCell>)}</TableRow></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={groupSelection.selected} onSelect={() => onSelectGroup(group, { ...groupSelection, selected: false })}>选中该组</ContextMenuItem><ContextMenuItem disabled={!groupSelection.selected} onSelect={() => onSelectGroup(group, { ...groupSelection, selected: true })}>取消选中该组</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem disabled={!onCopyText} onSelect={() => void onCopyText?.(entry.path)}><Copy />复制路径</ContextMenuItem><ContextMenuItem disabled={!onCopyText} onSelect={() => void onCopyText?.(entry.name)}><ClipboardCopy />复制名称</ContextMenuItem><ContextMenuItem disabled title="当前宿主暂不支持复制本地文件对象"><ClipboardCopy />复制文件（暂不支持）</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem disabled={!onOpenPath} onSelect={() => void onOpenPath?.(entry.path)}><ExternalLink />打开</ContextMenuItem><ContextMenuItem disabled={!onRevealPath} onSelect={() => void onRevealPath?.(entry.path)}><FolderOpen />在文件管理器中定位</ContextMenuItem></ContextMenuContent></ContextMenu>
}

export function flattenResultRows(groups: CzkawkaGroup[]): ResultRowItem[] {
  return groups.flatMap((group) => group.entries.map((entry, indexInGroup) => ({ entry, group, indexInGroup })))
}

function selectableEntries(rows: ResultRowItem[]): CzkawkaEntry[] {
  const entries: CzkawkaEntry[] = []
  for (const row of rows) if (!row.entry.isReference) entries.push(row.entry)
  return entries
}

function buildGroupSelections(groups: CzkawkaGroup[], selected: Set<string>): Map<CzkawkaGroup, GroupSelection> {
  const selections = new Map<CzkawkaGroup, GroupSelection>()
  for (const group of groups) {
    const paths: string[] = []
    let allSelected = true
    for (const entry of group.entries) {
      if (entry.isReference) continue
      paths.push(entry.path)
      if (!selected.has(entry.path)) allSelected = false
    }
    selections.set(group, { paths, selected: paths.length > 0 && allSelected })
  }
  return selections
}

export function calculateVirtualWindow(count: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan: number): { start: number; end: number } {
  const start = clamp(Math.floor(scrollTop / rowHeight) - overscan, 0, count)
  const end = clamp(Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan, start, count)
  return { start, end }
}

export function applyResultSelection(current: string[], visible: CzkawkaEntry[], path: string, checked: boolean, mode: "replace" | "toggle" | "range", anchor?: string): string[] {
  if (mode === "replace") return checked ? [path] : []
  if (mode === "toggle") return checked ? unique([...current, path]) : current.filter((item) => item !== path)
  const start = anchor ? visible.findIndex((entry) => entry.path === anchor) : -1
  const end = visible.findIndex((entry) => entry.path === path)
  if (start < 0 || end < 0) return checked ? unique([...current, path]) : current.filter((item) => item !== path)
  const range = visible.slice(Math.min(start, end), Math.max(start, end) + 1).map((entry) => entry.path)
  return checked ? unique([...current, ...range]) : current.filter((item) => !range.includes(item))
}

export function applyBoxSelection(current: string[], rows: ResultRowItem[], startY: number, endY: number, rowHeight: number, mode: BoxSelectionMode): string[] {
  if (rows.length === 0 || rowHeight <= 0) return mode === "replace" ? [] : current
  const top = Math.max(0, Math.min(startY, endY))
  const bottom = Math.max(0, Math.max(startY, endY))
  const startIndex = clamp(Math.floor(top / rowHeight), 0, rows.length - 1)
  const endIndex = clamp(Math.floor(Math.max(top, bottom - 0.001) / rowHeight), startIndex, rows.length - 1)
  const paths = rows.slice(startIndex, endIndex + 1).filter((row) => !row.entry.isReference).map((row) => row.entry.path)
  if (mode === "replace") return unique(paths)
  if (mode === "add") return unique([...current, ...paths])
  const removed = new Set(paths)
  return current.filter((path) => !removed.has(path))
}

export function filterAndSortResultGroups(groups: CzkawkaGroup[], columns: readonly CzkawkaResultColumn[], filter: string, sort: SortState): CzkawkaGroup[] {
  const needle = filter.trim().toLocaleLowerCase()
  const sortColumn = columns.find((item) => item.id === sort.id) ?? columns[0]!
  return groups.map((group) => ({ ...group, entries: group.entries.filter((entry) => !needle || columns.some((item) => String(item.display?.(entry, group) ?? item.value(entry, group)).toLocaleLowerCase().includes(needle))).toSorted((left, right) => { const a = sortColumn.value(left, group); const b = sortColumn.value(right, group); const compared = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }); return sort.descending ? -compared : compared }) })).filter((group) => group.entries.length > 0)
}

function defaultColumnWidth(id: CzkawkaResultColumnId): number {
  if (id === "path" || id === "target") return 320
  if (id === "name" || id === "title" || id === "artist" || id === "error") return 160
  if (id === "modified") return 176
  if (id === "currentExtension" || id === "properExtension") return 132
  return 104
}

function defaultSort(tool: CzkawkaTool): CzkawkaResultColumnId { return tool === "big-files" ? "size" : "path" }
function extension(name: string): string { const index = name.lastIndexOf("."); return index > 0 ? name.slice(index + 1) : "" }
function numeric(value: string | undefined): number { const parsed = Number.parseFloat(value ?? ""); return Number.isFinite(parsed) ? parsed : 0 }
function unique(values: string[]): string[] { return [...new Set(values)] }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }
function formatDate(value: number): string { if (!value) return "—"; const milliseconds = value < 10_000_000_000 ? value * 1000 : value; return new Date(milliseconds).toLocaleString() }
function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; const units = ["KB", "MB", "GB", "TB"]; let value = bytes / 1024; let unit = units[0]!; for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]! } return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}` }
function isInteractiveTarget(target: EventTarget | null): boolean { return target instanceof Element && Boolean(target.closest("button, input, a, [role=checkbox], [role=menu], [role=menuitem], [data-no-box-select]")) }
