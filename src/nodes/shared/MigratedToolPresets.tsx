import type { NodeRunResult } from "@xiranite/contract"
import type { PackuToolData, PackuToolInput } from "@xiranite/packu-node-runtime"
import type { GifuData, GifuFormat, GifuInput, GifuOutputMode } from "@xiranite/node-gifu/core"
import type { SimiuApplyMode, SimiuData, SimiuInput, SimiuScanOrder } from "@xiranite/node-simiu/core"
import type { JellyPotAction, JellyPotData, JellyPotInput } from "@xiranite/node-jellypot/core"
import type { EnvuConfigAction, EnvuConfigData, EnvuConfigInput } from "@xiranite/node-envuconfig/core"
import type { SmartZipAction, SmartZipData, SmartZipInput } from "@xiranite/node-smartzip/core"
import type { LucideIcon } from "lucide-react"
import {
  Archive,
  AudioLines,
  CalendarClock,
  Clapperboard,
  Clock3,
  FilePenLine,
  Film,
  FolderTree,
  Gauge,
  Image,
  Languages,
  ListOrdered,
  Workflow,
} from "lucide-react"
import {
  createMigratedToolComponent,
  lines,
  numberValue,
  textValue,
  words,
} from "./MigratedToolNode"
import type { MigratedToolSpec, ToolCardState, ToolOption, ToolSection, ToolStat } from "./MigratedToolNode"

const packuActions: ToolOption[] = [
  { value: "status", label: "状态", description: "检查配置候选、数据库路径和将要调用的 Python 模块。" },
  { value: "plan", label: "计划", description: "生成命令计划，不执行原工具。" },
  { value: "run", label: "运行", description: "调用原 PackU 模块；需要真实改动时再关闭 dry-run。" },
]

export function createPackuToolComponent(options: {
  id: string
  title: string
  description: string
  icon: LucideIcon
}) {
  return createMigratedToolComponent<PackuToolInput, PackuToolData>({
    id: options.id,
    title: options.title,
    description: options.description,
    icon: options.icon,
    actions: packuActions,
    defaultAction: "plan",
    fields: [
      { key: "pathsText", label: "路径", type: "textarea", rows: 5, placeholder: "每行一个文件或目录" },
      { key: "configPath", label: "配置 TOML", type: "text", placeholder: "可选：原工具配置文件路径" },
      { key: "databasePath", label: "运行记录 JSONL", type: "text", placeholder: "可选：留空使用默认 .xiranite 路径" },
      { key: "argsText", label: "原工具参数", type: "text", placeholder: "--flag value，传给 Python 模块" },
    ],
    advancedFields: [
      { key: "python", label: "Python", type: "text", placeholder: "python / py / venv python" },
      { key: "sourceRoot", label: "源码目录", type: "text", placeholder: "可选：覆盖 PackU sourceRoot" },
      { key: "moduleName", label: "模块名", type: "text", placeholder: "可选：覆盖 python -m 模块" },
      { key: "dryRun", label: "dry-run", type: "switch", defaultValue: true, placeholder: "只预演" },
      { key: "recordRun", label: "record-run", type: "switch", placeholder: "写入 JSONL 记录" },
    ],
    buildInput: (state, action) => ({
      action: action as PackuToolInput["action"],
      paths: lines(state.pathsText),
      args: words(state.argsText),
      configPath: textValue(state, "configPath"),
      databasePath: textValue(state, "databasePath"),
      python: textValue(state, "python"),
      sourceRoot: textValue(state, "sourceRoot"),
      moduleName: textValue(state, "moduleName"),
      dryRun: Boolean(state.dryRun),
      recordRun: Boolean(state.recordRun),
    }),
    summarize: (result) => {
      const data = result?.data
      return [
        { label: "路径", value: data?.selectedPaths?.length ?? 0 },
        { label: "命令", value: data?.command?.command ?? "-" },
        { label: "记录", value: data?.database?.enabled ? "on" : "off", tone: data?.database?.enabled ? "success" : "default" },
        { label: "结果", value: result ? (result.success ? "ok" : "error") : "-", tone: result?.success ? "success" : result ? "error" : "default" },
      ]
    },
    sections: (result) => packuSections(result),
    primaryLabel: (action, state) => action === "run" && !state.dryRun ? "运行" : action === "status" ? "检查" : "生成计划",
  })
}

