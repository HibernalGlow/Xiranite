import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { LogxAction, LogxInput, LogxResult } from "./core.js"

export type LogxInteractionValues = InteractionValues & {
  action: LogxAction
  directory: string
  minimumSeverity: string
  scope: string
  eventName: string
  sessionId: string
  search: string
  since: string
  until: string
  limit: number
  order: string
}

export function createLogxInteractionSchema(defaults: Partial<LogxInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<LogxInput, LogxResult> {
  const zh = language === "zh"
  const initialValues = {
    action: "query", directory: "", minimumSeverity: "info", scope: "", eventName: "", sessionId: "",
    search: "", since: "", until: "", limit: 500, order: "desc", ...clean(defaults),
  } as LogxInteractionValues
  const fields: InteractionField[] = [
    { id: "action", label: zh ? "分析模式" : "Analysis mode", kind: "select", role: "action", options: [
      { value: "query", label: zh ? "查询事件" : "Query events" },
      { value: "sessions", label: zh ? "会话" : "Sessions" },
      { value: "stats", label: zh ? "统计" : "Statistics" },
      { value: "errors", label: zh ? "错误聚类" : "Error groups" },
      { value: "doctor", label: zh ? "完整性检查" : "Doctor" },
    ] },
    { id: "directory", label: zh ? "日志目录（留空使用默认目录）" : "Log directory (blank for default)", kind: "text" },
    { id: "minimumSeverity", label: zh ? "最低级别" : "Minimum severity", kind: "select", options: ["trace", "debug", "info", "warn", "error", "fatal"].map((value) => ({ value, label: value.toUpperCase() })) },
    { id: "scope", label: "Scope", kind: "text", placeholder: "neoview.reader" },
    { id: "eventName", label: zh ? "事件名" : "Event name", kind: "text", placeholder: "reader.failed" },
    { id: "sessionId", label: "Session ID", kind: "text" },
    { id: "search", label: zh ? "全文搜索" : "Search", kind: "text" },
    { id: "since", label: zh ? "开始时间（ISO）" : "Since (ISO)", kind: "text" },
    { id: "until", label: zh ? "结束时间（ISO）" : "Until (ISO)", kind: "text" },
    { id: "limit", label: zh ? "最大返回数" : "Result limit", kind: "number", min: 1, max: 5000, step: 50 },
    { id: "order", label: zh ? "顺序" : "Order", kind: "select", options: [{ value: "desc", label: zh ? "最新优先" : "Newest first" }, { value: "asc", label: zh ? "最早优先" : "Oldest first" }] },
  ]
  return {
    id: "logx", title: "LogX", description: zh ? "查询严格 JSONL 日志、会话、统计和错误聚类" : "Query strict JSONL logs, sessions, statistics, and error groups",
    initialValues, fields,
    view: { sections: [{ id: "query", title: zh ? "日志查询" : "Log query", fieldIds: fields.map((field) => field.id) }], dashboard: { title: "LogX", display: (values) => ({ primary: String(values.action ?? "query"), secondary: String(values.search || values.scope || values.minimumSeverity || "info"), metrics: [] }) } },
    toInput: (values) => ({ action: values.action as LogxAction, directory: text(values.directory), minimumSeverity: values.minimumSeverity as LogxInput["minimumSeverity"], scope: text(values.scope), eventName: text(values.eventName), sessionId: text(values.sessionId), search: text(values.search), since: text(values.since), until: text(values.until), limit: Number(values.limit ?? 500), order: values.order === "asc" ? "asc" : "desc" }),
    validate: (_values, input) => input.limit && input.limit > 5000 ? (zh ? "最大返回数不能超过 5000。" : "Result limit cannot exceed 5000.") : null,
    preview: (input) => [`${input.minimumSeverity ?? "info"}+`, input.search || input.scope || (zh ? "全部日志" : "all logs")],
    isDangerous: () => false,
    result: (result) => ({ success: result.success, message: result.message, lines: result.data ? [`Events: ${result.data.matchedCount}`, `Sessions: ${result.data.sessions.length}`, `Issues: ${result.data.issues.length}`] : [] }),
  }
}

const text = (value: unknown) => String(value ?? "").trim() || undefined
const clean = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
