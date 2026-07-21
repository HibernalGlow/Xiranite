/**
 * @migrated-from src/lib/cards/properties/EmmRawDataCard.svelte
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/EmmRawDataCard.tsx
 * @migration-status adapted
 */
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Braces, Copy, ExternalLink, FolderSearch, RefreshCw, Search, Table2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ReaderMetadataDto } from "../../../adapters/reader-http-client"
import type { ReaderPanelContext } from "../registry"
import { ReaderCardEmptyState } from "./ReaderCardEmptyState"
import { formatBytes } from "./reader-metadata-format"
import { useReaderMetadata } from "./useReaderMetadata"

type EmmRawField = NonNullable<ReaderMetadataDto["book"]["emmRaw"]>["fields"][number]
type ViewMode = "formatted" | "raw"

const FIELD_LABELS: Readonly<Record<string, string>> = {
  bundleSize: "归档大小",
  category: "分类",
  coverHash: "封面哈希",
  coverPath: "封面路径",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  mtime: "文件修改时间",
  exist: "文件存在",
  filecount: "文件数",
  filepath: "文件路径",
  filesize: "文件大小",
  hash: "内容哈希",
  hiddenBook: "隐藏书籍",
  id: "记录 ID",
  mark: "标记",
  pageCount: "页数",
  posted: "发布时间",
  readCount: "阅读次数",
  title: "标题",
  title_jpn: "日文标题",
  type: "类型",
  url: "来源链接",
  rating: "评分",
  status: "状态",
  date: "日期",
  tags: "标签原文",
}

export default function EmmRawDataCard({ session, client, panelActive = true, disabled = false, systemActions }: ReaderPanelContext) {
  if (!panelActive) return <ReaderCardEmptyState />
  if (!session) return <ReaderCardEmptyState>打开书籍后显示 EMM 数据库记录</ReaderCardEmptyState>
  return <EmmRawDataContent sessionId={session.sessionId} client={client} disabled={disabled} copyText={systemActions?.copyText} />
}