export const PackuIcons = {
  nameu: FilePenLine,
  coveru: Image,
  timeu: Clock3,
  classf: Workflow,
  classq: FolderTree,
  snf: ListOrdered,
  synct: CalendarClock,
  transq: Languages,
  audiov: AudioLines,
  bitv: Gauge,
}

export function createGifuComponent() {
  return createMigratedToolComponent<GifuInput, GifuData>({
    id: "gifu",
    title: "Gifu",
    description: "扫描压缩包图片序列，并生成 GIF/WebP/APNG/视频转换计划。",
    icon: Film,
    actions: [
      { value: "inspect", label: "检查", description: "只读取路径和归档图片数量。" },
      { value: "plan", label: "计划", description: "生成输出路径和命令计划。" },
      { value: "make", label: "生成", description: "调用 gifu Python 模块执行转换。" },
    ],
    defaultAction: "plan",
    fields: [
      { key: "pathsText", label: "归档或目录", type: "textarea", rows: 5, placeholder: "每行一个 .zip/.cbz 或目录" },
      { key: "configPath", label: "配置 TOML", type: "text", placeholder: "可选：gifu.toml" },
      { key: "databasePath", label: "运行记录 JSONL", type: "text", placeholder: "可选：默认写到 .xiranite/gifu-runs.jsonl" },
      { key: "format", label: "格式", type: "select", options: options(["webp", "gif", "apng", "webm", "mp4", "auto"]) },
      { key: "outDir", label: "输出目录", type: "text", placeholder: "可选：留空按模式推导" },
      { key: "outMode", label: "输出模式", type: "select", options: labeledOptions([["same", "同目录"], ["separate", "独立目录"]]) },
    ],
    advancedFields: [
      { key: "durationMs", label: "帧时长 ms", type: "number", placeholder: "120" },
      { key: "maxWorkers", label: "并发", type: "number", placeholder: "0" },
      { key: "namePrefix", label: "文件名前缀", type: "text" },
      { key: "python", label: "Python", type: "text", placeholder: "python" },
      { key: "sourceRoot", label: "源码目录", type: "text" },
      { key: "dryRun", label: "dry-run", type: "switch", defaultValue: true, placeholder: "只生成计划" },
      { key: "recordRun", label: "record-run", type: "switch", placeholder: "写入 JSONL 记录" },
    ],
    buildInput: (state, action) => ({
      action: action as GifuInput["action"],
      paths: lines(state.pathsText),
      configPath: textValue(state, "configPath"),
      databasePath: textValue(state, "databasePath"),
      format: (textValue(state, "format") ?? "webp") as GifuFormat,
      outDir: textValue(state, "outDir"),
      outMode: (textValue(state, "outMode") ?? "same") as GifuOutputMode,
      durationMs: numberValue(state, "durationMs"),
      maxWorkers: numberValue(state, "maxWorkers"),
      namePrefix: textValue(state, "namePrefix"),
      python: textValue(state, "python"),
      sourceRoot: textValue(state, "sourceRoot"),
      dryRun: Boolean(state.dryRun),
      recordRun: Boolean(state.recordRun),
    }),
    summarize: (result) => archiveStats(result),
    sections: (result) => [
      commandSection(result?.data?.command),
      databaseSection(result?.data?.database),
      { title: "归档计划", items: result?.data?.archives ?? [] },
    ].filter(Boolean) as ToolSection[],
    primaryLabel: (action, state) => action === "make" && !state.dryRun ? "生成动画" : "生成计划",
  })
}

