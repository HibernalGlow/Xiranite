/**
 * DatabaseModule — Notion 式表格视图（基于 @tanstack/react-table + tablecn 组件）。
 *
 * 实现要点：
 * 1. 数据源同 store.components — 与卡片注册 / CardView / DockviewView / FlowView / LaneView
 *    共享同一份 ComponentInstance[]。不再在 comp.data 内维护单独的 tagsByComponent map。
 * 2. 直接复用 tablecn 的官方组件（src/components/data-table/*）：
 *    - <DataTable>            表格主体 + 分页 + actionBar
 *    - <DataTableToolbar>      按 meta.variant 自动渲染 text/select/multiSelect 筛选器
 *    - <DataTableColumnHeader> 列头排序 + 隐藏菜单
 * 3. tags 直接挂到 ComponentInstance.tags（store action: SET_COMPONENT_TAGS），
 *    与所有 viewMode 共享，跨会话持久化。
 *
 * 参考：https://github.com/sadmann7/tablecn
 */
import * as React from "react"
import {
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
import { Ellipsis, Eye, EyeOff, Tag, X } from "lucide-react"

import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { getModule, MODULE_REGISTRY } from "@/components/modules/registry"
import type { ModuleProps } from "./ModuleRenderer"
import type { ComponentInstance, ViewMode } from "@/types/workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const VIEW_MODES: ViewMode[] = ["cards", "dockview", "flow", "lane"]

function formatTime(ts: number): string {
  if (!ts || Number.isNaN(ts)) return "—"
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

// 从 comp-${counter}-${timestamp} 解析部署时间戳
function parseCreatedAt(id: string): number {
  const parts = id.split("-")
  const last = parts[parts.length - 1]
  const n = Number(last)
  return Number.isFinite(n) ? n : 0
}

// ── 列定义 ─────────────────────────────────────────────────────────────────
// 参考 tablecn 的 getTasksTableColumns 模式：每列带 meta.variant 让 toolbar 自动渲染筛选器。
function useDatabaseColumns(): ColumnDef<ComponentInstance>[] {
  const dispatch = useWSDispatch()
  const [tagInput, setTagInput] = React.useState<Record<string, string>>({})

  return React.useMemo(() => [
    {
      id: "select",
      size: 32,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all"
          className="translate-y-0.5"
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          className="translate-y-0.5"
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: "moduleName",
      accessorKey: "moduleId",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Module" />
      ),
      cell: ({ row }) => {
        const mod = getModule(row.original.moduleId)
        return (
          <div className="flex flex-col">
            <span className="font-semibold text-sm">{mod?.name ?? row.original.moduleId}</span>
            <span className="text-[9px] text-muted-foreground font-mono">{row.original.id}</span>
          </div>
        )
      },
      meta: {
        label: "Module",
        placeholder: "Search modules...",
        variant: "text",
      },
      enableColumnFilter: true,
    },
    {
      id: "category",
      accessorFn: (row) => getModule(row.moduleId)?.category ?? "—",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Category" />
      ),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
          {getModule(row.original.moduleId)?.category ?? "—"}
        </Badge>
      ),
      meta: {
        label: "Category",
        variant: "multiSelect",
        options: Array.from(
          new Set(MODULE_REGISTRY.map(m => m.category))
        ).map(c => ({ label: c, value: c })),
      },
      enableColumnFilter: true,
    },
    {
      id: "state",
      accessorKey: "state",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="State" />
      ),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
          {row.original.state}
        </Badge>
      ),
      meta: {
        label: "State",
        variant: "multiSelect",
        options: ["docked", "floating", "focused", "fullscreen", "compact"].map(s => ({
          label: s,
          value: s,
        })),
      },
      enableColumnFilter: true,
    },
    {
      id: "visibility",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Visible In" />
      ),
      // 不参与 filter（自定义渲染），但可排序（按可见数）
      accessorFn: (row) =>
        VIEW_MODES.filter(m => !row.hiddenIn?.[m]).length,
      cell: ({ row }) => {
        const comp = row.original
        return (
          <div className="flex items-center gap-1">
            {VIEW_MODES.map(m => {
              const visible = !comp.hiddenIn?.[m]
              return (
                <button
                  key={m}
                  onClick={() => dispatch(actions.toggleComponentVisibility(comp.id, m))}
                  title={`${m}: ${visible ? "visible" : "hidden"}`}
                  className={cn(
                    "h-5 w-5 grid place-items-center rounded border text-[8px] uppercase",
                    visible
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/40 text-muted-foreground/40 hover:text-foreground"
                  )}
                >
                  {visible ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                </button>
              )
            })}
          </div>
        )
      },
      enableColumnFilter: false,
    },
    {
      id: "tags",
      accessorFn: (row) => row.tags?.join(",") ?? "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Tags" />
      ),
      cell: ({ row }) => {
        const comp = row.original
        const tags = comp.tags ?? []
        const inputVal = tagInput[comp.id] ?? ""
        const commit = (next: string[]) => dispatch(actions.setComponentTags(comp.id, next))
        return (
          <div className="flex flex-wrap items-center gap-1">
            {tags.map(t => (
              <Badge key={t} variant="secondary" className="text-[9px] gap-0.5">
                <Tag className="h-2.5 w-2.5" />
                {t}
                <button
                  onClick={() => commit(tags.filter(x => x !== t))}
                  className="hover:text-destructive ml-0.5"
                  aria-label={`Remove ${t}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            <input
              value={inputVal}
              onChange={(e) => setTagInput({ ...tagInput, [comp.id]: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  const text = inputVal.trim()
                  if (!text || tags.includes(text)) {
                    setTagInput({ ...tagInput, [comp.id]: "" })
                    return
                  }
                  commit([...tags, text])
                  setTagInput({ ...tagInput, [comp.id]: "" })
                }
                if (e.key === "Backspace" && !inputVal && tags.length > 0) {
                  commit(tags.slice(0, -1))
                }
              }}
              placeholder="+ tag"
              className="bg-transparent text-[10px] outline-none w-16 placeholder:text-muted-foreground/60 focus:bg-background focus:px-1 focus:rounded focus:border focus:border-border/60"
            />
          </div>
        )
      },
      meta: {
        label: "Tags",
        variant: "text",
        placeholder: "Search tags...",
      },
      // 让 filter 按完整 tag 字符串匹配
      filterFn: (row, _columnId, filterValue: string) =>
        (row.original.tags ?? []).some(t => t.toLowerCase().includes(String(filterValue).toLowerCase())),
      enableColumnFilter: true,
    },
    {
      id: "createdAt",
      accessorFn: (row) => parseCreatedAt(row.id),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Created" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-[10px] font-mono">
          {formatTime(parseCreatedAt(row.original.id))}
        </span>
      ),
      enableColumnFilter: false,
    },
    {
      id: "dataKeys",
      accessorFn: (row) => (row.data ? Object.keys(row.data).length : 0),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} label="Data" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-[10px] font-mono">
          {row.original.data ? Object.keys(row.original.data).length : 0} keys
        </span>
      ),
      enableColumnFilter: false,
    },
    {
      id: "actions",
      size: 40,
      header: () => <div className="text-[10px] font-mono tracking-widest uppercase">·</div>,
      cell: ({ row }) => {
        const comp = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Open menu"
                variant="ghost"
                size="icon"
                className="size-7 p-0 data-[state=open]:bg-muted"
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                onSelect={() => dispatch(actions.toggleComponentVisibility(comp.id, "cards"))}
              >
                Toggle cards
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => dispatch(actions.toggleComponentVisibility(comp.id, "dockview"))}
              >
                Toggle dockview
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => dispatch(actions.toggleComponentVisibility(comp.id, "flow"))}
              >
                Toggle flow
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => dispatch(actions.toggleComponentVisibility(comp.id, "lane"))}
              >
                Toggle lane
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ], [dispatch, tagInput])
}

export default function DatabaseModule({ compId }: ModuleProps) {
  void compId // 模块本身不维护本地状态——数据源同 store.components，与卡片注册同源
  const { visibleComponents } = useWorkspace()

  const columns = useDatabaseColumns()

  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

  const table = useReactTable({
    data: visibleComponents,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  })

  if (visibleComponents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <p className="text-sm font-mono text-muted-foreground">
            // no components to display
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/60">
            Deploy some modules first.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-card p-2">
      <DataTable table={table}>
        <DataTableToolbar table={table} />
      </DataTable>
    </div>
  )
}
