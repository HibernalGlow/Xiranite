import type { InteractionField, InteractionValues } from "@xiranite/cli-runtime/interaction"
import type { TerminalLanguage } from "@xiranite/cli-runtime/i18n"

import type { CzkawkaAction, CzkawkaInput, CzkawkaTool } from "./core.js"

type OptionId = Exclude<keyof CzkawkaInput, "action" | "tool" | "includedDirectories" | "includedDirectoriesReferenced" | "excludedDirectories" | "excludedItems" | "allowedExtensions" | "excludedExtensions" | "minimumFileSize" | "maximumFileSize" | "recursive" | "useCache" | "filterText" | "sortBy" | "descending" | "selectedPaths" | "destinationDirectory" | "deleteMode" | "copyMode" | "preserveStructure" | "conflictPolicy" | "outputPath" | "outputFormat" | "dryRun">
type OptionValue = string | number | boolean

export interface CzkawkaOptionDefinition {
  id: OptionId
  tools: readonly CzkawkaTool[]
  kind: "boolean" | "number" | "select"
  label: { zh: string; en: string }
  defaultValue: OptionValue
  min?: number
  max?: number
  choices?: ReadonlyArray<{ value: string; label?: string }>
  cliFlag: string
}

const DUPLICATE = ["duplicate-files"] as const
const BIG_FILES = ["big-files"] as const
const SIMILAR_IMAGES = ["similar-images"] as const
const SIMILAR_VIDEOS = ["similar-videos"] as const
const SIMILAR_MEDIA = ["similar-images", "similar-videos"] as const
const MUSIC = ["duplicate-music"] as const
const BROKEN = ["broken-files"] as const

export const CZKAWKA_TOOL_OPTIONS: readonly CzkawkaOptionDefinition[] = [
  option("checkMethod", DUPLICATE, "select", "判断方式", "Duplicate check", "hash", "--check", [{ value: "hash", label: "Hash" }, { value: "name", label: "名称 / Name" }, { value: "size", label: "大小 / Size" }, { value: "size-and-name", label: "大小与名称 / Size and name" }]),
  option("hashType", DUPLICATE, "select", "哈希算法", "Hash algorithm", "blake3", "--hash", ["blake3", "xxh3", "crc32"]),
  numberOption("duplicateMinimumGroupSize", DUPLICATE, "最小组大小", "Minimum group size", 1, "--min-group", 1, 10_000),
  booleanOption("caseSensitiveNames", DUPLICATE, "名称区分大小写", "Case-sensitive names", false, "--case-sensitive"),
  booleanOption("ignoreHardLinks", DUPLICATE, "忽略硬链接", "Ignore hard links", true, "--ignore-hard-links"),
  booleanOption("usePrehash", DUPLICATE, "使用预哈希", "Use prehash", true, "--prehash"),
  numberOption("numberOfFiles", BIG_FILES, "结果数量", "Result count", 50, "--count", 1, 100_000),
  booleanOption("biggestFirst", BIG_FILES, "优先最大文件", "Biggest first", true, "--biggest-first"),
  numberOption("similarity", SIMILAR_MEDIA, "最大差异", "Maximum difference", 10, "--similarity", 0, 40),
  option("similarImagesHashSize", SIMILAR_IMAGES, "select", "Hash 尺寸", "Hash size", 16, "--image-hash-size", ["8", "16", "32", "64"]),
  option("similarImagesHashAlgorithm", SIMILAR_IMAGES, "select", "Hash 算法", "Hash algorithm", "mean", "--image-hash", ["mean", "gradient", "blockhash", "vert-gradient", "double-gradient", "median"]),
  option("similarImagesResizeAlgorithm", SIMILAR_IMAGES, "select", "缩放算法", "Resize algorithm", "lanczos3", "--image-resize", ["lanczos3", "gaussian", "catmull-rom", "triangle", "nearest"]),
  booleanOption("similarImagesIgnoreSameSize", SIMILAR_IMAGES, "忽略相同尺寸", "Ignore same size", false, "--image-ignore-same-size"),
  numberOption("similarImagesFolderThreshold", SIMILAR_IMAGES, "文件夹阈值", "Folder threshold", 2, "--folder-threshold", 1, 10_000),
  booleanOption("similarVideosIgnoreSameSize", SIMILAR_VIDEOS, "忽略相同尺寸", "Ignore same size", false, "--video-ignore-same-size"),
  numberOption("similarVideosSkipForward", SIMILAR_VIDEOS, "跳过开头（秒）", "Skip forward (seconds)", 15, "--video-skip", 0, 3600),
  numberOption("similarVideosHashDuration", SIMILAR_VIDEOS, "Hash 时长（秒）", "Hash duration (seconds)", 10, "--video-duration", 2, 3600),
  option("similarVideosCropDetect", SIMILAR_VIDEOS, "select", "裁剪检测", "Crop detection", "letterbox", "--video-crop", ["letterbox", "motion", "none"]),
  option("musicCheckType", MUSIC, "select", "音频判断方式", "Audio check type", "tags", "--music-check", [{ value: "tags", label: "标签 / Tags" }, { value: "fingerprint", label: "音频指纹 / Fingerprint" }]),
  booleanOption("musicApproximateComparison", MUSIC, "近似标签比较", "Approximate tag comparison", true, "--music-approximate"),
  booleanOption("musicCompareTitle", MUSIC, "比较标题", "Compare title", true, "--music-title"),
  booleanOption("musicCompareArtist", MUSIC, "比较艺术家", "Compare artist", true, "--music-artist"),
  booleanOption("musicCompareBitrate", MUSIC, "比较比特率", "Compare bitrate", false, "--music-bitrate"),
  booleanOption("musicCompareGenre", MUSIC, "比较流派", "Compare genre", false, "--music-genre"),
  booleanOption("musicCompareYear", MUSIC, "比较年份", "Compare year", false, "--music-year"),
  booleanOption("musicCompareLength", MUSIC, "比较时长", "Compare length", false, "--music-length"),
  numberOption("musicMaximumDifference", MUSIC, "最大差异", "Maximum difference", 10, "--music-difference", 0, 10),
  numberOption("musicMinimumFragmentDuration", MUSIC, "最小片段时长", "Minimum fragment duration", 15, "--music-fragment", 0, 3600),
  booleanOption("musicCompareFingerprintsOnlyWithSimilarTitles", MUSIC, "指纹仅比较相似标题", "Fingerprint only with similar titles", true, "--music-similar-title"),
  booleanOption("brokenAudio", BROKEN, "检查音频", "Check audio", true, "--broken-audio"),
  booleanOption("brokenPdf", BROKEN, "检查 PDF", "Check PDF", true, "--broken-pdf"),
  booleanOption("brokenArchive", BROKEN, "检查压缩包", "Check archives", true, "--broken-archive"),
  booleanOption("brokenImage", BROKEN, "检查图片", "Check images", true, "--broken-image"),
]