export function createSimiuComponent() {
  return createMigratedToolComponent<SimiuInput, SimiuData>({
    id: "simiu",
    title: "Simiu",
    description: "扫描图片目录，按相似/同组线索生成移动、复制或链接计划。",
    icon: Image,
    actions: [
      { value: "scan", label: "扫描", description: "只收集图片批次和计数。" },
      { value: "plan", label: "计划", description: "生成分组和文件操作。" },
      { value: "apply", label: "应用", description: "执行移动、复制或链接操作。" },
    ],
    defaultAction: "plan",
    fields: [
      { key: "rootsText", label: "图片根目录", type: "textarea", rows: 5, placeholder: "每行一个根目录" },
      { key: "configPath", label: "配置 TOML", type: "text" },
      { key: "databasePath", label: "运行记录 JSONL", type: "text" },
      { key: "mode", label: "应用模式", type: "select", options: labeledOptions([["move", "移动"], ["copy", "复制"], ["link", "硬链接/链接"]]) },
      { key: "scanOrder", label: "扫描顺序", type: "select", options: labeledOptions([["path", "路径"], ["smallest-first", "小文件优先"], ["deepest-first", "深层优先"]]) },
      { key: "namePrefix", label: "分组前缀", type: "text", placeholder: "simiu_set" },
    ],
    advancedFields: [
      { key: "minGroupSize", label: "最小组大小", type: "number", placeholder: "2" },
      { key: "sizeToleranceBytes", label: "尺寸容差 bytes", type: "number", placeholder: "0" },
      { key: "dryRun", label: "dry-run", type: "switch", defaultValue: true, placeholder: "只预演操作" },
      { key: "recordRun", label: "record-run", type: "switch", placeholder: "写入 JSONL 记录" },
    ],
    buildInput: (state, action) => ({
      action: action as SimiuInput["action"],
      roots: lines(state.rootsText),
      configPath: textValue(state, "configPath"),
      databasePath: textValue(state, "databasePath"),
      mode: (textValue(state, "mode") ?? "move") as SimiuApplyMode,
      scanOrder: (textValue(state, "scanOrder") ?? "path") as SimiuScanOrder,
      namePrefix: textValue(state, "namePrefix"),
      minGroupSize: numberValue(state, "minGroupSize"),
      sizeToleranceBytes: numberValue(state, "sizeToleranceBytes"),
      dryRun: state.dryRun === undefined ? true : Boolean(state.dryRun),
      recordRun: Boolean(state.recordRun),
    }),
    summarize: (result) => [
      { label: "图片", value: result?.data?.imageCount ?? 0 },
      { label: "分组", value: result?.data?.groupCount ?? 0 },
      { label: "操作", value: result?.data?.operations?.length ?? 0 },
      { label: "错误", value: result?.data?.errorCount ?? 0, tone: result?.data?.errorCount ? "error" : "default" },
    ],
    sections: (result) => [
      databaseSection(result?.data?.database),
      { title: "分组", items: result?.data?.groups ?? [] },
      { title: "操作", items: result?.data?.operations ?? [] },
    ].filter(Boolean) as ToolSection[],
    primaryLabel: (action, state) => action === "apply" && !state.dryRun ? "应用分组" : "生成计划",
  })
}

export function createJellyPotComponent() {
  return createMigratedToolComponent<JellyPotInput, JellyPotData>({
    id: "jellypot",
    title: "JellyPot",
    description: "检查 Jellyfin/PotPlayer 配置，并打开媒体、浏览器或注册表导入流程。",
    icon: Clapperboard,
    actions: [
      { value: "status", label: "状态", description: "检查 PotPlayer、浏览器和注册表路径。" },
      { value: "launch_media", label: "播放媒体", description: "把媒体路径交给 PotPlayer。" },
      { value: "open_jellyfin", label: "打开 Jellyfin", description: "打开 Jellyfin Web 首页。" },
      { value: "apply_registry", label: "导入注册表", description: "应用 PotPlayer 注册表配置。" },
    ],
    defaultAction: "status",
    fields: [
      { key: "configPath", label: "配置 JSON", type: "text", placeholder: "JellyPot config.json" },
      { key: "databasePath", label: "运行记录 JSONL", type: "text" },
      { key: "mediaPath", label: "媒体路径", type: "text", placeholder: "potplayer:// 或本地路径" },
      { key: "potplayerPath", label: "PotPlayer", type: "text" },
      { key: "browserPath", label: "浏览器", type: "text" },
    ],
    advancedFields: [
      { key: "dryRun", label: "dry-run", type: "switch", defaultValue: true, placeholder: "只生成命令" },
      { key: "recordRun", label: "record-run", type: "switch", placeholder: "写入 JSONL 记录" },
    ],
    buildInput: (state, action) => ({
      action: action as JellyPotAction,
      configPath: textValue(state, "configPath"),
      databasePath: textValue(state, "databasePath"),
      mediaPath: textValue(state, "mediaPath"),
      potplayerPath: textValue(state, "potplayerPath"),
      browserPath: textValue(state, "browserPath"),
      dryRun: Boolean(state.dryRun),
      recordRun: Boolean(state.recordRun),
    }),
    summarize: (result) => [
      { label: "检查项", value: result?.data?.checks?.length ?? 0 },
      { label: "存在", value: result?.data?.checks?.filter((item) => item.exists).length ?? 0, tone: "success" },
      { label: "命令", value: result?.data?.commands?.length ?? 0 },
      { label: "记录", value: result?.data?.database?.enabled ? "on" : "off" },
    ],
    sections: (result) => [
      databaseSection(result?.data?.database),
      { title: "依赖检查", items: result?.data?.checks ?? [] },
      { title: "命令", items: result?.data?.commands ?? [] },
      { title: "命令结果", items: result?.data?.commandResults ?? [] },
    ].filter(Boolean) as ToolSection[],
    primaryLabel: (action, state) => action === "status" ? "检查状态" : state.dryRun ? "预演命令" : "运行",
  })
}

