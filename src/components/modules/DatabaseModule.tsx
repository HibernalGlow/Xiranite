/**
 * DatabaseModule — Notion 式表格视图（基于 niko-table + TanStack Table + shadcn/ui）。
 *
 * 实现要点：
 * 1. 数据源同 store.components + MODULE_REGISTRY —— 与卡片注册 / CardView / DockviewView /
 *    FlowView / LaneView 共享同一份 ComponentInstance[]。这里仅做"派生视图"：
 *    将 ComponentInstance + ModuleDef 映射为 DatabaseRow[]（计算属性，无独立状态）。
 * 2. 直接复用 niko-table 官方组件（src/components/niko-table/*）：
 *    - <DataTableRoot>             顶层 Provider + 自动配置 useReactTable
 *    - <DataTableToolbarSection>   工具栏容器
 *    - <DataTableSearchFilter>    全局搜索（带 debounce）
 *    - <DataTableFacetedFilter>   按列 faceted filter（select/multiSelect 自动派生 options）
 *    - <DataTableSortMenu>         多列排序管理
 *    - <DataTableViewMenu>         列可见性切换
 *    - <DataTableExportButton>     CSV 导出
 *    - <DataTableClearFilter>      清空所有筛选
 *    - <DataTable> + <DataTableHeader> + <DataTableBody>  表格主体
 *    - <DataTablePagination>       分页栏
 *    - <DataTableSelectionBar>      批量操作栏
 *    - <DataTableColumnHeader> + <DataTableColumnTitle> + <DataTableColumnSortMenu>  列头组合
 * 3. tags 直接挂到 ComponentInstance.tags（store action: SET_COMPONENT_TAGS），
 *    与所有 viewMode 共享，跨会话持久化。
 *
 * 参考：https://niko-table.com
 */
import * as React from "react"

import { DataTableRoot } from "@/components/niko-table/core/data-table-root"
import { DataTable } from "@/components/niko-table/core/data-table"
import {
  DataTableHeader,
  DataTableBody,
} from "@/components/niko-table/core/data-table-structure"
import { DataTableColumnHeader } from "@/components/niko-table/components/data-table-column-header"
import { DataTableColumnTitle } from "@/components/niko-table/components/data-table-column-title"
import { DataTableColumnSortMenu } from "@/components/niko-table/components/data-table-column-sort"
import { DataTableToolbarSection } from "@/components/niko-table/components/data-table-toolbar-section"
import { DataTableSearchFilter } from "@/components/niko-table/components/data-table-search-filter"
import { DataTableFacetedFilter } from "@/components/niko-table/components/data-table-faceted-filter"
import { DataTableSortMenu } from "@/components/niko-table/components/data-table-sort-menu"
import { DataTableViewMenu } from "@/components/niko-table/components/data-table-view-menu"
import { DataTableExportButton } from "@/components/niko-table/components/data-table-export-button"
import { DataTableClearFilter } from "@/components/niko-table/components/data-table-clear-filter"
import { DataTablePagination } from "@/components/niko-table/components/data-table-pagination"
import { DataTableSelectionBar } from "@/components/niko-table/components/data-table-selection-bar"
import { FILTER_VARIANTS } from "@/components/niko-table/lib/constants"
import type { DataTableColumnDef } from "@/components/niko-table/types"

import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { getModule, MODULE_REGISTRY } from "@/components/modules/registry"
import type { ModuleProps } from "./ModuleRenderer"
import type { ComponentInstance, ViewMode } from "@/types/workspace"
import type { RowSelectionState } from "@tanstack/react-table"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Ellipsis, Eye, EyeOff, Tag, X } from "lucide-react"
import { cn } from "@/lib/utils"

const VIEW_MODES: ViewMode[] = ["cards", "dockview", "flow", "lane"]

// 从 comp-${counter}-${timestamp} 解析部署时间戳
function parseCreatedAt(id: string): number {
  const parts = id.split("-")
  const last = parts[parts.length - 1]
  const n = Number(last)
  return Number.isFinite(n) ? n : 0
}

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

// ── DatabaseRow：派生视图模型 ────────────────────────────────────────────────
// 不维护独立状态 — 每次都从 store.components + MODULE_REGISTRY 计算。
// 写回时通过 SET_COMPONENT_TAGS / TOGGLE_COMPONENT_VISIBILITY 修改 store.components。
interface DatabaseRow {
  id: string
  moduleId: string
  moduleName: string
  category: string
  state: string
  visibilityCount: number
  visibilityIn: Record<ViewMode, boolean>
  tags: string[]
  createdAt: number
  dataKeys: number
  // 反向引用，用于写回 action
  _comp: ComponentInstance
}

