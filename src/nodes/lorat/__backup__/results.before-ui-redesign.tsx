import { useEffect, useMemo, useState } from "react"
import type { ColumnDef, ColumnFiltersState, SortingState } from "@tanstack/react-table"
import { getCoreRowModel, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table"
import type { LoratRow } from "@xiranite/node-lorat/core"
import { Copy, ListChecks, ScrollText, Tags, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/data-table/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar"
import { cn } from "@/lib/utils"

export function LoratResultTabs(props: {
  compact?: boolean
  filteredRows: LoratRow[]
  logs: string[]
  running?: boolean
  onClearSelection: () => void
  onConfirmRowAction: (row: LoratRow, action: "write_triggers" | "mark_no_trigger") => void
  onCopyLogs: () => void
  onCopyResults: () => void
  onEditTrigger: (row: LoratRow, trigger: string) => void
  onSelectMissing: () => void
  onToggleRow: (row: LoratRow) => void
}) {
  const hasRows = props.filteredRows.length > 0
  const preferredTab = props.running ? "logs" : hasRows ? "rows" : props.logs.length ? "logs" : "rows"
  const [tab, setTab] = useState(preferredTab)
  useEffect(() => { setTab(preferredTab) }, [preferredTab])

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="shrink-0">
        <TabsTrigger value="rows">模型</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
      </TabsList>
      <TabsContent value="rows" className="min-h-0 flex-1">
        <RowsPanel compact={props.compact} filteredRows={props.filteredRows} onConfirmRowAction={props.onConfirmRowAction} onEditTrigger={props.onEditTrigger} onToggleRow={props.onToggleRow} />
      </TabsContent>
      <TabsContent value="logs" className="min-h-0 flex-1">
        <TextPanel compact={props.compact} emptyText="运行日志会显示在这里。" icon={ScrollText} lines={props.logs} onCopy={props.onCopyLogs} />
      </TabsContent>
    </Tabs>
  )
}

function RowsPanel(props: {
  compact?: boolean
  filteredRows: LoratRow[]
  onConfirmRowAction: (row: LoratRow, action: "write_triggers" | "mark_no_trigger") => void
  onEditTrigger: (row: LoratRow, trigger: string) => void
  onToggleRow: (row: LoratRow) => void
}) {
  const Icon = ListChecks
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const rowSelection = useMemo(
    () => Object.fromEntries(props.filteredRows.filter((row) => row.selected).map((row) => [row.key, true])),
    [props.filteredRows],
  )
  const sourceOptions = useMemo(
    () => Array.from(new Set(props.filteredRows.map((row) => row.source).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ label: value, value })),
    [props.filteredRows],
  )
  const columns = useMemo<ColumnDef<LoratRow>[]>(() => [
    {
      id: "selected",
      header: "",
      cell: ({ row }) => (
        <Checkbox
          checked={Boolean(row.original.selected)}
          aria-label={`选择 ${row.original.name}`}
          onCheckedChange={(checked) => {
            if (Boolean(row.original.selected) !== (checked === true)) {
              props.onToggleRow(row.original)
            }
          }}
          onMouseDown={(event) => {
            event.stopPropagation()
            event.preventDefault()
            props.onToggleRow(row.original)
          }}
        />
      ),
      enableHiding: false,
      enableSorting: false,
    },
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Model" />,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium" title={row.original.name}>{row.original.name}</div>
          <div className="truncate text-[10px] text-muted-foreground" title={row.original.relativeDir || "."}>{row.original.relativeDir || "."}</div>
        </div>
      ),
      enableColumnFilter: true,
      meta: {
        label: "Model",
        placeholder: "Filter models...",
        variant: "text",
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Status" />,
      cell: ({ row }) => <LoratStatusBadge status={row.original.status} />,
      enableColumnFilter: true,
      filterFn: optionArrayFilter,
      meta: {
        label: "Status",
        variant: "multiSelect",
        options: [
          { label: "missing", value: "missing" },
          { label: "trigger", value: "trigger" },
          { label: "none", value: "notrigger" },
        ],
      },
    },
    {
      accessorKey: "trigger",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Trigger" />,
      cell: ({ row }) => (
        <Input
          aria-label={`触发词 ${row.original.name}`}
          className="h-7 min-w-[160px] font-mono text-xs"
          value={row.original.trigger}
          onChange={(event) => props.onEditTrigger(row.original, event.currentTarget.value)}
        />
      ),
      enableColumnFilter: true,
      meta: {
        label: "Trigger",
        placeholder: "Filter triggers...",
        variant: "text",
      },
    },
    {
      accessorKey: "source",
      header: ({ column }) => <DataTableColumnHeader column={column} label="Source" />,
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.source}</span>,
      enableColumnFilter: true,
      filterFn: optionArrayFilter,
      meta: {
        label: "Source",
        variant: "multiSelect",
        options: sourceOptions,
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            aria-label={`写入触发词 ${row.original.name}`}
            size="icon-sm"
            variant="destructive"
            onMouseDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
              props.onConfirmRowAction(row.original, "write_triggers")
            }}
            onClick={(event) => {
              if (event.detail === 0) props.onConfirmRowAction(row.original, "write_triggers")
            }}
          >
            <Tags />
          </Button>
          <Button
            aria-label={`标记无触发词 ${row.original.name}`}
            size="icon-sm"
            variant="destructive"
            onMouseDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
              props.onConfirmRowAction(row.original, "mark_no_trigger")
            }}
            onClick={(event) => {
              if (event.detail === 0) props.onConfirmRowAction(row.original, "mark_no_trigger")
            }}
          >
            <XCircle />
          </Button>
        </div>
      ),
      enableHiding: false,
      enableSorting: false,
    },
  ], [props, sourceOptions])
  const table = useReactTable({
    data: props.filteredRows,
    columns,
    getRowId: (row) => row.key,
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: props.compact ? 10 : 20,
      },
    },
  })

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          <span>{props.filteredRows.length ? `${props.filteredRows.length} 个模型` : "等待扫描"}</span>
        </div>
      </div>
      <Separator />
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <DataTable table={table} className="h-full min-h-0" data-testid="lorat-data-table">
          <DataTableToolbar table={table} className="p-0 pb-2" />
        </DataTable>
      </div>
    </section>
  )
}
function LoratStatusBadge({ status }: { status: LoratRow["status"] }) {
  const statusLabel = status === "notrigger" ? "none" : status === "trigger" ? "trigger" : "missing"
  return (
    <Badge variant="outline" className={cn(
      "shrink-0 text-[10px]",
      status === "trigger" && "border-green-500/40 text-green-700 dark:text-green-300",
      status === "missing" && "border-amber-500/40 text-amber-700 dark:text-amber-300",
      status === "notrigger" && "text-muted-foreground",
    )}>{statusLabel}</Badge>
  )
}

