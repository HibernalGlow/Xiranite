import type * as React from "react"
import type { ColumnSort, RowData } from "@tanstack/react-table"

// ── tablecn 的 ColumnMeta 模块增强 ──────────────────────────────────────────
// 参考 https://github.com/sadmann7/tablecn 的 src/types/data-table.ts
// 让所有列定义里的 meta 字段获得类型支持：label / placeholder / variant / options / range / unit / icon
declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    queryKeys?: QueryKeys
  }

  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string
    placeholder?: string
    variant?: FilterVariant
    options?: Option[]
    range?: [number, number]
    unit?: string
    icon?: React.ComponentType<React.ComponentProps<"svg">>
  }
}

export interface QueryKeys {
  page: string
  perPage: string
  sort: string
  filters: string
  joinOperator: string
}

export interface Option {
  label: string
  value: string
  count?: number
  icon?: React.ComponentType<React.ComponentProps<"svg">>
}

export type FilterVariant =
  | "text"
  | "number"
  | "range"
  | "date"
  | "dateRange"
  | "select"
  | "multiSelect"
  | "boolean"

export interface ExtendedColumnSort<TData> extends Omit<ColumnSort, "id"> {
  id: Extract<keyof TData, string>
}

export interface DataTableRowAction<TData> {
  row: import("@tanstack/react-table").Row<TData>
  variant: "update" | "delete"
}
