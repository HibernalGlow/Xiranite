/**
 * DatabaseModule — Notion 式表格视图（基于 @tanstack/react-table）。
 *
 * 参考 sadmann7/tablecn 的 DataTable 架构：
 * - 列定义带 meta（variant: text/select/multiSelect）
 * - 列头用 DropdownMenu 切换 asc/desc/hide
 * - Toolbar 自动按列 variant 渲染筛选器
 * - 行选择 + actionBar
 *
 * 数据源：store.components，无需后端改动。
 */
import { useMemo, useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, EyeOff, Tag, X } from "lucide-react"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { useComponentData } from "@/hooks/useComponentData"
import { getModule } from "@/components/modules/registry"
import type { ModuleProps } from "./ModuleRenderer"
import type { ComponentInstance, ViewMode } from "@/types/workspace"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// ── 列 meta 类型 ─────────────────────────────────────────────────────────────
// 参考 tablecn 的 meta.variant：通过 module augmentation 给所有列的 meta 字段
// 提供类型支持，toolbar 可据此渲染不同 variant 的筛选器。
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData, TValue> {
    label: string
    variant?: "text" | "select" | "multiSelect"
    options?: { label: string; value: string }[]
  }
}

const VIEW_MODES: ViewMode[] = ["cards", "dockview", "flow", "lane"]

