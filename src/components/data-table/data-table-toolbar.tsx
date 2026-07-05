import type { Column, Table } from "@tanstack/react-table"
import { X } from "lucide-react"
import * as React from "react"

import { DataTableFacetedFilter } from "@/components/data-table/data-table-faceted-filter"
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface DataTableToolbarProps<TData> extends React.ComponentProps<"div"> {
  table: Table<TData>
}

/**
 * DataTableToolbar — 直接复制自 tablecn:
 * https://github.com/sadmann7/tablecn/blob/main/src/components/data-table/data-table-toolbar.tsx
 *
 * 自动按列 meta.variant 渲染筛选器：
 * - text        → Input
 * - number      → Input[type=number]
 * - select      → DataTableFacetedFilter (单选)
 * - multiSelect → DataTableFacetedFilter (多选)
 * - range       → DataTableSliderFilter (项目暂未实现，跳过)
 * - date/dateRange → DataTableDateFilter (项目暂未实现，跳过)
 *
 * 末尾附 "Reset filters" 按钮 + "View" 列可见性切换。
 */
export function DataTableToolbar<TData>({
  table,
  children,
  className,
  ...props
}: DataTableToolbarProps<TData>) {
  const isFiltered = table.getState().columnFilters.length > 0

  const columns = React.useMemo(
    () => table.getAllColumns().filter((column) => column.getCanFilter()),
    [table],
  )

  const onReset = React.useCallback(() => {
    table.resetColumnFilters()
  }, [table])

  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        "flex w-full items-start justify-between gap-2 p-1",
        className,
      )}
      {...props}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {columns.map((column) => (
          <DataTableToolbarFilter key={column.id} column={column} />
        ))}
        {isFiltered && (
          <Button
            aria-label="Reset filters"
            variant="outline"
            className="border-dashed"
            onClick={onReset}
          >
            <X />
            Reset
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {children}
        <DataTableViewOptions table={table} align="end" />
      </div>
    </div>
  )
}

interface DataTableToolbarFilterProps<TData> {
  column: Column<TData>
}

function DataTableToolbarFilter<TData>({
  column,
}: DataTableToolbarFilterProps<TData>) {
  const columnMeta = column.columnDef.meta

  const onFilterRender = React.useCallback(() => {
    if (!columnMeta?.variant) return null

    switch (columnMeta.variant) {
      case "text":
        return (
          <Input
            placeholder={columnMeta.placeholder ?? columnMeta.label}
            value={(column.getFilterValue() as string) ?? ""}
            onChange={(event) => column.setFilterValue(event.target.value)}
            className="h-8 w-40 lg:w-56"
          />
        )

      case "number":
        return (
          <div className="relative">
            <Input
              type="number"
              inputMode="numeric"
              placeholder={columnMeta.placeholder ?? columnMeta.label}
              value={(column.getFilterValue() as string) ?? ""}
              onChange={(event) => column.setFilterValue(event.target.value)}
              className={cn("h-8 w-[120px]", columnMeta.unit && "pr-8")}
            />
            {columnMeta.unit && (
              <span className="absolute top-0 right-0 bottom-0 flex items-center rounded-r-md bg-accent px-2 text-muted-foreground text-sm">
                {columnMeta.unit}
              </span>
            )}
          </div>
        )

      case "select":
      case "multiSelect":
        return (
          <DataTableFacetedFilter
            column={column}
            title={columnMeta.label ?? column.id}
            options={columnMeta.options ?? []}
            multiple={columnMeta.variant === "multiSelect"}
          />
        )

      // range / date / dateRange 项目暂未引入对应组件，跳过渲染（列仍可排序）
      default:
        return null
    }
  }, [column, columnMeta])

  return onFilterRender()
}