function optionArrayFilter(row: { getValue: (columnId: string) => unknown }, columnId: string, value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return true
  return value.includes(String(row.getValue(columnId)))
}

function TextPanel(props: {
  compact?: boolean
  emptyText: string
  icon: typeof ListChecks
  lines: string[]
  onCopy: () => void
}) {
  const Icon = props.icon
  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className={props.compact ? "flex shrink-0 items-center justify-between gap-2 px-2 py-1.5" : "flex shrink-0 items-center justify-between gap-2 px-3 py-2"}>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          <span>{props.lines.length ? `${props.lines.length} 项` : "等待运行"}</span>
        </div>
        <Button disabled={!props.lines.length} size="xs" variant="ghost" onClick={props.onCopy}>
          <Copy data-icon="inline-start" />
          复制
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        {props.lines.length ? (
          <pre className={props.compact ? "whitespace-pre-wrap p-2 text-xs leading-5 text-muted-foreground" : "whitespace-pre-wrap p-3 text-xs leading-5 text-muted-foreground"}>
            {props.lines.join("\n")}
          </pre>
        ) : (
          <div className="flex h-full min-h-16 items-center justify-center p-3 text-center text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Icon className="size-3.5" />{props.emptyText}</span>
          </div>
        )}
      </ScrollArea>
    </section>
  )
}
