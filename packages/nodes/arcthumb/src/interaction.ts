import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { ArcThumbInput, ArcThumbResult } from "./core.js"

export function createArcThumbInteractionSchema(defaults: Partial<InteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<ArcThumbInput, ArcThumbResult> {
  const zh = language === "zh"
  const fields: InteractionField[] = [
    { id: "action", label: zh ? "操作" : "Action", kind: "select", role: "action", options: [{ value: "inspect", label: zh ? "检查" : "Inspect" }, { value: "render", label: zh ? "渲染" : "Render" }] },
    { id: "paths", label: zh ? "归档或电子书" : "Archives or ebooks", kind: "path-list", lines: 5 },
    { id: "maxDimension", label: zh ? "最大边长" : "Maximum dimension", kind: "number" },
    { id: "format", label: zh ? "输出格式" : "Format", kind: "select", options: [{ value: "webp", label: "WebP" }, { value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }] },
    { id: "quality", label: zh ? "质量" : "Quality", kind: "number" },
    { id: "outputDir", label: zh ? "输出目录" : "Output directory", kind: "text", visibleWhen: (values) => values.action === "render" },
    { id: "write", label: zh ? "写入文件" : "Write files", kind: "boolean", visibleWhen: (values) => values.action === "render" },
    { id: "overwrite", label: zh ? "覆盖现有文件" : "Overwrite", kind: "boolean", visibleWhen: (values) => values.action === "render" },
  ]
  return { id: "arcthumb", title: "ArcThumb", description: zh ? "原生归档和电子书缩略图" : "Native archive and ebook thumbnails", initialValues: { action: "inspect", paths: "", maxDimension: 512, format: "webp", quality: 85, outputDir: "", write: false, overwrite: false, ...defaults }, fields, view: { sections: [{ id: "thumbnail", title: "ArcThumb", fieldIds: fields.map((field) => field.id) }], dashboard: { title: "ArcThumb", display: (values) => ({ primary: String(values.action), secondary: values.write === true ? "Write" : "Inspect", metrics: [] }) } }, toInput: (values) => ({ action: values.action === "render" ? "render" : "inspect", paths: String(values.paths ?? "").split(/[\r\n;]+/).map((value) => value.trim()).filter(Boolean), maxDimension: Number(values.maxDimension), format: values.format === "png" || values.format === "jpeg" ? values.format : "webp", quality: Number(values.quality), outputDir: String(values.outputDir ?? ""), write: values.write === true, overwrite: values.overwrite === true }), validate: (_values, input) => input.paths?.length ? null : zh ? "至少输入一个归档或电子书路径。" : "Enter at least one archive or ebook path.", preview: (input) => [`${zh ? "输入" : "Inputs"}: ${input.paths?.length ?? 0}`, input.write ? (zh ? "将写入缩略图文件" : "Will write thumbnail files") : (zh ? "仅检查和预览" : "Inspect only")], isDangerous: (input) => input.write === true, dangerPrompt: () => ({ title: zh ? "确认写入缩略图？" : "Write thumbnails?", body: zh ? "将按当前覆盖策略写出原生编码的封面缩略图。" : "Native encoded cover thumbnails will be written using the selected overwrite policy.", confirmLabel: zh ? "确认写入" : "Write" }), result: (result) => ({ success: result.success, message: result.message, lines: result.data ? [`Ready: ${result.data.readyCount}`, `Written: ${result.data.writtenCount}`, `Errors: ${result.data.errorCount}`] : [] }) }
}
