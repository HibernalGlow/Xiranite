import type { InteractionField, InteractionValues, TerminalInteractionSchema } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { CZKAWKA_TOOLS, type CzkawkaInput, type CzkawkaResult, type CzkawkaTool } from "./core.js"
import { createCzkawkaOptionFields, createCzkawkaScanInput, czkawkaOptionDefaults } from "./tool-options.js"

export type CzkawkaInteractionValues = InteractionValues & {
  tool: CzkawkaTool
  includedDirectoriesText: string
  excludedDirectoriesText: string
  excludedItemsText: string
  allowedExtensions: string
  excludedExtensions: string
  minimumFileSize: number
  maximumFileSize: number
  recursive: boolean
  useCache: boolean
  filterText: string
}

const LABELS_ZH: Record<CzkawkaTool, string> = {
  "duplicate-files": "重复文件",
  "empty-folders": "空文件夹",
  "big-files": "大文件",
  "empty-files": "空文件",
  "temporary-files": "临时文件",
  "similar-images": "相似图片",
  "similar-videos": "相似视频",
  "duplicate-music": "重复音频",
  "invalid-symlinks": "无效符号链接",
  "broken-files": "损坏文件",
  "bad-extensions": "不正确扩展名",
}

export function createCzkawkaInteractionSchema(defaults: Partial<CzkawkaInteractionValues> = {}, language: TerminalLanguage = "zh"): TerminalInteractionSchema<CzkawkaInput, CzkawkaResult> {
  const zh = language === "zh"
  const initialValues = { tool: "duplicate-files", includedDirectoriesText: "", excludedDirectoriesText: "", excludedItemsText: "", allowedExtensions: "", excludedExtensions: "", minimumFileSize: 1, maximumFileSize: Number.MAX_SAFE_INTEGER, recursive: true, useCache: true, filterText: "", ...czkawkaOptionDefaults(), ...defined(defaults) } as CzkawkaInteractionValues
  const fields: InteractionField[] = [
    { id: "tool", label: zh ? "扫描工具" : "Scanner", kind: "select", role: "action", options: CZKAWKA_TOOLS.map((tool) => ({ value: tool, label: zh ? LABELS_ZH[tool] : human(tool) })) },
    { id: "includedDirectoriesText", label: zh ? "包含目录" : "Included directories", kind: "path-list", lines: 4 },
    { id: "excludedDirectoriesText", label: zh ? "排除目录" : "Excluded directories", kind: "path-list", lines: 3 },
    { id: "excludedItemsText", label: zh ? "排除项目/通配模式" : "Excluded items / patterns", kind: "multiline", lines: 3 },
    { id: "allowedExtensions", label: zh ? "允许扩展名" : "Allowed extensions", kind: "text" },
    { id: "excludedExtensions", label: zh ? "排除扩展名" : "Excluded extensions", kind: "text" },
    { id: "minimumFileSize", label: zh ? "最小字节" : "Minimum bytes", kind: "number", min: 0, step: 1 },
    { id: "maximumFileSize", label: zh ? "最大字节" : "Maximum bytes", kind: "number", min: 1, step: 1 },
    { id: "recursive", label: zh ? "递归扫描" : "Recursive", kind: "boolean" },
    { id: "useCache", label: zh ? "使用缓存" : "Use cache", kind: "boolean" },
    ...createCzkawkaOptionFields(language),
    { id: "filterText", label: zh ? "结果过滤" : "Result filter", kind: "text" },
  ]
  return {
    id: "czkawka",
    title: "Czkawka",
    description: zh ? "11 项文件分析工具与安全结果管理" : "Eleven file-analysis tools with safe result management",
    initialValues,
    fields,
    view: { sections: [{ id: "tool", title: zh ? "工具与目录" : "Tool and directories", fieldIds: ["tool", "includedDirectoriesText", "excludedDirectoriesText", "recursive", "useCache"] }, { id: "filters", title: zh ? "过滤与算法" : "Filters and algorithms", fieldIds: fields.slice(3).map((field) => field.id) }], dashboard: { title: "Czkawka", display: (values) => ({ primary: lines(values.includedDirectoriesText)[0] ?? "Czkawka", secondary: zh ? LABELS_ZH[values.tool as CzkawkaTool] : human(String(values.tool)), metrics: [] }) } },
    toInput: (values) => createCzkawkaScanInput(values.tool as CzkawkaTool, values),
    validate: (_values, input) => input.includedDirectories?.length ? null : zh ? "请至少添加一个包含目录。" : "Add at least one included directory.",
    preview: (input) => [`${input.includedDirectories?.length ?? 0} root(s)`, human(input.tool ?? "duplicate-files")],
    isDangerous: () => false,
    result: (result) => ({ success: result.success, message: result.message, lines: result.data ? [`Files: ${result.data.fileCount}`, `Groups: ${result.data.groupCount}`, `Reclaimable: ${result.data.reclaimableBytes} B`] : [] }),
  }
}

export function czkawkaToolLabel(tool: CzkawkaTool, language: TerminalLanguage = "zh"): string { return language === "zh" ? LABELS_ZH[tool] : human(tool) }
const defined = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
const lines = (value: unknown) => String(value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
const human = (value: string) => value.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ")