export function getCzkawkaToolOptions(tool: CzkawkaTool): readonly CzkawkaOptionDefinition[] {
  return CZKAWKA_TOOL_OPTIONS.filter((definition) => definition.tools.includes(tool))
}

export function czkawkaOptionDefaults(): Partial<CzkawkaInput> {
  return Object.fromEntries(CZKAWKA_TOOL_OPTIONS.map((definition) => [definition.id, definition.defaultValue]))
}

export function createCzkawkaOptionFields(language: TerminalLanguage): InteractionField[] {
  return CZKAWKA_TOOL_OPTIONS.map((definition) => ({
    id: definition.id,
    label: definition.label[language === "zh" ? "zh" : "en"],
    kind: definition.kind,
    min: definition.min,
    max: definition.max,
    step: definition.kind === "number" ? 1 : undefined,
    options: definition.choices?.map((choice) => ({ value: choice.value, label: choice.label ?? human(choice.value) })),
    visibleWhen: (values: InteractionValues) => values.action === "scan" && definition.tools.includes(values.tool as CzkawkaTool),
  }))
}

export function valuesToCzkawkaOptions(values: Record<string, unknown>): Partial<CzkawkaInput> {
  return Object.fromEntries(CZKAWKA_TOOL_OPTIONS.map((definition) => [definition.id, coerceOptionValue(definition, values[definition.id])]))
}

/**
 * Shared GUI/CLI/TUI boundary. Surfaces keep their own widgets, but they all
 * translate display values into the core scan contract here.
 */
