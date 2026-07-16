import type { ColumnOrderState, ColumnSizingState, RowSelectionState, Updater, VisibilityState } from "@tanstack/react-table"
import { File, Folder } from "lucide-react"
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react"

import { DataTableColumnActions } from "@/components/niko-table/components/data-table-column-actions"
import { DataTableColumnDndProvider } from "@/components/niko-table/components/data-table-column-dnd"
import { DataTableColumnHeader } from "@/components/niko-table/components/data-table-column-header"
import { DataTableColumnPinOptions } from "@/components/niko-table/components/data-table-column-pin"
import { DataTableViewMenu } from "@/components/niko-table/components/data-table-view-menu"
import { DataTable } from "@/components/niko-table/core/data-table"
import { DataTableDndHeader } from "@/components/niko-table/core/data-table-dnd-structure"
import { DataTableRoot } from "@/components/niko-table/core/data-table-root"
import {
  DataTableVirtualizedBody,
} from "@/components/niko-table/core/data-table-virtualized-structure"
import type { DataTableColumnDef } from "@/components/niko-table/types"

import { READER_FOLDER_DETAIL_DEFAULT_WIDTHS, type ReaderDirectoryEntryDto, type ReaderFolderDetailColumn, type ReaderFolderDetailsConfig } from "../../../../adapters/reader-http-client"
import type { DirectoryCatalog } from "./DirectoryCatalog"
import { directoryEntryAt } from "./DirectoryCatalog"

interface DirectoryDetailsRow {
  index: number
  entry: ReaderDirectoryEntryDto
}

interface FolderDetailsViewProps {
  catalog: DirectoryCatalog
  disabled: boolean
  selectedPaths: ReadonlySet<string>
  initialIndex?: number
  layout: ReaderFolderDetailsConfig
  onRangeChange(range: { startIndex: number; endIndex: number }): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
  onActivate(entry: ReaderDirectoryEntryDto): void
  onLayoutChange(patch: Partial<ReaderFolderDetailsConfig>): void
}