export function createEnvuConfigComponent() {
  return createMigratedToolComponent<EnvuConfigInput, EnvuConfigData>({
    id: "envuconfig",
    title: "EnvU Config",
    description: "扫描、记录和备份 EnvU 装机配置、dotfile、注册表与工具 TOML。",
    icon: Archive,
    actions: [
      { value: "scan", label: "扫描", description: "列出匹配的配置文件。" },
      { value: "manifest", label: "清单", description: "生成备份清单路径和操作计划。" },
      { value: "backup", label: "备份", description: "复制配置文件并写入清单。" },
    ],
    defaultAction: "scan",
    fields: [
      { key: "root", label: "EnvU 根目录", type: "text", placeholder: "D:/1VSCODE/Projects/LazyCommand/EnvU" },
      { key: "backupDir", label: "备份目录", type: "text" },
      { key: "databasePath", label: "运行记录 JSONL", type: "text" },
      { key: "manifestName", label: "清单文件名", type: "text", placeholder: "envu-config-manifest.json" },
      { key: "includeText", label: "包含规则", type: "textarea", rows: 6, placeholder: "每行一个 glob 或目录前缀" },
    ],
    advancedFields: [
      { key: "dryRun", label: "dry-run", type: "switch", defaultValue: true, placeholder: "只生成计划" },
      { key: "recordRun", label: "record-run", type: "switch", placeholder: "写入 JSONL 记录" },
    ],
    buildInput: (state, action) => ({
      action: action as EnvuConfigAction,
      root: textValue(state, "root"),
      backupDir: textValue(state, "backupDir"),
      databasePath: textValue(state, "databasePath"),
      manifestName: textValue(state, "manifestName"),
      include: lines(state.includeText).length ? lines(state.includeText) : undefined,
      dryRun: Boolean(state.dryRun),
      recordRun: Boolean(state.recordRun),
    }),
    summarize: (result) => [
      { label: "文件", value: result?.data?.fileCount ?? 0 },
      { label: "大小", value: bytes(result?.data?.totalSize ?? 0) },
      { label: "操作", value: result?.data?.operations?.length ?? 0 },
      { label: "记录", value: result?.data?.database?.enabled ? "on" : "off" },
    ],
    sections: (result) => [
      databaseSection(result?.data?.database),
      { title: "清单", rows: [["manifest", result?.data?.manifestPath]] },
      { title: "文件", items: result?.data?.files ?? [] },
      { title: "备份操作", items: result?.data?.operations ?? [] },
    ].filter(Boolean) as ToolSection[],
    primaryLabel: (action, state) => action === "backup" && !state.dryRun ? "备份" : action === "scan" ? "扫描" : "生成清单",
  })
}