function formatTime(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

// ── 行类型：把 ComponentInstance + 计算字段组合成 row ────────────────────────
interface ComponentRow {
  id: string
  moduleId: string
  moduleName: string
  state: string
  visibilityCount: number
  visibilityIn: Record<ViewMode, boolean>
  tags: string[]
  createdAt: number
  dataKeys: number
  comp: ComponentInstance
}

interface DatabaseState {
  tagsByComponent?: Record<string, string[]>
}

export default function DatabaseModule({ compId }: ModuleProps) {
  const { visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()
  const [data, setData] = useComponentData<DatabaseState>(compId)
  const [tagInput, setTagInput] = useState<Record<string, string>>({})

  // 行数据
  const rows = useMemo<ComponentRow[]>(() => {
    return visibleComponents.map(comp => {
      const mod = getModule(comp.moduleId)
      const tags = data.tagsByComponent?.[comp.id] ?? []
      const visibilityIn = {
        cards: !comp.hiddenIn?.cards,
        dockview: !comp.hiddenIn?.dockview,
        flow: !comp.hiddenIn?.flow,
        lane: !comp.hiddenIn?.lane,
      }
      return {
        id: comp.id,
        moduleId: comp.moduleId,
        moduleName: mod?.name ?? comp.moduleId,
        state: comp.state,
        visibilityCount: VIEW_MODES.filter(m => visibilityIn[m]).length,
        visibilityIn,
        tags,
        createdAt: parseInt(comp.id.split("-").pop() ?? "0", 10),
        dataKeys: comp.data ? Object.keys(comp.data).length : 0,
        comp,
      }
    })
  }, [visibleComponents, data.tagsByComponent])

  // 表格状态
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [globalFilter, setGlobalFilter] = useState("")

  // ── 列定义 ────────────────────────────────────────────────────────────────
  const columns = useMemo<ColumnDef<ComponentRow, unknown>[]>(() => [
    {
      id: "select",
      size: 32,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected() ? "indeterminate" : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "moduleName",
      meta: { label: "Module", variant: "text" },
      header: ({ column }) => <ColumnHeader column={column} label="Module" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-semibold">{row.original.moduleName}</span>
          <span className="text-[9px] text-muted-foreground">{row.original.id}</span>
        </div>
      ),
    },
    {
      accessorKey: "state",
      meta: {
        label: "State",
        variant: "select",
        options: [
          { label: "docked", value: "docked" },
          { label: "focused", value: "focused" },
          { label: "fullscreen", value: "fullscreen" },
        ],
      },
      header: ({ column }) => <ColumnHeader column={column} label="State" />,
      cell: ({ row }) => (
        <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
          {row.original.state}
        </Badge>
      ),
    },
    {
      accessorKey: "visibilityCount",
      meta: { label: "Visible In" },
      header: ({ column }) => <ColumnHeader column={column} label="Visible In" />,
      cell: ({ row }) => {
        const vis = row.original.visibilityIn
        return (
          <div className="flex items-center gap-1">
            {VIEW_MODES.map(m => (
              <button
                key={m}
                onClick={() => dispatch(actions.toggleComponentVisibility(row.original.id, m))}
                title={`${m}: ${vis[m] ? "visible" : "hidden"}`}
                className={cn(
                  "h-5 w-5 grid place-items-center rounded border text-[8px] uppercase",
                  vis[m]
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/40 text-muted-foreground/40 hover:text-foreground"
                )}
              >
                {m.slice(0, 1)}
              </button>
            ))}
          </div>
        )
      },
    },
    {
      id: "tags",
      meta: { label: "Tags" },
      header: ({ column }) => <ColumnHeader column={column} label="Tags" />,
      cell: ({ row }) => {
        const tags = row.original.tags
        const inputVal = tagInput[row.original.id] ?? ""
        return (
          <div className="flex flex-wrap items-center gap-1">
            {tags.map(t => (
              <Badge key={t} variant="secondary" className="text-[9px] gap-0.5">
                <Tag className="h-2.5 w-2.5" />
                {t}
                <button
                  onClick={() => {
                    const next = { ...data.tagsByComponent, [row.original.id]: tags.filter(x => x !== t) }
                    setData({ tagsByComponent: next })
                  }}
                  className="hover:text-destructive ml-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            <input
              value={inputVal}
              onChange={(e) => setTagInput({ ...tagInput, [row.original.id]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  const text = inputVal.trim()
                  if (!text || tags.includes(text)) { setTagInput({ ...tagInput, [row.original.id]: "" }); return }
                  const next = { ...data.tagsByComponent, [row.original.id]: [...tags, text] }
                  setData({ tagsByComponent: next })
                  setTagInput({ ...tagInput, [row.original.id]: "" })
                }
                if (e.key === "Backspace" && !inputVal && tags.length > 0) {
                  const next = { ...data.tagsByComponent, [row.original.id]: tags.slice(0, -1) }
                  setData({ tagsByComponent: next })
                }
              }}
              placeholder="+ tag"
              className="bg-transparent text-[10px] outline-none w-16 placeholder:text-muted-foreground/60 focus:bg-background focus:px-1 focus:rounded focus:border focus:border-border/60"
            />
          </div>
        )
      },
    },
    {
      accessorKey: "createdAt",
      meta: { label: "Created" },
      header: ({ column }) => <ColumnHeader column={column} label="Created" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-[10px]">{formatTime(row.original.createdAt)}</span>
      ),
    },
    {
      accessorKey: "dataKeys",
      meta: { label: "Data Keys" },
      header: ({ column }) => <ColumnHeader column={column} label="Data" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-[10px]">{row.original.dataKeys} keys</span>
      ),
    },
  ], [data.tagsByComponent, dispatch, setData, tagInput])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const selectedRows = table.getFilteredSelectedRowModel().rows
  const allModules = useMemo(() => {
    const set = new Map<string, string>()
    rows.forEach(r => set.set(r.moduleId, r.moduleName))
    return Array.from(set, ([value, label]) => ({ value, label }))
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <p className="text-sm font-mono text-muted-foreground">// no components to display</p>
          <p className="text-[10px] font-mono text-muted-foreground/60">Deploy some modules first.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/20 flex-shrink-0">
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search all columns..."
          className="h-8 w-48 text-xs font-mono"
        />
        {/* 模块筛选（select variant） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Module: {String(table.getColumn("moduleName")?.getFilterValue() ?? "All")}
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => table.getColumn("moduleName")?.setFilterValue(undefined)}>
              All
            </DropdownMenuItem>
            {allModules.map(m => (
              <DropdownMenuItem
                key={m.value}
                onClick={() => table.getColumn("moduleName")?.setFilterValue(m.label)}
              >
                {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        <span className="text-[10px] font-mono text-muted-foreground">
          {rows.length} ROWS · {selectedRows.length} SELECTED
        </span>
      </div>

      {/* 表格主体 */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id} className="border-border/60">
                {headerGroup.headers.map(header => (
                  <TableHead key={header.id} colSpan={header.colSpan} className="h-9">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"} className="border-border/30">
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id} className="py-1.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border/40 bg-muted/20 flex-shrink-0 text-xs">
        <span className="font-mono text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Prev
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── 列头组件（带排序 + 隐藏菜单）─────────────────────────────────────────────
function ColumnHeader<TData, TValue>({
  column,
  label,
}: {
  column: import("@tanstack/react-table").Column<TData, TValue>
  label: string
}) {
  if (!column.getCanSort() && !column.getCanHide()) {
    return <div className="text-[10px] font-mono tracking-widest uppercase">{label}</div>
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "-ml-1.5 flex h-7 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted/60",
          "text-[10px] font-mono tracking-widest uppercase",
        )}
      >
        {label}
        {column.getCanSort() && (
          column.getIsSorted() === "desc" ? <ArrowDown className="h-3 w-3" />
          : column.getIsSorted() === "asc" ? <ArrowUp className="h-3 w-3" />
          : <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-28">
        {column.getCanSort() && (
          <>
            <DropdownMenuCheckboxItem
              checked={column.getIsSorted() === "asc"}
              onClick={() => column.toggleSorting(false)}
            >
              <ArrowUp className="h-3 w-3" /> Asc
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={column.getIsSorted() === "desc"}
              onClick={() => column.toggleSorting(true)}
            >
              <ArrowDown className="h-3 w-3" /> Desc
            </DropdownMenuCheckboxItem>
            {column.getIsSorted() && (
              <DropdownMenuItem onClick={() => column.clearSorting()}>
                <X className="h-3 w-3" /> Reset
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {column.getCanHide() && (
          <DropdownMenuCheckboxItem
            checked={!column.getIsVisible()}
            onClick={() => column.toggleVisibility(false)}
          >
            <EyeOff className="h-3 w-3" /> Hide
          </DropdownMenuCheckboxItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