const DETAIL_COLUMN_IDS: readonly ReaderFolderDetailColumn[] = ["name", "path", "type", "extension", "size", "modifiedAt", "dimensions", "pageCount", "rating", "tags"]
const DETAILS_COLUMNS: DataTableColumnDef<DirectoryDetailsRow>[] = [
  {
    id: "name",
    accessorFn: (row) => row.entry.name,
    size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.name,
    header: () => <DetailColumnHeader label="名称" />,
    enableHiding: false,
    cell: ({ row }) => {
      const entry = row.original.entry
      return (
        <div className="flex min-w-0 items-center gap-2" title={entry.path}>
          {entry.kind === "directory"
            ? <Folder className="size-4 shrink-0 text-amber-500" />
            : <File className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate text-xs font-medium">{entry.name}</span>
        </div>
      )
    },
    meta: { label: "名称" },
  },
  { id: "path", accessorFn: (row) => row.entry.path, size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.path, header: () => <DetailColumnHeader label="路径" />, cell: ({ row }) => <DetailText value={row.original.entry.path} mono />, meta: { label: "路径" } },
  { id: "type", accessorFn: (row) => entryType(row.entry), size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.type, header: () => <DetailColumnHeader label="类型" />, cell: ({ row }) => <DetailText value={entryType(row.original.entry)} />, meta: { label: "类型" } },
  { id: "extension", accessorFn: (row) => fileExtension(row.entry), size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.extension, header: () => <DetailColumnHeader label="扩展名" />, cell: ({ row }) => <DetailText value={fileExtension(row.original.entry)} mono />, meta: { label: "扩展名" } },
  { id: "size", accessorFn: (row) => row.entry.size, size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.size, header: () => <DetailColumnHeader label="大小" />, cell: ({ row }) => <DetailText value={formatBytes(row.original.entry.size)} align="right" mono />, meta: { label: "大小" } },
  { id: "modifiedAt", accessorFn: (row) => row.entry.modifiedAt, size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.modifiedAt, header: () => <DetailColumnHeader label="修改时间" />, cell: ({ row }) => <DetailText value={formatDate(row.original.entry.modifiedAt)} mono />, meta: { label: "修改时间" } },
  { id: "dimensions", accessorFn: (row) => formatDimensions(row.entry), size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.dimensions, header: () => <DetailColumnHeader label="尺寸" />, cell: ({ row }) => <DetailText value={formatDimensions(row.original.entry)} align="right" mono />, meta: { label: "尺寸" } },
  { id: "pageCount", accessorFn: (row) => row.entry.pageCount, size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.pageCount, header: () => <DetailColumnHeader label="页数" />, cell: ({ row }) => <DetailText value={formatNumber(row.original.entry.pageCount)} align="right" mono />, meta: { label: "页数" } },
  { id: "rating", accessorFn: (row) => row.entry.rating, size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.rating, header: () => <DetailColumnHeader label="评分" />, cell: ({ row }) => <DetailText value={formatRating(row.original.entry.rating)} align="right" mono />, meta: { label: "评分" } },
  { id: "tags", accessorFn: (row) => formatTags(row.entry), size: READER_FOLDER_DETAIL_DEFAULT_WIDTHS.tags, header: () => <DetailColumnHeader label="标签" />, cell: ({ row }) => <DetailText value={formatTags(row.original.entry)} />, meta: { label: "标签" } },
].map((column) => ({ ...column, minSize: 48, maxSize: 800 }))

export default function FolderDetailsView({
  catalog,
  disabled,
  selectedPaths,
  initialIndex,
  layout,
  onRangeChange,
  onSelect,
  onActivate,
  onLayoutChange,
}: FolderDetailsViewProps) {
  const rows = useMemo(() => loadedRows(catalog), [catalog.pages])
  const rowSelection = useMemo(() => folderDetailsRowSelection(rows, selectedPaths), [rows, selectedPaths])
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(layout.columnOrder)
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => visibilityFromLayout(layout))
  const [columnPinning, setColumnPinning] = useState(() => ({ left: layout.pinnedLeft, right: layout.pinnedRight }))
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(layout.columnWidths)

  useEffect(() => setColumnOrder(layout.columnOrder), [layout.columnOrder])
  useEffect(() => setColumnVisibility(visibilityFromLayout(layout)), [layout.hiddenColumns])
  useEffect(() => setColumnPinning({ left: layout.pinnedLeft, right: layout.pinnedRight }), [layout.pinnedLeft, layout.pinnedRight])
  useEffect(() => setColumnSizing(layout.columnWidths), [layout.columnWidths])

  function updateColumnOrder(updater: Updater<ColumnOrderState>) {
    const next = resolveUpdater(updater, columnOrder)
    setColumnOrder(next)
    onLayoutChange({ columnOrder: next as ReaderFolderDetailColumn[] })
  }

  function updateColumnVisibility(updater: Updater<VisibilityState>) {
    const next = { ...resolveUpdater(updater, columnVisibility), name: true }
    setColumnVisibility(next)
    onLayoutChange({ hiddenColumns: DETAIL_COLUMN_IDS.filter((id) => next[id] === false) })
  }

  function updateColumnPinning(updater: Updater<{ left: string[]; right: string[] }>) {
    const next = resolveUpdater(updater, columnPinning)
    const left = DETAIL_COLUMN_IDS.filter((id) => next.left.includes(id))
    const right = DETAIL_COLUMN_IDS.filter((id) => next.right.includes(id) && !left.includes(id))
    setColumnPinning({ left, right })
    onLayoutChange({ pinnedLeft: left, pinnedRight: right })
  }

  function updateColumnSizing(updater: Updater<ColumnSizingState>) {
    const next = resolveUpdater(updater, columnSizing)
    const bounded = Object.fromEntries(DETAIL_COLUMN_IDS.map((id) => [
      id,
      Math.min(800, Math.max(48, Math.round(next[id] ?? READER_FOLDER_DETAIL_DEFAULT_WIDTHS[id]))),
    ])) as Record<ReaderFolderDetailColumn, number>
    setColumnSizing(bounded)
    onLayoutChange({ columnWidths: bounded })
  }

  return (
    <div
      className="h-72 min-w-0"
      data-testid="folder-details-host"
      data-neoview-folder-details="true"
      data-table-engine="niko-sparse"
      data-loaded-rows={rows.length}
      data-total-rows={catalog.total}
    >
      <DataTableRoot<DirectoryDetailsRow, unknown>
        columns={DETAILS_COLUMNS}
        data={rows}
        className="h-full space-y-0"
        getRowId={(row) => row.entry.path}
        config={{
          enableFilters: false,
          enablePagination: false,
          enableRowSelection: true,
          enableSorting: false,
          manualFiltering: true,
          manualSorting: true,
        }}
        state={{ rowSelection, columnOrder, columnVisibility, columnPinning, columnSizing }}
        onColumnOrderChange={updateColumnOrder}
        onColumnVisibilityChange={updateColumnVisibility}
        onColumnPinningChange={updateColumnPinning}
        onColumnSizingChange={updateColumnSizing}
        columnResizeMode="onEnd"
      >
        <div className="flex h-8 items-center border-b px-1">
          <DataTableViewMenu
            className="ml-0 flex h-7 text-xs"
            lockedColumnIds={["name"]}
            triggerLabel="列"
            triggerAriaLabel="管理详细信息列"
            searchPlaceholder="搜索列…"
            emptyLabel="没有匹配的列"
            resetLabel="恢复默认列"
            onReset={() => {
              setColumnOrder([...DETAIL_COLUMN_IDS])
              setColumnVisibility({ name: true })
              setColumnPinning({ left: ["name"], right: [] })
              setColumnSizing(READER_FOLDER_DETAIL_DEFAULT_WIDTHS)
              onLayoutChange({ columnOrder: [...DETAIL_COLUMN_IDS], hiddenColumns: [], pinnedLeft: ["name"], pinnedRight: [], columnWidths: READER_FOLDER_DETAIL_DEFAULT_WIDTHS })
            }}
          />
        </div>
        <DataTableColumnDndProvider columnOrder={columnOrder} onColumnOrderChange={updateColumnOrder}>
          <DataTable height="calc(100% - 2rem)" className="h-[calc(100%_-_2rem)] rounded-none border-0">
            <DataTableDndHeader resizable />
            <DataTableVirtualizedBody
              estimateSize={36}
              overscan={12}
              initialViewportHeight={256}
              useColumnSizing
              totalCount={catalog.total}
              initialIndex={initialIndex}
              getVirtualRowId={(index) => directoryEntryAt(catalog, index)?.path}
              onRangeChange={onRangeChange}
              onRowClick={(row, event) => { if (!disabled) onSelect(row.entry, row.index, event) }}
              onRowDoubleClick={(row) => { if (!disabled) onActivate(row.entry) }}
            />
          </DataTable>
        </DataTableColumnDndProvider>
      </DataTableRoot>
    </div>
  )
}

