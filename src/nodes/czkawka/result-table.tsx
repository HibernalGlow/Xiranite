import { useState } from "react"
import type { MouseEvent } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown, ListFilter } from "lucide-react"
import type { CzkawkaEntry, CzkawkaGroup, CzkawkaTool } from "@xiranite/node-czkawka/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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

export interface CzkawkaResultTableProps {
  tool: CzkawkaTool
  groups: CzkawkaGroup[]
  running: boolean
  selectedPaths: string[]
  getFileUrl?: (path: string) => string
  onSelectionChange: (paths: string[]) => void
}

export function CzkawkaResultTable(props: CzkawkaResultTableProps) {
  "use no memo"
  const [filters, setFilters] = useState<Partial<Record<CzkawkaTool, string>>>({})
  const [sorts, setSorts] = useState<Partial<Record<CzkawkaTool, SortState>>>({})
  const [anchors, setAnchors] = useState<Partial<Record<CzkawkaTool, string>>>({})
  const filter = filters[props.tool] ?? ""
  const sort = sorts[props.tool] ?? { id: defaultSort(props.tool), descending: false }
  const columns = CZKAWKA_RESULT_COLUMNS[props.tool]
  const visibleGroups = filterAndSortResultGroups(props.groups, columns, filter, sort)
  const visibleEntries = visibleGroups.flatMap((group) => group.entries).filter((entry) => !entry.isReference)

  function select(entry: CzkawkaEntry, checked: boolean, event: MouseEvent) {
    if (entry.isReference) return
    const mode = event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "replace"
    props.onSelectionChange(applyResultSelection(props.selectedPaths, visibleEntries, entry.path, checked, mode, anchors[props.tool]))
    setAnchors((current) => ({ ...current, [props.tool]: entry.path }))
  }

  function selectGroup(group: CzkawkaGroup) {
    const paths = group.entries.filter((entry) => !entry.isReference).map((entry) => entry.path)
    const selected = paths.length > 0 && paths.every((path) => props.selectedPaths.includes(path))
    props.onSelectionChange(selected ? props.selectedPaths.filter((path) => !paths.includes(path)) : unique([...props.selectedPaths, ...paths]))
  }

  function changeSort(id: CzkawkaResultColumnId) {
    setSorts((current) => ({ ...current, [props.tool]: current[props.tool]?.id === id ? { id, descending: !current[props.tool]!.descending } : { id, descending: false } }))
  }

  return <section className="flex min-h-0 flex-col rounded-md border bg-card" data-testid="czkawka-result-table"><div className="flex items-center justify-between gap-2 border-b px-2 py-1.5"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]"><ListFilter className="size-3.5 text-primary" />结果组</div><Input aria-label="filter results" className="h-7 w-48 text-xs" placeholder="过滤当前工具结果" value={filter} onChange={(event) => setFilters((current) => ({ ...current, [props.tool]: event.currentTarget.value }))} /></div><ScrollArea className="min-h-0 flex-1"><Table className="text-xs"><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-10" /><TableHead className="w-12">预览</TableHead><TableHead className="w-16">组</TableHead>{columns.map((item) => <TableHead key={item.id} className={cn(item.align === "right" && "text-right")}><Button className="h-7 px-1 text-xs" variant="ghost" onClick={() => changeSort(item.id)}>{item.label}{sort.id !== item.id ? <ChevronsUpDown className="size-3 opacity-40" /> : sort.descending ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}</Button></TableHead>)}</TableRow></TableHeader><TableBody>{visibleGroups.length ? visibleGroups.flatMap((group) => group.entries.map((entry, index) => { const selected = props.selectedPaths.includes(entry.path); const selectable = group.entries.filter((item) => !item.isReference); const groupSelected = selectable.length > 0 && selectable.every((item) => props.selectedPaths.includes(item.path)); return <TableRow key={entry.id} data-state={selected ? "selected" : undefined}><TableCell><Checkbox aria-label={`选择 ${entry.name}`} disabled={entry.isReference} checked={selected} onClick={(event) => { event.preventDefault(); select(entry, !selected, event) }} /></TableCell><TableCell><LocalImagePreview path={entry.path} getFileUrl={props.getFileUrl} className="size-9" /></TableCell><TableCell><button className="flex items-center gap-1 font-mono" onClick={() => selectGroup(group)}><span className={cn("size-2 rounded-full", groupSelected ? "bg-primary" : "bg-muted-foreground/40")} />{String(group.id + 1).padStart(2, "0")}{index === 0 && group.entries.length > 1 ? <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px]">{group.entries.length}</Badge> : null}</button></TableCell>{columns.map((item) => <TableCell key={item.id} className={cn("max-w-72 truncate", item.align === "right" && "text-right font-mono")} title={String(item.display?.(entry, group) ?? item.value(entry, group))}>{item.id === "path" ? <div className="flex items-center gap-1">{entry.isReference ? <Badge variant="secondary" className="h-4 px-1 text-[9px]">参考</Badge> : null}<span className="truncate font-mono">{entry.path}</span></div> : item.display?.(entry, group) ?? String(item.value(entry, group) || "—")}</TableCell>)}</TableRow> })) : <TableRow><TableCell colSpan={columns.length + 3} className="h-56 text-center text-muted-foreground">{props.running ? "正在分析文件…" : filter ? "没有匹配当前筛选的结果。" : "添加目录并开始扫描。"}</TableCell></TableRow>}</TableBody></Table></ScrollArea></section>
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

export function filterAndSortResultGroups(groups: CzkawkaGroup[], columns: readonly CzkawkaResultColumn[], filter: string, sort: SortState): CzkawkaGroup[] {
  const needle = filter.trim().toLocaleLowerCase()
  const sortColumn = columns.find((item) => item.id === sort.id) ?? columns[0]!
  return groups.map((group) => ({ ...group, entries: group.entries.filter((entry) => !needle || columns.some((item) => String(item.display?.(entry, group) ?? item.value(entry, group)).toLocaleLowerCase().includes(needle))).toSorted((left, right) => { const a = sortColumn.value(left, group); const b = sortColumn.value(right, group); const compared = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }); return sort.descending ? -compared : compared }) })).filter((group) => group.entries.length > 0)
}

function defaultSort(tool: CzkawkaTool): CzkawkaResultColumnId { return tool === "big-files" ? "size" : "path" }
function extension(name: string): string { const index = name.lastIndexOf("."); return index > 0 ? name.slice(index + 1) : "" }
function numeric(value: string | undefined): number { const parsed = Number.parseFloat(value ?? ""); return Number.isFinite(parsed) ? parsed : 0 }
function unique(values: string[]): string[] { return [...new Set(values)] }
function formatDate(value: number): string { if (!value) return "—"; const milliseconds = value < 10_000_000_000 ? value * 1000 : value; return new Date(milliseconds).toLocaleString() }
function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; const units = ["KB", "MB", "GB", "TB"]; let value = bytes / 1024; let unit = units[0]!; for (let index = 1; index < units.length && value >= 1024; index += 1) { value /= 1024; unit = units[index]! } return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}` }
