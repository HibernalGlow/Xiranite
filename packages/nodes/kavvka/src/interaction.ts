import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { DEFAULT_KAVVKA_KEYWORDS, type KavvkaAction, type KavvkaInput, type KavvkaResult } from "./core.js"

export type KavvkaInteractionValues = InteractionValues & { action: KavvkaAction; paths: string; scanRoots: string; keywordText: string; scanDepth: number; force: boolean; dryRun: boolean; strictArtist: boolean }

export const defaultKavvkaInteractionValues: KavvkaInteractionValues = {
  action: "scan", paths: "", scanRoots: "", keywordText: DEFAULT_KAVVKA_KEYWORDS.join(", "), scanDepth: 3, force: true, dryRun: true, strictArtist: false,
}

export function createKavvkaInteractionSchema(defaults: Partial<KavvkaInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<KavvkaInput, KavvkaResult> {
  const zh = language === "zh"
  const initialValues: KavvkaInteractionValues = { ...defaultKavvkaInteractionValues }
  for (const [key, value] of Object.entries(defaults)) if (value !== undefined) initialValues[key] = value
  const process = (values: Readonly<InteractionValues>) => values.action === "plan" || values.action === "process"
  const scan = (values: Readonly<InteractionValues>) => values.action === "scan"
  const fields: InteractionField[] = [
    { id: "action", label: zh ? "工作流" : "Workflow", kind: "select", role: "action", options: [{ value: "scan", label: zh ? "⌕ 扫描候选" : "Scan candidates" }, { value: "plan", label: zh ? "◌ 预演路径" : "Plan paths" }, { value: "process", label: zh ? "↳ 实际整理" : "Process folders" }] },
    { id: "scanRoots", label: zh ? "扫描根目录" : "Scan roots", kind: "path-list", lines: 5, visibleWhen: scan, placeholder: zh ? "每行一个要扫描的目录" : "One scan root per line" },
    { id: "paths", label: zh ? "源目录" : "Source folders", kind: "path-list", lines: 5, visibleWhen: process, placeholder: zh ? "每行一个待比较的画集目录" : "One gallery folder per line" },
    { id: "keywordText", label: zh ? "匹配关键词" : "Match keywords", kind: "multiline", lines: 3, visibleWhen: scan },
    { id: "scanDepth", label: zh ? "扫描深度" : "Scan depth", kind: "number", min: 0, max: 12, step: 1, visibleWhen: scan },
    { id: "force", label: zh ? "允许移动同级目录" : "Move sibling folders", kind: "boolean", visibleWhen: process },
    { id: "dryRun", label: zh ? "仅预演" : "Dry run", kind: "boolean", visibleWhen: process },
    { id: "strictArtist", label: zh ? "严格画师目录" : "Require [artist] folder", kind: "boolean", visibleWhen: process },
  ]
  return {
    id: "kavvka", title: "Kavvka", description: zh ? "扫描画集候选、生成 Czkawka 对比路径，并安全整理同级目录" : "Scan gallery candidates, prepare Czkawka paths, and safely organize sibling folders.", initialValues, fields,
    view: { sections: [{ id: "workbench", title: zh ? "Czkawka 路径工作台" : "Czkawka path workbench", fieldIds: fields.map((field) => field.id) }], dashboard: { title: "Kavvka", display(values) { const input = kavvkaInputFromInteractionValues(values); return { primary: input.action ?? "scan", secondary: input.dryRun !== false ? (zh ? "安全预演" : "Safe preview") : (zh ? "真实移动" : "Live move"), metrics: [{ label: zh ? "输入" : "Inputs", value: String(input.action === "scan" ? input.scanRoots?.length ?? 0 : input.paths?.length ?? 0) }] } } } },
    toInput: kavvkaInputFromInteractionValues,
    validate(_values, input) { return input.action === "scan" ? (input.scanRoots?.length ? null : zh ? "至少输入一个扫描根目录。" : "Enter at least one scan root.") : (input.paths?.length ? null : zh ? "至少输入一个源目录。" : "Enter at least one source folder.") },
    preview(input) { return [input.action === "scan" ? (zh ? `扫描根目录：${input.scanRoots?.length ?? 0}` : `Scan roots: ${input.scanRoots?.length ?? 0}`) : (zh ? `源目录：${input.paths?.length ?? 0}` : `Source folders: ${input.paths?.length ?? 0}`), input.action === "process" && input.dryRun === false ? (zh ? "将真实移动同级目录到 #compare" : "Will move sibling folders into #compare") : (zh ? "仅生成比较计划，不改动文件" : "Plan only; files stay unchanged")] },
    isDangerous: (input) => input.action === "process" && input.dryRun === false,
    dangerPrompt: () => ({ title: zh ? "确认移动同级目录" : "Confirm folder moves", body: zh ? "将把当前目录的同级目录移入 #compare。请先检查右侧的预演路径。" : "Sibling folders will be moved into #compare. Review the path plan first.", confirmLabel: zh ? "确认移动" : "Move folders" }),
    result(result) { const data = result.data; return { success: result.success, message: result.message, lines: data ? [`${zh ? "匹配" : "Matches"}: ${data.matchedPaths.length}`, `${zh ? "计划" : "Plans"}: ${data.processResults.length}`, `${zh ? "已移动" : "Moved"}: ${data.movedCount}`, `${zh ? "错误" : "Errors"}: ${data.errorCount}`] : [] } },
  }
}

export function kavvkaInputFromInteractionValues(values: Readonly<InteractionValues>): KavvkaInput {
  const action: KavvkaAction = values.action === "plan" || values.action === "process" ? values.action : "scan"
  return { action, paths: split(values.paths), scanRoots: split(values.scanRoots), keywordText: String(values.keywordText ?? ""), scanDepth: Number(values.scanDepth ?? 3), force: values.force !== false, dryRun: action === "plan" || values.dryRun !== false, strictArtist: values.strictArtist === true }
}

function split(value: unknown): string[] { return String(value ?? "").split(/[\r\n;]+/).map((item) => item.trim()).filter(Boolean) }
