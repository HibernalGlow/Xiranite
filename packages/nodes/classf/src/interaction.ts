import type { InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { ClassfAction, ClassfInput, ClassfResult } from "./core.js"

export type ClassfInteractionValues = InteractionValues & { action: ClassfAction; pathsText: string; crashuSourcesText: string; targetDir: string; transferMode: string; classifyMode: string; existingPolicy: string; dryRun: boolean }

export function createClassfInteractionSchema(defaults: Partial<ClassfInteractionValues> = {}, language: "zh" | "en" = "zh"): TerminalInteractionSchema<ClassfInput, ClassfResult> {
  const zh = language === "zh"
  const text = (zhText: string, enText: string) => zh ? zhText : enText
  const initialValues: ClassfInteractionValues = { action: "plan", pathsText: "", crashuSourcesText: "", targetDir: "", transferMode: "move", classifyMode: "auto", existingPolicy: "merge", dryRun: true, ...defaults }
  return {
    id: "classf", title: "ClassF", description: text("编排 SameA、CrashU 和 MigrateF 分类管道。", "Orchestrate the SameA, CrashU, and MigrateF classification pipeline."), initialValues,
    fields: [
      { id: "action", label: text("操作", "Action"), kind: "select", role: "action", options: [{ value: "plan", label: text("预演", "Plan") }, { value: "classify", label: text("执行", "Classify") }] },
      { id: "pathsText", label: text("SameA 压缩包根目录", "SameA archive roots"), kind: "path-list", lines: 4, placeholder: text("每行一个压缩包根目录", "One archive root per line") },
      { id: "crashuSourcesText", label: text("CrashU 匹配源目录", "CrashU source directories"), kind: "path-list", lines: 3, placeholder: text("每行一个匹配源目录", "One matching source directory per line") },
      { id: "targetDir", label: text("already 目标目录（可选）", "Optional already target directory"), kind: "text" },
      { id: "transferMode", label: text("迁移方式", "Transfer mode"), kind: "select", options: [{ value: "move", label: text("移动", "Move") }, { value: "copy", label: text("复制", "Copy") }] },
      { id: "classifyMode", label: text("分类模式", "Classify mode"), kind: "select", options: [{ value: "auto", label: text("already + wait", "Already + wait") }, { value: "only", label: text("仅 already", "Already only") }] },
      { id: "existingPolicy", label: text("现有项目策略", "Existing policy"), kind: "select", options: [{ value: "merge", label: text("合并", "Merge") }, { value: "skip", label: text("跳过", "Skip") }] },
      { id: "dryRun", label: text("预演", "Dry run"), kind: "boolean" },
    ],
    toInput: (values) => ({ action: String(values.action ?? "plan") as ClassfAction, paths: split(values.pathsText), crashuSourcePaths: split(values.crashuSourcesText), targetDir: String(values.targetDir ?? "").trim() || undefined, transferMode: String(values.transferMode ?? "move") as ClassfInput["transferMode"], classifyMode: String(values.classifyMode ?? "auto") as ClassfInput["classifyMode"], existingPolicy: String(values.existingPolicy ?? "merge") as ClassfInput["existingPolicy"], dryRun: values.dryRun !== false }),
    validate: () => null,
    preview: (input) => [text("默认从剪贴板读取 SameA 根目录。", "SameA roots are read from the clipboard by default."), text("CrashU 使用原始默认源目录和阈值。", "CrashU uses its original default source directory and threshold."), `Transfer: ${input.transferMode ?? "move"}`, input.dryRun !== false ? text("预演：不写入文件。", "Dry run: no files will change.") : text("真实执行：SameA 和 MigrateF 会移动或复制文件。", "Live: SameA and MigrateF will change files.")],
    isDangerous: (input) => input.action === "classify" && input.dryRun === false,
    dangerPrompt: (input) => ({ title: text("确认执行 ClassF 管道", "Confirm ClassF pipeline"), body: text("SameA 与 MigrateF 将对文件系统执行真实操作。", "SameA and MigrateF will perform live filesystem operations."), confirmLabel: text("确认执行", "Run pipeline") }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.data?.errors ?? [], table: { columns: [{ id: "sourceName", label: text("来源", "Source"), width: 28 }, { id: "targetRelative", label: text("目标", "Target"), width: 36 }, { id: "status", label: text("状态", "Status"), width: 14 }], rows: (result.data?.items ?? []).map((item) => ({ sourceName: item.sourceName, targetRelative: item.targetRelative, status: item.status })), emptyMessage: result.message } }),
  }
}
function split(value: unknown): string[] { return String(value ?? "").split(/[\r\n;,]+/).map((item) => item.trim()).filter(Boolean) }