export function folderDetailsRowSelection(
  rows: readonly { entry: ReaderDirectoryEntryDto }[],
  selectedPaths: ReadonlySet<string>,
): RowSelectionState {
  const selected: RowSelectionState = {}
  for (const row of rows) if (selectedPaths.has(row.entry.path)) selected[row.entry.path] = true
  return selected
}

function DetailColumnHeader({ label }: { label: string }) {
  return (
    <DataTableColumnHeader>
      <span className="truncate">{label}</span>
      <DataTableColumnActions>
        <DataTableColumnPinOptions />
      </DataTableColumnActions>
    </DataTableColumnHeader>
  )
}

function visibilityFromLayout(layout: ReaderFolderDetailsConfig): VisibilityState {
  return Object.fromEntries(DETAIL_COLUMN_IDS.map((id) => [id, !layout.hiddenColumns.includes(id)]))
}

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function" ? updater(current) : updater
}

function loadedRows(catalog: DirectoryCatalog): DirectoryDetailsRow[] {
  const rows: DirectoryDetailsRow[] = []
  for (const [cursor, entries] of catalog.pages) {
    for (let offset = 0; offset < entries.length; offset += 1) {
      rows.push({ index: cursor + offset, entry: entries[offset]! })
    }
  }
  return rows.toSorted((left, right) => left.index - right.index)
}

function DetailText({ value, align = "left", mono = false }: { value: string; align?: "left" | "right"; mono?: boolean }) {
  return <div className={`${align === "right" ? "text-right" : "text-left"} truncate text-xs text-muted-foreground ${mono ? "font-mono tabular-nums" : ""}`} title={value}>{value}</div>
}

function entryType(entry: ReaderDirectoryEntryDto): string {
  if (entry.kind === "directory") return "文件夹"
  if (entry.kind === "file") return entry.readerSupported ? "可阅读文件" : "文件"
  return "其他"
}

function fileExtension(entry: ReaderDirectoryEntryDto): string {
  if (entry.kind !== "file") return "-"
  const dot = entry.name.lastIndexOf(".")
  return dot > 0 && dot < entry.name.length - 1 ? entry.name.slice(dot + 1).toLocaleUpperCase() : "-"
}

function formatBytes(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-"
  if (value! < 1024) return `${value} B`
  if (value! < 1024 ** 2) return `${(value! / 1024).toFixed(1)} KiB`
  if (value! < 1024 ** 3) return `${(value! / 1024 ** 2).toFixed(1)} MiB`
  return `${(value! / 1024 ** 3).toFixed(2)} GiB`
}

function formatDate(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-"
  return new Date(value!).toLocaleString()
}

function formatDimensions(entry: ReaderDirectoryEntryDto): string {
  return Number.isFinite(entry.width) && Number.isFinite(entry.height) ? `${entry.width}x${entry.height}` : "-"
}

function formatNumber(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : "-"
}

function formatRating(value: number | undefined): string {
  return Number.isFinite(value) ? value!.toFixed(1) : "-"
}

function formatTags(entry: ReaderDirectoryEntryDto): string {
  if (entry.tags?.length) return entry.tags.join(" / ")
  if (Number.isFinite(entry.collectTagCount)) return `${entry.collectTagCount} 个收藏标签`
  return "-"
}