function toDatabaseRow(comp: ComponentInstance): DatabaseRow {
  const mod = getModule(comp.moduleId)
  return {
    id: comp.id,
    moduleId: comp.moduleId,
    moduleName: mod?.name ?? comp.moduleId,
    category: mod?.category ?? "—",
    state: comp.state,
    visibilityCount: VIEW_MODES.filter(m => !comp.hiddenIn?.[m]).length,
    visibilityIn: Object.fromEntries(
      VIEW_MODES.map(m => [m, !comp.hiddenIn?.[m]])
    ) as Record<ViewMode, boolean>,
    tags: comp.tags ?? [],
    createdAt: parseCreatedAt(comp.id),
    dataKeys: comp.data ? Object.keys(comp.data).length : 0,
    _comp: comp,
  }
}

// ── Tags cell：行内编辑 ─────────────────────────────────────────────────────
function TagsCell({ row }: { row: { original: DatabaseRow } }) {
  const dispatch = useWSDispatch()
  const comp = row.original._comp
  const tags = comp.tags ?? []
  const [input, setInput] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  const commit = (next: string[]) => dispatch(actions.setComponentTags(comp.id, next))

  return (
    <div className="flex flex-wrap items-center gap-1 py-0.5">
      {tags.map(t => (
        <Badge key={t} variant="secondary" className="text-[9px] gap-0.5 py-0 px-1">
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
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            const text = input.trim()
            if (!text || tags.includes(text)) {
              setInput("")
              return
            }
            commit([...tags, text])
            setInput("")
          }
          if (e.key === "Backspace" && !input && tags.length > 0) {
            commit(tags.slice(0, -1))
          }
        }}
        placeholder="+ tag"
        className="bg-transparent text-[10px] outline-none w-16 placeholder:text-muted-foreground/60 focus:bg-background focus:px-1 focus:rounded focus:border focus:border-border/60"
      />
    </div>
  )
}

// ── Visibility cell：4 个 viewMode 切换按钮 ─────────────────────────────────
function VisibilityCell({ row }: { row: { original: DatabaseRow } }) {
  const dispatch = useWSDispatch()
  const comp = row.original._comp
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
}

// ── Actions cell：行级菜单 ─────────────────────────────────────────────────
function ActionsCell({ row }: { row: { original: DatabaseRow } }) {
  const dispatch = useWSDispatch()
  const comp = row.original._comp
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
}