export function createSmartZipComponent() {
  return createMigratedToolComponent<SmartZipInput, SmartZipData>({
    id: "smartzip",
    title: "SmartZip",
    description: "读取 SmartZip INI，计划或启动打开、解压、编码解压和压缩工作流。",
    icon: Archive,
    actions: [
      { value: "status", label: "状态", description: "读取 INI 和可执行入口。" },
      { value: "extract", label: "解压", description: "标准解压模式。" },
      { value: "extract_codepage", label: "编码解压", description: "走 SmartZip 编码解压模式。" },
      { value: "open", label: "打开", description: "打开压缩包。" },
      { value: "archive", label: "压缩", description: "压缩选中路径。" },
      { value: "settings", label: "设置", description: "打开 SmartZip 设置入口。" },
    ],
    defaultAction: "status",
    fields: [
      { key: "pathsText", label: "路径", type: "textarea", rows: 5, placeholder: "每行一个压缩包、文件或目录" },
      { key: "iniPath", label: "INI", type: "text" },
      { key: "databasePath", label: "运行记录 JSONL", type: "text" },
      { key: "smartZipExe", label: "SmartZip EXE", type: "text" },
      { key: "smartZipAhk", label: "SmartZip AHK", type: "text" },
    ],
    advancedFields: [
      { key: "autohotkeyExe", label: "AutoHotkey", type: "text", placeholder: "AutoHotkey.exe" },
      { key: "dryRun", label: "dry-run", type: "switch", defaultValue: true, placeholder: "只生成命令" },
      { key: "recordRun", label: "record-run", type: "switch", placeholder: "写入 JSONL 记录" },
    ],
    buildInput: (state, action) => ({
      action: action as SmartZipAction,
      paths: lines(state.pathsText),
      iniPath: textValue(state, "iniPath"),
      databasePath: textValue(state, "databasePath"),
      smartZipExe: textValue(state, "smartZipExe"),
      smartZipAhk: textValue(state, "smartZipAhk"),
      autohotkeyExe: textValue(state, "autohotkeyExe"),
      dryRun: Boolean(state.dryRun),
      recordRun: Boolean(state.recordRun),
    }),
    summarize: (result) => [
      { label: "路径", value: result?.data?.selectedPaths?.length ?? 0 },
      { label: "压缩包", value: result?.data?.archiveCount ?? 0 },
      { label: "扩展", value: result?.data?.config?.archiveExtensions?.length ?? 0 },
      { label: "记录", value: result?.data?.database?.enabled ? "on" : "off" },
    ],
    sections: (result) => [
      commandSection(result?.data?.command),
      databaseSection(result?.data?.database),
      { title: "配置", rows: [["7zip", result?.data?.config?.sevenZipDir], ["密码数量", result?.data?.config?.passwords?.length], ["扩展", result?.data?.config?.archiveExtensions?.join(", ")]] },
    ].filter(Boolean) as ToolSection[],
    primaryLabel: (action, state) => action === "status" ? "检查" : state.dryRun ? "预演命令" : "启动 SmartZip",
  })
}

function packuSections(result: NodeRunResult<PackuToolData> | null): ToolSection[] {
  return [
    commandSection(result?.data?.command),
    databaseSection(result?.data?.database),
    result?.data?.integration ? {
      title: "集成",
      rows: [
        ["sourceRoot", result.data.integration.sourceRoot],
        ["module", result.data.integration.moduleName],
        ["config", result.data.integration.configCandidates?.join(", ")],
        ["record", result.data.integration.recordRun],
      ],
    } : undefined,
  ].filter(Boolean) as ToolSection[]
}

function archiveStats(result: NodeRunResult<GifuData> | null): ToolStat[] {
  return [
    { label: "归档", value: result?.data?.archives?.length ?? 0 },
    { label: "就绪", value: result?.data?.readyCount ?? 0, tone: "success" },
    { label: "单图", value: result?.data?.singleCount ?? 0 },
    { label: "空包", value: result?.data?.emptyCount ?? 0, tone: result?.data?.emptyCount ? "warning" : "default" },
  ]
}

function commandSection(command: unknown): ToolSection | undefined {
  if (!command) return undefined
  const record = command as { label?: string; command?: string; args?: string[]; cwd?: string }
  return {
    title: "命令",
    rows: [
      ["label", record.label],
      ["command", record.command],
      ["args", record.args?.join(" ")],
      ["cwd", record.cwd],
    ],
  }
}

function databaseSection(database: unknown): ToolSection | undefined {
  if (!database) return undefined
  const record = database as { path?: string; databasePath?: string; enabled?: boolean; defaultPath?: boolean; mode?: string }
  return {
    title: "数据库",
    rows: [
      ["path", record.path ?? record.databasePath],
      ["enabled", record.enabled],
      ["mode", record.mode],
      ["default", record.defaultPath],
    ],
  }
}

function options(values: string[]): ToolOption[] {
  return values.map((value) => ({ value, label: value }))
}

function labeledOptions(values: Array<[string, string]>): ToolOption[] {
  return values.map(([value, label]) => ({ value, label }))
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
