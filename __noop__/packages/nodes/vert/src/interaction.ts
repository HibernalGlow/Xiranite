import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import type { VertAction, VertEnginePreference, VertInput, VertResult } from "./core.js"

export type VertInteractionValues = InteractionValues & { action: VertAction; paths: string; targetFormat: string; outputDirectory: string; engine: VertEnginePreference; overwrite: boolean; quality: number }

export function createVertInteractionSchema(defaults: Partial<VertInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<VertInput, VertResult> {
  const zh = language === "zh"
  const initialValues: VertInteractionValues = { action: "plan", paths: "", targetFormat: "webp", outputDirectory: "", engine: "auto", overwrite: false, quality: 90, ...defaults }
  const fields: InteractionField[] = [
    { id: "action", label: zh ? "转换操作" : "Action", kind: "select", role: "action", options: [{ value: "status", label: zh ? "◌ 检查引擎" : "Check engines" }, { value: "plan", label: zh ? "⌕ 预演命令" : "Plan" }, { value: "convert", label: zh ? "▶ 开始转换" : "Convert" }] },
    { id: "paths", label: zh ? "文件队列" : "Files", kind: "path-list", lines: 6, visibleWhen: (values) => values.action !== "status" },
    { id: "targetFormat", label: zh ? "目标格式" : "Target format", kind: "text", visibleWhen: (values) => values.action !== "status" },
    { id: "outputDirectory", label: zh ? "输出目录（可选）" : "Output directory", kind: "text", visibleWhen: (values) => values.action !== "status" },
    { id: "engine", label: zh ? "执行引擎" : "Engine", kind: "select", options: [{ value: "auto", label: zh ? "自动：CLI 优先" : "Auto: CLI first" }, { value: "cli", label: "CLI" }, { value: "wasm", label: "Wasm" }], visibleWhen: (values) => values.action !== "status" },
    { id: "overwrite", label: zh ? "覆盖同名文件" : "Overwrite", kind: "boolean", visibleWhen: (values) => values.action === "convert" },
    { id: "quality", label: zh ? "图像质量" : "Image quality", kind: "number", min: 1, max: 100, visibleWhen: (values) => values.action !== "status" },
  ]
  return {
    id: "vert", title: "VERT", description: zh ? "CLI 优先、Wasm 回退的本地万能格式转换器" : "Local universal converter with CLI-first execution and Wasm fallback", initialValues, fields,
    view: { sections: [{ id: "convert", title: zh ? "转换工作台" : "Conversion workbench", fieldIds: fields.map((field) => field.id) }], dashboard: { title: "VERT", display: (values) => ({ primary: String(values.targetFormat || "—"), secondary: values.engine === "auto" ? "CLI → Wasm" : String(values.engine), metrics: [{ label: zh ? "文件" : "Files", value: String(String(values.paths ?? "").split(/\r?\n/).filter(Boolean).length) }] }) } },
    toInput: (values) => ({ action: values.action === "convert" || values.action === "status" ? values.action : "plan", paths: String(values.paths ?? "").split(/[\r\n;]+/).map((item) => item.trim()).filter(Boolean), targetFormat: String(values.targetFormat ?? ""), outputDirectory: String(values.outputDirectory ?? ""), engine: values.engine === "cli" || values.engine === "wasm" ? values.engine : "auto", overwrite: Boolean(values.overwrite), quality: Number(values.quality ?? 90) }),
    validate: (_values, input) => input.action === "status" || (input.paths?.length && input.targetFormat) ? null : zh ? "至少输入一个文件并选择目标格式。" : "Enter a file and target format.",
    preview: (input) => [input.action === "status" ? (zh ? "检查本机转换引擎" : "Check native engines") : `${input.paths?.length ?? 0} → .${input.targetFormat}`, input.engine === "auto" ? "CLI → Wasm" : String(input.engine)],
    isDangerous: (input) => input.action === "convert" && Boolean(input.overwrite),
    dangerPrompt: () => ({ title: zh ? "确认覆盖转换" : "Confirm overwrite", body: zh ? "同名目标文件可能被覆盖。" : "Existing output files may be overwritten.", confirmLabel: zh ? "开始转换" : "Convert" }),
    result: (result) => ({ success: result.success, message: result.message, lines: result.data ? [`CLI plans: ${result.data.commands.length}`, `Outputs: ${result.data.outputPaths.length}`, `Fallback: ${result.data.wasmFallbackRequired ? "Wasm" : "no"}`] : [] }),
  }
}