// ── 列定义 ─────────────────────────────────────────────────────────────────
// 参考 niko-table examples/basic-table 的列定义模式：
// header: () => <DataTableColumnHeader><DataTableColumnTitle /><DataTableColumnSortMenu /></DataTableColumnHeader>
// meta.variant: 控制工具栏 faceted filter 的渲染
function useDatabaseColumns(): DataTableColumnDef<DatabaseRow>[] {
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
      accessorKey: "moduleName",
      header: () => (
        <DataTableColumnHeader>
          <DataTableColumnTitle title="Module" />
          <DataTableColumnSortMenu />
        </DataTableColumnHeader>
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-semibold text-sm">{row.original.moduleName}</span>
          <span className="text-[9px] text-muted-foreground font-mono">{row.original.id}</span>
        </div>
      ),
      meta: {
        label: "Module",
        placeholder: "Search modules...",
        variant: FILTER_VARIANTS.TEXT,
      },
    },
    {
      accessorKey: "category",
      header: () => (
        <DataTableColumnHeader>
          <DataTableColumnTitle title="Category" />
          <DataTableColumnSortMenu variant={FILTER_VARIANTS.TEXT} />
        </DataTableColumnHeader>
      ),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
          {row.original.category}
        </Badge>
      ),
      meta: {
        label: "Category",
        variant: FILTER_VARIANTS.MULTI_SELECT,
        // 用 registry 的所有 category 作为静态选项
        options: Array.from(new Set(MODULE_REGISTRY.map(m => m.category))).map(c => ({
          label: c,
          value: c,
        })),
      },
    },
    {
      accessorKey: "state",
      header: () => (
        <DataTableColumnHeader>
          <DataTableColumnTitle title="State" />
          <DataTableColumnSortMenu variant={FILTER_VARIANTS.TEXT} />
        </DataTableColumnHeader>
      ),
      cell: ({ row }) => (
        <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
          {row.original.state}
        </Badge>
      ),
      meta: {
        label: "State",
        variant: FILTER_VARIANTS.MULTI_SELECT,
        options: ["docked", "floating", "focused", "fullscreen", "compact"].map(s => ({
          label: s,
          value: s,
        })),
      },
    },
    {
      accessorKey: "visibilityCount",
      header: () => (
        <DataTableColumnHeader>
          <DataTableColumnTitle title="Visible In" />
          <DataTableColumnSortMenu variant={FILTER_VARIANTS.NUMBER} />
        </DataTableColumnHeader>
      ),
      cell: ({ row }) => <VisibilityCell row={row} />,
      enableColumnFilter: false,
    },
    {
      accessorKey: "tags",
      header: () => (
        <DataTableColumnHeader>
          <DataTableColumnTitle title="Tags" />
          <DataTableColumnSortMenu variant={FILTER_VARIANTS.TEXT} />
        </DataTableColumnHeader>
      ),
      cell: ({ row }) => <TagsCell row={row} />,
      meta: {
        label: "Tags",
        variant: FILTER_VARIANTS.TEXT,
        placeholder: "Search tags...",
      },
      // tag 列的 filter 按 tag 子串匹配
      filterFn: (row, _columnId, filterValue: string) =>
        (row.original.tags ?? []).some(t =>
          t.toLowerCase().includes(String(filterValue).toLowerCase()),
        ),
    },
    {
      accessorKey: "createdAt",
      header: () => (
        <DataTableColumnHeader>
          <DataTableColumnTitle title="Created" />
          <DataTableColumnSortMenu variant={FILTER_VARIANTS.NUMBER} />
        </DataTableColumnHeader>
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-[10px] font-mono">
          {formatTime(row.original.createdAt)}
        </span>
      ),
      enableColumnFilter: false,
    },
    {
      accessorKey: "dataKeys",
      header: () => (
        <DataTableColumnHeader>
          <DataTableColumnTitle title="Data" />
          <DataTableColumnSortMenu variant={FILTER_VARIANTS.NUMBER} />
        </DataTableColumnHeader>
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-[10px] font-mono">
          {row.original.dataKeys} keys
        </span>
      ),
      enableColumnFilter: false,
    },
    {
      id: "actions",
      size: 40,
      header: () => <div className="text-[10px] font-mono tracking-widest uppercase">·</div>,
      cell: ({ row }) => <ActionsCell row={row} />,
      enableSorting: false,
      enableHiding: false,
    },
  ], [])
}

export default function DatabaseModule({ compId }: ModuleProps) {
  void compId // 模块本身不维护本地状态——数据源同 store.components
  const { visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()

  // 派生 DatabaseRow[] — 不维护独立状态，每次都重新计算
  const rows = React.useMemo(
    () => visibleComponents.map(toDatabaseRow),
    [visibleComponents],
  )

  const columns = useDatabaseColumns()

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

  if (rows.length === 0) {
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

  const selectedCount = Object.values(rowSelection).filter(Boolean).length

  return (
    <div className="h-full flex flex-col bg-card p-2 overflow-hidden">
      <DataTableRoot
        data={rows}
        columns={columns}
        config={{
          enableRowSelection: true,
          enableMultiSort: true,
          initialPageSize: 20,
        }}
        state={{ rowSelection }}
        onRowSelectionChange={setRowSelection}
        getRowId={(row) => row.id}
      >
        <DataTableToolbarSection className="justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <DataTableSearchFilter placeholder="Search components..." />
            <DataTableFacetedFilter accessorKey="category" />
            <DataTableFacetedFilter accessorKey="state" />
            <DataTableClearFilter />
          </div>
          <div className="flex items-center gap-2">
            <DataTableSortMenu />
            <DataTableViewMenu />
            <DataTableExportButton filename="components" />
          </div>
        </DataTableToolbarSection>

        <DataTable className="rounded-md border">
          <DataTableHeader />
          <DataTableBody />
        </DataTable>

        <DataTablePagination />

        <DataTableSelectionBar
          selectedCount={selectedCount}
          onClear={() => setRowSelection({})}
        >
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => {
              const selectedRows = rows.filter(r => rowSelection[r.id])
              selectedRows.forEach(r => {
                if (!r.visibilityIn.cards) {
                  dispatch(actions.toggleComponentVisibility(r.id, "cards"))
                }
              })
            }}
          >
            Show in cards
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => {
              const selectedRows = rows.filter(r => rowSelection[r.id])
              selectedRows.forEach(r => {
                if (r.visibilityIn.cards) {
                  dispatch(actions.toggleComponentVisibility(r.id, "cards"))
                }
              })
            }}
          >
            Hide in cards
          </Button>
        </DataTableSelectionBar>
      </DataTableRoot>
    </div>
  )
}
