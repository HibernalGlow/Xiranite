import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { LoratAction, LoratCollectionItem, LoratInput, LoratResult, LoratRow, LoratStatusFilter } from "./core.js"

export type LoratInteractionValues = InteractionValues & {
  action: LoratAction
  folderPath: string
  triggerDbJson: string
  rowsJson: string
  selectedKeys: string
  search: string
  statusFilter: LoratStatusFilter
  collectionRoot: string
  collectionItemsJson: string
  collectionOverwrite: boolean
}

export function createLoratInteractionSchema(defaults: Partial<LoratInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<LoratInput, LoratResult> {
  const zh = language === "zh"
  const initialValues = {
    action: "scan", folderPath: "", triggerDbJson: "{}", rowsJson: "[]", selectedKeys: "",
    search: "", statusFilter: "all", collectionRoot: "", collectionItemsJson: "[]", collectionOverwrite: false,
    ...Object.fromEntries(Object.entries(defaults).filter(([, value]) => value !== undefined)),
  } as LoratInteractionValues
  const fields: InteractionField[] = [
    { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [
      { value: "scan", label: zh ? "⌕ 扫描模型" : "⌕ Scan" },
      { value: "collect", label: zh ? "⊕ 收集入库" : "⊕ Collect" },
      { value: "apply_db", label: zh ? "◇ 应用 TriggerDB" : "◇ Apply DB" },
      { value: "write_triggers", label: zh ? "✓ 写入触发词" : "✓ Write triggers" },
      { value: "mark_no_trigger", label: zh ? "○ 标记无触发词" : "○ No trigger" },
      { value: "export_db", label: zh ? "⇩ 导出 TriggerDB" : "⇩ Export DB" },
    ] },
    { id: "folderPath", label: zh ? "LoRA 目录" : "LoRA folder", kind: "text", visibleWhen: (v) => v.action !== "collect" },
    { id: "collectionRoot", label: zh ? "收集根目录" : "Collection root", kind: "text", visibleWhen: (v) => v.action === "collect" },
    { id: "collectionItemsJson", label: zh ? "待收集项目 JSON" : "Collection items JSON", kind: "text", visibleWhen: (v) => v.action === "collect" },
    { id: "triggerDbJson", label: "TriggerDB JSON", kind: "text", visibleWhen: (v) => v.action === "apply_db" || v.action === "export_db" },
    { id: "rowsJson", label: zh ? "模型行 JSON" : "Rows JSON", kind: "text", visibleWhen: (v) => !["scan", "collect"].includes(String(v.action)) },
    { id: "selectedKeys", label: zh ? "选中模型键" : "Selected keys", kind: "text", visibleWhen: (v) => v.action === "write_triggers" || v.action === "mark_no_trigger" },
    { id: "search", label: zh ? "搜索" : "Search", kind: "text", visibleWhen: (v) => v.action === "scan" },
    { id: "statusFilter", label: zh ? "状态过滤" : "Status filter", kind: "select", options: [
      { value: "all", label: zh ? "全部" : "All" }, { value: "missing", label: zh ? "缺失" : "Missing" },
      { value: "trigger", label: zh ? "有触发词" : "Trigger" }, { value: "notrigger", label: zh ? "无触发词" : "No trigger" },
    ], visibleWhen: (v) => v.action === "scan" },
    { id: "collectionOverwrite", label: zh ? "覆盖同名模型" : "Overwrite", kind: "boolean", visibleWhen: (v) => v.action === "collect" },
  ]
  return {
    id: "lorat", title: "LoRaT", description: zh ? "LoRA 模型、触发词 sidecar 与 TriggerDB 工作台" : "LoRA models, trigger sidecars, and TriggerDB workbench",
    initialValues, fields,
    view: { sections: [{ id: "library", title: zh ? "模型库" : "Model library", fieldIds: fields.map((field) => field.id) }], dashboard: { title: "LoRaT", display: (v) => ({ primary: String(v.folderPath || v.collectionRoot), secondary: String(v.action), metrics: [] }) } },
    toInput: (v) => ({ action: v.action as LoratAction, folderPath: String(v.folderPath ?? ""), collectionRoot: String(v.collectionRoot ?? ""), collectionItems: parseArray<LoratCollectionItem>(v.collectionItemsJson), collectionOverwrite: v.collectionOverwrite === true, triggerDbJson: String(v.triggerDbJson ?? "{}"), rows: parseArray<LoratRow>(v.rowsJson), selectedKeys: split(v.selectedKeys), search: String(v.search ?? ""), statusFilter: v.statusFilter as LoratStatusFilter }),
    validate(_v, input) {
      if (input.action === "collect") return input.collectionRoot?.trim() && input.collectionItems?.length ? null : zh ? "请输入收集根目录和待收集项目。" : "Enter a collection root and items."
      if (input.action === "scan") return input.folderPath?.trim() ? null : zh ? "请输入 LoRA 目录。" : "Enter a LoRA folder."
      if (!input.rows?.length) return zh ? "请先扫描模型或输入模型行 JSON。" : "Scan models or enter rows JSON first."
      return null
    },
    preview: (input) => [`${zh ? "操作" : "Action"}: ${input.action}`, input.folderPath || input.collectionRoot || "LoRaT"],
    isDangerous: (input) => input.action === "write_triggers" || input.action === "mark_no_trigger",
    dangerPrompt: (input) => ({ title: input.action === "write_triggers" ? (zh ? "确认写入触发词" : "Confirm trigger write") : (zh ? "确认标记无触发词" : "Confirm no-trigger marker"), body: zh ? "现有 sidecar 可能被覆盖。" : "Existing sidecars may be overwritten.", confirmLabel: zh ? "确认写入" : "Write" }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.data ? [`Total: ${result.data.stats.total}`, `Missing: ${result.data.stats.missing}`, `Changed: ${result.data.stats.changed}`, `Written: ${result.data.writtenCount}`] : [] }),
  }
}

function split(value: unknown): string[] { return String(value ?? "").split(/[,;\r\n]+/).map((item) => item.trim()).filter(Boolean) }
function parseArray<T>(value: unknown): T[] { try { const parsed = JSON.parse(String(value ?? "[]")); return Array.isArray(parsed) ? parsed as T[] : [] } catch { return [] } }
