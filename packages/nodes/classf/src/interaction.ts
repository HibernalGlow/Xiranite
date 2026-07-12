import type { InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { ClassfAction, ClassfInput, ClassfResult } from "./core.js"

export type ClassfInteractionValues = InteractionValues & { action: ClassfAction; pathsText: string; targetDir: string; transferMode: string; classifyMode: string; existingPolicy: string; dryRun: boolean }

export function createClassfInteractionSchema(defaults: Partial<ClassfInteractionValues> = {}, language: "zh" | "en" = "zh"): TerminalInteractionSchema<ClassfInput, ClassfResult> {
  const zh = language === "zh"
  const text = (a: string, b: string) => zh ? a : b
  const initialValues: ClassfInteractionValues = { action: "plan", pathsText: "", targetDir: "", transferMode: "move", classifyMode: "auto", existingPolicy: "merge", dryRun: true, ...defaults }
  return {
    id: "classf", title: "ClassF", description: text("规划并执行文件分类传输。", "Plan and apply classified file transfers."), initialValues,
    fields: [
      { id: "action", label: text("操作", "Action"), kind: "select", role: "action", options: [{ value: "plan", label: text("规划", "Plan") }, { value: "classify", label: text("分类执行", "Classify") }] },
      { id: "pathsText", label: text("来源路径", "Source paths"), kind: "path-list", lines: 5, placeholder: text("每行一个文件或文件夹", "One file or folder per line") },
      { id: "targetDir", label: text("目标目录", "Target directory"), kind: "text" },
      { id: "transferMode", label: text("传输方式", "Transfer mode"), kind: "select", options: [{ value: "move", label: text("移动", "Move") }, { value: "copy", label: text("复制", "Copy") }] },
      { id: "classifyMode", label: text("分类模式", "Classify mode"), kind: "select", options: [{ value: "auto", label: text("自动", "Auto") }, { value: "only", label: text("仅分类", "Only") }, { value: "off", label: text("关闭", "Off") }] },
      { id: "existingPolicy", label: text("已存在策略", "Existing policy"), kind: "select", options: [{ value: "merge", label: text("合并", "Merge") }, { value: "skip", label: text("跳过", "Skip") }] },
      { id: "dryRun", label: text("预演", "Dry-run"), kind: "boolean" },
    ],
    toInput: (values) => ({ action: String(values.action ?? "plan") as ClassfAction, paths: String(values.pathsText ?? "").split(/[\r\n;,]+/).map((v) => v.trim()).filter(Boolean), targetDir: String(values.targetDir ?? "").trim() || undefined, transferMode: String(values.transferMode ?? "move") as ClassfInput["transferMode"], classifyMode: String(values.classifyMode ?? "auto") as ClassfInput["classifyMode"], existingPolicy: String(values.existingPolicy ?? "merge") as ClassfInput["existingPolicy"], dryRun: values.dryRun !== false }),
    validate: (_values, input) => input.paths?.length ? null : text("至少输入一个来源路径。", "Enter at least one source path."),
    preview: (input) => [`${text("操作", "Action")}: ${input.action ?? "plan"}`, `${text("来源", "Sources")}: ${input.paths?.length ?? 0}`, `${text("方式", "Transfer")}: ${input.transferMode ?? "move"}`, input.dryRun !== false ? text("预演：不会移动或复制文件。", "Dry-run: no files will move or copy.") : text("真实执行：将修改文件。", "Live: files will be changed.")],
    isDangerous: (input) => input.action === "classify" && input.dryRun === false,
    dangerPrompt: (input) => ({ title: text("确认分类", "Confirm classify"), body: text(`将${input.transferMode === "copy" ? "复制" : "移动"}文件到目标目录。`, `Files will be ${input.transferMode === "copy" ? "copied" : "moved"} to the target directory.`), confirmLabel: text("确认执行", "Run now") }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.data?.errors ?? [], table: { columns: [{ id: "sourceName", label: text("来源", "Source"), width: 28 }, { id: "targetRelative", label: text("目标", "Target"), width: 36 }, { id: "status", label: text("状态", "Status"), width: 14 }], rows: (result.data?.items ?? []).map((item) => ({ sourceName: item.sourceName, targetRelative: item.targetRelative, status: item.status })), emptyMessage: result.message } }),
  }
}
