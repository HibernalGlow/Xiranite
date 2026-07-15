import type { RowSelectionState } from "@tanstack/react-table"
import { File, Folder } from "lucide-react"
import { useMemo, type MouseEvent as ReactMouseEvent } from "react"

import { DataTable } from "@/components/niko-table/core/data-table"
import { DataTableRoot } from "@/components/niko-table/core/data-table-root"
import {
  DataTableVirtualizedBody,
  DataTableVirtualizedHeader,
} from "@/components/niko-table/core/data-table-virtualized-structure"
import type { DataTableColumnDef } from "@/components/niko-table/types"

import type { ReaderDirectoryEntryDto } from "../../../../adapters/reader-http-client"
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
  onRangeChange(range: { startIndex: number; endIndex: number }): void
  onSelect(entry: ReaderDirectoryEntryDto, index: number, event: ReactMouseEvent): void
  onActivate(entry: ReaderDirectoryEntryDto): void
}

const DETAILS_COLUMNS: DataTableColumnDef<DirectoryDetailsRow>[] = [
  {
    id: "name",
    size: 220,
    header: "名称",
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
  { id: "path", size: 280, header: "路径", cell: ({ row }) => <DetailText value={row.original.entry.path} mono /> },
  { id: "type", size: 80, header: "类型", cell: ({ row }) => <DetailText value={entryType(row.original.entry)} /> },
  { id: "extension", size: 80, header: "扩展名", cell: ({ row }) => <DetailText value={fileExtension(row.original.entry)} mono /> },
  { id: "size", size: 96, header: "大小", cell: ({ row }) => <DetailText value={formatBytes(row.original.entry.size)} align="right" mono /> },
  { id: "modifiedAt", size: 152, header: "修改时间", cell: ({ row }) => <DetailText value={formatDate(row.original.entry.modifiedAt)} mono /> },
  { id: "dimensions", size: 96, header: "尺寸", cell: ({ row }) => <DetailText value={formatDimensions(row.original.entry)} align="right" mono /> },
  { id: "pageCount", size: 72, header: "页数", cell: ({ row }) => <DetailText value={formatNumber(row.original.entry.pageCount)} align="right" mono /> },
  { id: "rating", size: 72, header: "评分", cell: ({ row }) => <DetailText value={formatRating(row.original.entry.rating)} align="right" mono /> },
  { id: "tags", size: 180, header: "标签", cell: ({ row }) => <DetailText value={formatTags(row.original.entry)} /> },
]

export default function FolderDetailsView({
  catalog,
  disabled,
  selectedPaths,
  initialIndex,
  onRangeChange,
  onSelect,
  onActivate,
}: FolderDetailsViewProps) {
  const rows = useMemo(() => loadedRows(catalog), [catalog.pages])
  const rowSelection = useMemo<RowSelectionState>(() => {
    const selected: RowSelectionState = {}
    for (const row of rows) if (selectedPaths.has(row.entry.path)) selected[row.entry.path] = true
    return selected
  }, [rows, selectedPaths])

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
        getRowId={(row) => row.entry.path}
        config={{
          enableFilters: false,
          enablePagination: false,
          enableRowSelection: true,
          enableSorting: false,
          manualFiltering: true,
          manualSorting: true,
        }}
        state={{ rowSelection }}
        initialState={{ columnPinning: { left: ["name"] } }}
      >
        <DataTable height="100%" className="h-full rounded-none border-0">
          <DataTableVirtualizedHeader />
          <DataTableVirtualizedBody
            estimateSize={36}
            overscan={12}
            initialViewportHeight={288}
            totalCount={catalog.total}
            initialIndex={initialIndex}
            getVirtualRowId={(index) => directoryEntryAt(catalog, index)?.path}
            onRangeChange={onRangeChange}
            onRowClick={(row, event) => { if (!disabled) onSelect(row.entry, row.index, event) }}
            onRowDoubleClick={(row) => { if (!disabled) onActivate(row.entry) }}
          />
        </DataTable>
      </DataTableRoot>
    </div>
  )
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
