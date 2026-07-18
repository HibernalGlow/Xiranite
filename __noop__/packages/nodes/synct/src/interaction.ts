import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { SynctAction, SynctFormatKey, SynctInput, SynctResult, SynctSourceMode } from "./core.js"

export type SynctInteractionValues = InteractionValues & {
  action: SynctAction; pathsText: string; sourceMode: SynctSourceMode; formatKey: SynctFormatKey
  recursive: boolean; archiveFolder: boolean; fallbackToCreatedTime: boolean; syncFolderFileTimes: boolean; dryRun: boolean
}

export function createSynctInteractionSchema(defaults: Partial<SynctInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<SynctInput, SynctResult> {
  const zh = language === "zh"
  const initialValues = { action: "plan", pathsText: "", sourceMode: "files", formatKey: "year_month", recursive: false, archiveFolder: false, fallbackToCreatedTime: true, syncFolderFileTimes: true, dryRun: true, ...clean(defaults) } as SynctInteractionValues
  const fields: InteractionField[] = [
    { id: "action", label: zh ? "命令" : "Command", kind: "select", role: "action", options: [{ value: "scan", label: zh ? "⌕ 扫描" : "⌕ Scan" }, { value: "plan", label: zh ? "⌁ 规划" : "⌁ Plan" }, { value: "archive", label: zh ? "⇄ 归档" : "⇄ Archive" }] },
    { id: "pathsText", label: zh ? "来源路径" : "Source paths", kind: "path-list", lines: 3, placeholder: zh ? "每行一个文件或目录" : "One file or folder per line" },
    { id: "sourceMode", label: zh ? "来源类型" : "Source mode", kind: "select", options: [{ value: "files", label: zh ? "▤ 文件" : "▤ Files" }, { value: "folders", label: zh ? "▣ 文件夹" : "▣ Folders" }] },
    { id: "formatKey", label: zh ? "归档路径格式" : "Archive format", kind: "select", options: [
      { value: "year", label: "YYYY" }, { value: "year_month", label: "YYYY-MM" }, { value: "year_month_day", label: "YYYY-MM-DD" },
      { value: "month_day", label: "MM-DD" }, { value: "day", label: "DD" }, { value: "nested_y_m", label: "YYYY / MM" },
      { value: "nested_y_m_d", label: "YYYY / MM / DD" }, { value: "nested_ym_d", label: "YYYY-MM / DD" }, { value: "nested_y_md", label: "YYYY / MM-DD" },
    ] },
    { id: "recursive", label: zh ? "递归扫描" : "Recursive", kind: "boolean" },
    { id: "archiveFolder", label: zh ? "使用 archive 子目录" : "Use archive folder", kind: "boolean" },
    { id: "fallbackToCreatedTime", label: zh ? "回退到创建时间" : "Fallback to created time", kind: "boolean" },
    { id: "syncFolderFileTimes", label: zh ? "同步文件夹内时间" : "Sync folder file times", kind: "boolean", visibleWhen: (values) => values.sourceMode === "folders" },
    { id: "dryRun", label: zh ? "仅预览" : "Dry run", kind: "boolean", visibleWhen: (values) => values.action === "archive" },
  ]
  return {
    id: "synct", title: "Synct", description: zh ? "按时间戳规划并归档文件或文件夹" : "Plan and archive files or folders by timestamp", initialValues, fields,
    view: { sections: [{ id: "sources", title: zh ? "来源与归档规则" : "Sources and archive rules", fieldIds: fields.map((field) => field.id) }], dashboard: { title: "Synct", display: (values) => ({ primary: firstPath(values.pathsText), secondary: String(values.formatKey), metrics: [] }) } },
    toInput: (values) => ({ action: values.action as SynctAction, paths: lines(values.pathsText), sourceMode: values.sourceMode as SynctSourceMode, formatKey: values.formatKey as SynctFormatKey, recursive: values.recursive === true, archiveFolder: values.archiveFolder === true, fallbackToCreatedTime: values.fallbackToCreatedTime !== false, syncFolderFileTimes: values.syncFolderFileTimes !== false, dryRun: values.dryRun !== false }),
    validate: (_values, input) => input.paths?.length ? null : zh ? "请至少输入一个来源路径。" : "Enter at least one source path.",
    preview: (input) => [`${input.paths?.length ?? 0} ${zh ? "个来源" : "source(s)"}`, `${input.sourceMode} → ${input.formatKey}`],
    isDangerous: (input) => input.action === "archive" && input.dryRun === false,
    dangerPrompt: () => ({ title: zh ? "确认移动归档项目" : "Confirm archive moves", body: zh ? "就绪项目将被移动到按日期生成的目录。" : "Ready items will be moved into date-based directories.", confirmLabel: zh ? "确认归档" : "Archive" }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.data ? [`Scanned: ${result.data.scannedCount}`, `Ready: ${result.data.readyCount}`, `Moved: ${result.data.movedCount}`, `Conflicts: ${result.data.conflictCount}`] : [] }),
  }
}

const lines = (value: unknown) => String(value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
const firstPath = (value: unknown) => lines(value)[0] ?? "Synct"
const clean = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