function EmmRawDataContent({ sessionId, client, disabled, copyText }: {
  sessionId: string
  client: ReaderPanelContext["client"]
  disabled: boolean
  copyText?: (text: string) => Promise<void>
}) {
  const state = useReaderMetadata(client, sessionId, 0)
  const [filter, setFilter] = useState("")
  const [sorting, setSorting] = useState<SortingState>([{ id: "key", desc: false }])
  const [viewMode, setViewMode] = useState<ViewMode>("formatted")
  const [feedback, setFeedback] = useState<{ error?: boolean; text: string }>()
  const actionRef = useRef<AbortController>()
  useEffect(() => () => actionRef.current?.abort(), [])

  const source = useMemo(() => metadataFields(state.value), [state.value])
  const rows = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return query
      ? source.fields.filter((field) => `${field.key} ${FIELD_LABELS[field.key] ?? ""} ${rawText(field.value)} ${formatFieldValue(field)}`.toLocaleLowerCase().includes(query))
      : source.fields
  }, [filter, source.fields])
  const columns = useMemo<ColumnDef<EmmRawField>[]>(() => [
    { id: "key", accessorKey: "key", header: ({ column }) => <SortHeader label="字段" sorted={column.getIsSorted()} onSort={column.getToggleSortingHandler()} /> },
    { id: "value", accessorFn: (field) => rawText(field.value), header: ({ column }) => <SortHeader label="值" sorted={column.getIsSorted()} onSort={column.getToggleSortingHandler()} /> },
  ], [])
  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() })
  const rawJson = useMemo(() => JSON.stringify(Object.fromEntries(source.fields.map((field) => [field.key, field.value])), null, 2), [source.fields])

  async function run(action: "copy-record" | "copy-field" | "reveal" | "open-url", field?: EmmRawField) {
    if (disabled) return
    const controller = new AbortController()
    actionRef.current?.abort()
    actionRef.current = controller
    setFeedback(undefined)
    try {
      if (action === "reveal") {
        if (!field || field.type !== "path" || !client.revealSystemPath) throw new Error("当前宿主不支持定位此路径。")
        await client.revealSystemPath(rawText(field.value), controller.signal)
      } else if (action === "open-url") {
        if (!field || field.type !== "url" || !client.openExternalUrl) throw new Error("当前宿主不支持打开此外部链接。")
        await client.openExternalUrl(rawText(field.value), controller.signal)
      } else {
        if (!copyText) throw new Error("当前宿主不支持复制文本。")
        await copyText(action === "copy-record" ? rawJson : rawText(field?.value ?? ""))
      }
      controller.signal.throwIfAborted()
      setFeedback({ text: action === "reveal" ? "已在文件管理器中定位" : action === "open-url" ? "已交给系统浏览器打开" : "已复制" })
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ error: true, text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (actionRef.current === controller) actionRef.current = undefined
    }
  }

  if (state.loading) return <div className="h-24 animate-pulse rounded bg-muted" aria-label="正在加载 EMM 数据库记录" />
  if (state.error) return (
    <div className="grid min-h-24 place-items-center gap-2 py-3 text-center" role="alert">
      <span className="text-[11px] text-destructive">{state.error}</span>
      <Button type="button" size="sm" variant="outline" onClick={state.retry}><RefreshCw />重试</Button>
    </div>
  )
  if (!source.fields.length) return <ReaderCardEmptyState>当前书籍没有匹配的 EMM 数据库记录</ReaderCardEmptyState>

  return (
    <div className="space-y-2" data-emm-raw-data-card="true" data-emm-raw-source={source.raw ? "raw-v1" : "compatibility-projection"}>
      <div className="flex min-w-0 items-center gap-1">
        <label className="relative min-w-24 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(event) => setFilter(event.currentTarget.value)} className="h-7 pl-7 text-[10px]" aria-label="过滤 EMM 字段和值" placeholder="过滤字段或值" />
        </label>
        <div className="flex shrink-0 rounded border p-0.5" role="group" aria-label="EMM 数据视图">
          <Button type="button" size="icon-sm" variant={viewMode === "formatted" ? "secondary" : "ghost"} className="size-6" aria-label="格式化表格" title="格式化表格" onClick={() => setViewMode("formatted")}><Table2 /></Button>
          <Button type="button" size="icon-sm" variant={viewMode === "raw" ? "secondary" : "ghost"} className="size-6" aria-label="原始 JSON" title="原始 JSON" onClick={() => setViewMode("raw")}><Braces /></Button>
        </div>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="复制完整 EMM 记录" title="复制完整记录" disabled={disabled || !copyText} onClick={() => void run("copy-record")}><Copy /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="刷新 EMM 记录" title="刷新" disabled={disabled} onClick={state.retry}><RefreshCw /></Button>
      </div>

      {viewMode === "raw" ? (
        <pre className="max-h-48 overflow-auto rounded border bg-muted/30 p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap break-all" data-emm-raw-json="true">{rawJson}</pre>
      ) : rows.length ? (
        <div className="max-h-48 overflow-auto rounded border">
          <table className="w-full table-fixed text-[10px]">
            <thead className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => <th key={header.id} className={header.column.id === "key" ? "w-32 px-1 py-0.5 text-left font-medium" : "px-1 py-0.5 text-left font-medium"}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}
            </thead>
            <tbody>{table.getRowModel().rows.map((row) => {
              const field = row.original
              const formatted = formatFieldValue(field)
              return (
                <tr key={field.key} className="border-t" data-emm-raw-field={field.key}>
                  <td className="px-2 py-1 align-top"><span className="block truncate font-medium" title={field.key}>{FIELD_LABELS[field.key] ?? field.key}</span><span className="block truncate font-mono text-muted-foreground" aria-hidden="true">{field.key}</span></td>
                  <td className="px-2 py-1 align-top">
                    <div className="flex min-w-0 items-start gap-1">
                      <span className="min-w-0 flex-1 break-all font-mono" title={rawText(field.value)} aria-label={`${FIELD_LABELS[field.key] ?? field.key}：${formatted}`}>{formatted}</span>
                      {field.type === "path" && client.revealSystemPath ? <Button type="button" size="icon-sm" variant="ghost" className="size-5" aria-label={`定位 ${FIELD_LABELS[field.key] ?? field.key}`} title="在文件管理器中定位" disabled={disabled} onClick={() => void run("reveal", field)}><FolderSearch /></Button> : null}
                      {field.type === "url" && client.openExternalUrl ? <Button type="button" size="icon-sm" variant="ghost" className="size-5" aria-label={`打开 ${FIELD_LABELS[field.key] ?? field.key}`} title="在系统浏览器中打开" disabled={disabled} onClick={() => void run("open-url", field)}><ExternalLink /></Button> : null}
                      {copyText ? <Button type="button" size="icon-sm" variant="ghost" className="size-5" aria-label={`复制 ${FIELD_LABELS[field.key] ?? field.key}`} title="复制字段值" disabled={disabled} onClick={() => void run("copy-field", field)}><Copy /></Button> : null}
                    </div>
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      ) : <div className="grid min-h-20 place-items-center rounded border border-dashed text-[11px] text-muted-foreground">没有匹配字段</div>}

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{rows.length} / {source.fields.length} 条{source.raw ? "原始字段" : "兼容投影"}</span>
        {feedback ? <span role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-destructive" : undefined}>{feedback.text}</span> : null}
      </div>
    </div>
  )
}

function SortHeader({ label, sorted, onSort }: { label: string; sorted: false | "asc" | "desc"; onSort?: (event: unknown) => void }) {
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown
  return <button type="button" className="flex h-6 w-full items-center gap-1 rounded px-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onSort}><span>{label}</span><Icon className="size-3" aria-hidden="true" /></button>
}

function metadataFields(value: ReaderMetadataDto | undefined): { fields: readonly EmmRawField[]; raw: boolean } {
  const raw = value?.book.emmRaw?.fields
  if (raw?.length) return { fields: raw, raw: true }
  const book = value?.book
  if (!book?.emm) return { fields: [], raw: false }
  return {
    raw: false,
    fields: [
      { key: "filepath", type: "path", value: book.sourcePath },
      ...(book.emm.translatedTitle ? [{ key: "translatedTitle", type: "string" as const, value: book.emm.translatedTitle }] : []),
      { key: "pageCount", type: "number", value: book.pageCount },
      { key: "tagCount", type: "number", value: book.emm.tags?.length ?? 0 },
      ...(book.emm.tags ?? []).map((tag, index) => ({ key: `tag.${index + 1}`, type: "string" as const, value: `${tag.namespace}:${tag.tag}` })),
    ],
  }
}

export function formatEmmRawField(field: EmmRawField): string {
  return formatFieldValue(field)
}

function formatFieldValue(field: EmmRawField): string {
  if (field.type === "boolean") return field.value === true ? "是" : field.value === false ? "否" : rawText(field.value)
  if (field.type === "bytes" && typeof field.value === "number") return formatBytes(field.value)
  if (field.key.toLocaleLowerCase() === "rating" && typeof field.value === "number") return field.value.toFixed(1)
  if ((field.type === "datetime" || field.type === "timestamp") && (typeof field.value === "number" || typeof field.value === "string")) {
    const numeric = typeof field.value === "number" ? field.value * (field.type === "timestamp" ? 1_000 : 1) : Date.parse(field.value)
    const date = new Date(numeric)
    if (!Number.isNaN(date.getTime())) return date.toLocaleString("zh-CN")
  }
  return rawText(field.value)
}

function rawText(value: string | number | boolean): string {
  return typeof value === "string" ? value : String(value)
}