export function createCzkawkaScanInput(tool: CzkawkaTool, values: Record<string, unknown>): CzkawkaInput {
  return {
    action: "scan",
    tool,
    includedDirectories: lines(values.includedDirectoriesText ?? values.includedDirectories),
    includedDirectoriesReferenced: lines(values.includedDirectoriesReferencedText ?? values.includedDirectoriesReferenced),
    excludedDirectories: lines(values.excludedDirectoriesText ?? values.excludedDirectories),
    excludedItems: items(values.excludedItemsText ?? values.excludedItems),
    allowedExtensions: text(values.allowedExtensions),
    excludedExtensions: text(values.excludedExtensions),
    minimumFileSize: optionalNumber(values.minimumFileSize),
    maximumFileSize: optionalNumber(values.maximumFileSize),
    recursive: values.recursive !== false,
    useCache: values.useCache !== false,
    filterText: text(values.filterText),
    ...valuesToCzkawkaOptions(values),
  }
}

export function createCzkawkaOperationInput(action: Exclude<CzkawkaAction, "scan">, values: Record<string, unknown>): CzkawkaInput {
  const outputPath = text(values.outputPath)
  return {
    action,
    tool: values.tool as CzkawkaTool | undefined,
    selectedPaths: lines(values.selectedPathsText ?? values.selectedPaths),
    destinationDirectory: text(values.destinationDirectory),
    deleteMode: values.deleteMode === "permanent" ? "permanent" : "trash",
    copyMode: values.copyMode === true,
    preserveStructure: values.preserveStructure === true,
    conflictPolicy: ["skip", "overwrite", "rename", "error"].includes(String(values.conflictPolicy)) ? values.conflictPolicy as NonNullable<CzkawkaInput["conflictPolicy"]> : "skip",
    outputPath,
    outputFormat: outputPath?.toLowerCase().endsWith(".csv") || values.outputFormat === "csv" ? "csv" : "json",
    dryRun: values.dryRun !== false,
  }
}

export function parseCzkawkaCliOptions(args: string[]): Partial<CzkawkaInput> {
  const result: Record<string, OptionValue> = {}
  for (const definition of CZKAWKA_TOOL_OPTIONS) {
    if (definition.kind === "boolean") {
      if (args.includes(definition.cliFlag)) result[definition.id] = true
      if (args.includes(`--no-${definition.cliFlag.slice(2)}`)) result[definition.id] = false
      continue
    }
    const index = args.indexOf(definition.cliFlag)
    if (index < 0 || args[index + 1] === undefined) continue
    result[definition.id] = coerceOptionValue(definition, args[index + 1])
  }
  return result as Partial<CzkawkaInput>
}

export const CZKAWKA_CLI_VALUE_FLAGS = new Set(CZKAWKA_TOOL_OPTIONS.filter((definition) => definition.kind !== "boolean").map((definition) => definition.cliFlag))

function option(id: OptionId, tools: readonly CzkawkaTool[], kind: CzkawkaOptionDefinition["kind"], zh: string, en: string, defaultValue: OptionValue, cliFlag: string, choices?: readonly (string | { value: string; label?: string })[]): CzkawkaOptionDefinition {
  return { id, tools, kind, label: { zh, en }, defaultValue, cliFlag, choices: choices?.map((choice) => typeof choice === "string" ? { value: choice } : choice) }
}
function numberOption(id: OptionId, tools: readonly CzkawkaTool[], zh: string, en: string, defaultValue: number, cliFlag: string, min: number, max: number) { return { ...option(id, tools, "number", zh, en, defaultValue, cliFlag), min, max } }
function booleanOption(id: OptionId, tools: readonly CzkawkaTool[], zh: string, en: string, defaultValue: boolean, cliFlag: string) { return option(id, tools, "boolean", zh, en, defaultValue, cliFlag) }
function coerceOptionValue(definition: CzkawkaOptionDefinition, value: unknown): OptionValue { const candidate = value ?? definition.defaultValue; return typeof definition.defaultValue === "number" ? Number(candidate) : typeof definition.defaultValue === "boolean" ? candidate !== false && candidate !== "false" : String(candidate) }
function human(value: string) { return value.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ") }
function lines(value: unknown): string[] { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : String(value ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }
function items(value: unknown): string[] { return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : String(value ?? "").split(/[;\r\n]/).map((item) => item.trim()).filter(Boolean) }
function optionalNumber(value: unknown): number | undefined { if (value === undefined || value === null || String(value).trim() === "") return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined }
function text(value: unknown): string | undefined { return value === undefined || value === null ? undefined : String(value) }
