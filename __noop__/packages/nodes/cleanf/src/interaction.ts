import type { InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import { CLEANING_PRESETS, getDefaultPresets, type CleanfInput, type CleanfPresetId, type CleanfResult } from "./core.js"

export type CleanfInteractionValues = InteractionValues & { pathsText: string; presetsText: string; exclude: string; preview: boolean }

export function createCleanfInteractionSchema(defaults: Partial<CleanfInteractionValues> = {}, language: "zh" | "en" = "zh"): TerminalInteractionSchema<CleanfInput, CleanfResult> {
  const zh = language === "zh", text = (a: string, b: string) => zh ? a : b
  const initialValues: CleanfInteractionValues = { pathsText: "", presetsText: getDefaultPresets().join("\n"), exclude: "", preview: true, ...defaults }
  return {
    id: "cleanf", title: "CleanF", description: text("预览并清理空目录、备份、临时与垃圾文件。", "Preview and clean empty folders, backups, temp and trash files."), initialValues,
    fields: [
      { id: "pathsText", label: text("清理路径", "Cleanup paths"), kind: "path-list", lines: 5, placeholder: text("每行一个文件夹", "One folder per line") },
      { id: "presetsText", label: text("清理预设", "Cleanup presets"), kind: "multiline", lines: 2, placeholder: text("每行或逗号分隔一个预设", "One preset per line or comma") },
      { id: "exclude", label: text("排除关键词", "Exclude keywords"), kind: "text" },
      { id: "preview", label: text("仅预览", "Preview only"), kind: "boolean" },
    ],
    toInput: (values) => ({ paths: String(values.pathsText ?? "").split(/[\r\n;,]+/).map((v) => v.trim()).filter(Boolean), presets: String(values.presetsText ?? "").split(/[\r\n,]+/).map((v) => v.trim()).filter(Boolean) as CleanfPresetId[], exclude: String(values.exclude ?? "").trim() || undefined, preview: values.preview !== false }),
    validate: (_values, input) => input.paths?.length ? null : text("至少输入一个清理路径。", "Enter at least one cleanup path."),
    preview: (input) => [`${text("路径", "Paths")}: ${input.paths?.length ?? 0}`, `${text("预设", "Presets")}: ${(input.presets ?? []).join(", ") || "—"}`, input.preview !== false ? text("预览：不会删除文件。", "Preview: no files will be removed.") : text("真实执行：匹配项将被删除。", "Live: matching items will be removed.")],
    isDangerous: (input) => input.preview === false,
    dangerPrompt: () => ({ title: text("确认清理", "Confirm cleanup"), body: text("匹配到的文件和目录将被永久删除。", "Matching files and folders will be permanently removed."), confirmLabel: text("确认删除", "Delete now") }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.data?.previewFiles ?? [], table: { columns: [{ id: "path", label: text("匹配路径", "Matched path"), width: 72 }], rows: (result.data?.previewFiles ?? []).map((path) => ({ path })), emptyMessage: result.message } }),
  }
}
