#!/usr/bin/env node
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  nodeCliName,
  promptRich,
  renderProgressBar,
  rich,
  runMain,
  selectRich,
  terminalColumns,
  truncateVisible,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { getNodeConfig, loadXiraniteConfig, resolveXiraniteConfigPath } from "@xiranite/config"

import type { OwithuAction, OwithuEntry, OwithuInput, OwithuResult, RegistryHive } from "./core.js"
import { runOwithu } from "./core.js"
import { createNodeOwithuRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("owithu")

interface OwithuCliOptions {
  config?: string
  hive?: RegistryHive
  key?: string
  json?: boolean
}

interface GuidedTask {
  action: OwithuAction
  name: string
  description: string
}

type GuidedSelection = "exit" | OwithuAction
type HiveChoice = "config" | RegistryHive

const GUIDED_TASKS: GuidedTask[] = [
  {
    action: "preview",
    name: "preview",
    description: "预览 TOML 配置中的右键菜单条目和注册表操作",
  },
  {
    action: "register",
    name: "register",
    description: "注册 enabled 条目到 Windows 注册表",
  },
  {
    action: "unregister",
    name: "unregister",
    description: "从 Windows 注册表移除右键菜单条目",
  },
]

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Manage Windows Open-with context menu entries from TOML.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  if (args.length === 0) {
    await runGuided(host)
    return
  }
  await runMain(createProgram(host), { rawArgs: args })
}

function createDefaultHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: { name: CLI_NAME, description: "Windows Open-with context menu registry helper." },
    subCommands: {
      preview: defineCommand({
        meta: { name: "preview", description: "Preview registry operations from TOML." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "preview", ...inputFromArgs(args as OwithuCliOptions) }, Boolean(args.json), host)
        },
      }),
      register: defineCommand({
        meta: { name: "register", description: "Register enabled context-menu entries." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "register", ...inputFromArgs(args as OwithuCliOptions) }, Boolean(args.json), host)
        },
      }),
      unregister: defineCommand({
        meta: { name: "unregister", description: "Remove context-menu entries." },
        args: commonArgs(),
        async run({ args }) {
          await runAction({ action: "unregister", ...inputFromArgs(args as OwithuCliOptions) }, Boolean(args.json), host)
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Open the rich guided terminal workflow." },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

function commonArgs() {
  return {
    config: { type: "string", alias: "c", description: "Path to owithu.toml." },
    hive: { type: "string", description: "Registry hive override: HKCU, HKCR, or HKLM." },
    key: { type: "string", description: "Only process this entry key." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: OwithuCliOptions): Omit<OwithuInput, "action"> {
  return {
    path: args.config,
    hive: args.hive,
    onlyKey: args.key,
  }
}

async function runAction(input: OwithuInput, json: boolean, host: CliHost): Promise<OwithuResult> {
  let progressActive = false
  const result = await runOwithu(input, createNodeOwithuRuntime(), json ? undefined : (event) => {
    if (event.type === "progress") {
      writeProgress(host, renderProgressBar(host, event.progress ?? 0, event.message, { label: CLI_NAME }))
      progressActive = true
      return
    }
    endProgress(host, progressActive)
    progressActive = false
    if (event.message.trim()) writeLine(host, rich(host, event.message, "grey"))
  })
  endProgress(host, progressActive)

  if (json) {
    writeJson(host, result)
    if (!result.success) process.exitCode = 1
    return result
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeOwithuSummary(host, result, input.action ?? "preview")
  if (!result.success) process.exitCode = 1
  return result
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} preview --config <path> --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  let firstRender = true
  try {
    while (true) {
      const defaultConfig = await detectDefaultConfig(host)
      renderGuidedIntro(host, firstRender, defaultConfig)
      firstRender = false

      const choice = await readGuidedChoice(host)
      if (choice === "exit") {
        writeLine(host, rich(host, "已退出。", "yellow"))
        return
      }

      const configPath = await resolvePaths(host, defaultConfig)
      if (!configPath) {
        if (!await confirmRich(host, "重新选择任务?", false)) return
        continue
      }

      const ok = await runGuidedTask(host, choice, configPath)
      if (!ok) process.exitCode = 1
      if (!await confirmRich(host, "继续选择其他任务?", false)) return
    }
  } catch (error) {
    if (error instanceof CliPromptExitError) {
      writeLine(host, rich(host, "已退出。", "yellow"))
      return
    }
    throw error
  }
}

function renderGuidedIntro(host: CliHost, includeHeader: boolean, defaultConfig: string | undefined): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  const lines = [
    `${rich(host, "入口", "cyan")}  TOML 驱动的 Windows 右键菜单注册工具`,
    `${rich(host, "操作", "cyan")}  preview 预览 / register 注册 / unregister 移除`,
    `${rich(host, "配置", "cyan")}  优先使用当前目录的 owithu.toml，否则手动粘贴或读取剪贴板`,
    `${rich(host, "安全", "cyan")}  register/unregister 前会先预览条目，再二次确认`,
  ]
  if (defaultConfig) lines.push(`${rich(host, "默认", "green")}  ${truncateVisible(defaultConfig, columns - 12)}`)
  writeRichPanel(host, "Xiranite Owithu", lines, { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: 脚本化请用 \`${CLI_NAME} preview --config <path> --json\`；guided 适合交互式操作。`, "grey"))
}

async function readGuidedChoice(host: CliHost): Promise<GuidedSelection> {
  return await selectRich<GuidedSelection>(
    host,
    "选择操作",
    [
      ...GUIDED_TASKS.map((task) => ({ value: task.action as GuidedSelection, label: task.name, hint: task.description })),
      { value: "exit", label: "exit", hint: "退出 guided 模式" },
    ],
    { initialValue: "preview", maxItems: 5 },
  )
}

async function resolvePaths(host: CliHost, defaultConfig: string | undefined): Promise<string | undefined> {
  const direct = (await promptRich(host, "粘贴 owithu.toml 路径", defaultConfig ?? "")).trim()
  if (direct) {
    const cleaned = cleanPath(direct)
    if (await pathExists(cleaned)) return cleaned
    writeRichPanel(host, "Path", `找不到配置文件: ${cleaned}`, { color: "red", minWidth: 48 })
  }

  const clipboard = (await readClipboardText()).trim()
  if (clipboard) {
    const candidate = cleanPath(clipboard.split(/\r?\n/)[0] ?? "")
    if (candidate && (await pathExists(candidate))) {
      writeLine(host, rich(host, `已从剪贴板读取: ${candidate}`, "yellow"))
      return candidate
    }
  }

  const retry = (await promptRich(host, "请再次输入配置文件路径 (留空退出)", "")).trim()
  if (!retry) return undefined
  const cleanedRetry = cleanPath(retry)
  if (await pathExists(cleanedRetry)) return cleanedRetry

  writeRichPanel(host, "Path", `仍然找不到配置文件: ${cleanedRetry}`, { color: "red", minWidth: 48 })
  return undefined
}

async function runGuidedTask(host: CliHost, action: OwithuAction, configPath: string): Promise<boolean> {
  if (action === "preview") {
    const result = await runAction({ action: "preview", path: configPath }, false, host)
    return result.success
  }

  const hive = await resolveHive(host)
  const keys = await resolveKeys(host, configPath, action)
  if (!keys) {
    writeLine(host, rich(host, "未选择任何条目，已取消。", "yellow"))
    return false
  }

  writeOwithuPlanPreview(host, configPath, hive, keys, action)

  const confirmed = await confirmRich(
    host,
    `确认${action === "register" ? "注册" : "移除"}以上条目?`,
    action === "register",
  )
  if (!confirmed) {
    writeLine(host, rich(host, "已取消。", "yellow"))
    return false
  }

  let ok = true
  for (const key of keys) {
    const result = await runAction(
      { action, path: configPath, hive, onlyKey: key || undefined },
      false,
      host,
    )
    if (!result.success) ok = false
  }
  return ok
}

async function resolveHive(host: CliHost): Promise<RegistryHive | ""> {
  const choice = await selectRich<HiveChoice>(
    host,
    "选择写入的注册表 Hive",
    [
      { value: "config", label: "按配置决定", hint: "使用 entries/defaults 中的 hives" },
      { value: "HKCU", label: "HKCU", hint: "当前用户，不需要管理员" },
      { value: "HKCR", label: "HKCR", hint: "所有用户，可能需要管理员" },
      { value: "HKLM", label: "HKLM", hint: "本机所有用户，需要管理员" },
    ],
    { initialValue: "config", maxItems: 4 },
  )
  return choice === "config" ? "" : choice
}

async function resolveKeys(host: CliHost, configPath: string, action: OwithuAction): Promise<string[] | undefined> {
  let entries: OwithuEntry[] = []
  try {
    const result = await runOwithu({ action: "preview", path: configPath }, createNodeOwithuRuntime())
    if (result.success) entries = result.data?.entries ?? []
  } catch {
    // ignore; will fall through to error
  }

  if (!entries.length) {
    writeRichPanel(host, "Entries", "未读取到任何条目，请检查 TOML 配置。", { color: "yellow", minWidth: 48 })
    return undefined
  }

  writeLine(host, rich(host, "可用条目:", "cyan"))
  for (const [index, entry] of entries.entries()) {
    const mark = entry.enabled ? rich(host, "✓", "green") : rich(host, "✗", "grey")
    writeLine(
      host,
      `  ${rich(host, String(index + 1), "cyan")}. ${mark} ${rich(host, entry.key, "magenta")} — ${truncateVisible(entry.label, 28)} [${entry.scope.join(",")}]`,
    )
  }

  const all = await confirmRich(host, action === "register" ? "要注册所有条目吗?" : "要移除所有条目吗?", action === "register")
  if (all) return [""]

  const answer = (await promptRich(host, "输入要处理的序号或 key（逗号分隔）", "")).trim()
  if (!answer) return undefined

  const selected = splitArg(answer)
    .map((token) => {
      const numeric = Number.parseInt(token, 10)
      if (Number.isFinite(numeric) && numeric >= 1 && numeric <= entries.length) return entries[numeric - 1]!.key
      const match = entries.find((entry) => entry.key.toLowerCase() === token.toLowerCase())
      return match?.key
    })
    .filter((value): value is string => Boolean(value))

  if (!selected.length) return undefined
  return [...new Set(selected)]
}

function writeOwithuPlanPreview(
  host: CliHost,
  configPath: string,
  hive: RegistryHive | "",
  keys: string[],
  action: OwithuAction,
): void {
  const columns = terminalColumns(host)
  const lines = [
    `${rich(host, "配置", "cyan")}  ${truncateVisible(configPath, columns - 14)}`,
    `${rich(host, "Hive", "cyan")}  ${hive || "按配置决定"}`,
    `${rich(host, "条目", "cyan")}  ${keys[0] === "" ? "全部条目" : keys.join(", ")}`,
    `${rich(host, "操作", action === "register" ? "green" : "yellow")}  ${action === "register" ? "register 写入注册表" : "unregister 删除注册表项"}`,
  ]
  writeRichPanel(host, "将执行以下操作", lines, {
    color: action === "register" ? "green" : "yellow",
    maxWidth: columns - 2,
    minWidth: Math.min(76, columns - 6),
  })
}

function writeOwithuSummary(host: CliHost, result: OwithuResult, action: OwithuAction): void {
  const data = result.data
  if (!data) return

  const columns = terminalColumns(host)

  if (action === "preview") {
    const entryLines = data.entries.slice(0, 20).map((entry) => {
      const mark = entry.enabled ? rich(host, "✓", "green") : rich(host, "✗", "grey")
      const scopes = entry.scope.join(",")
      return `${mark} ${rich(host, entry.key, "magenta")} | ${truncateVisible(entry.label, 24)} | ${scopes} | ${truncateVisible(entry.exe, 48)}`
    })
    writeRichPanel(host, "Entries", [
      `共 ${data.entries.length} 个条目，${data.plan.length} 个注册表操作。`,
      ...entryLines,
      ...(data.entries.length > 20 ? [rich(host, `... 还有 ${data.entries.length - 20} 个条目`, "grey")] : []),
    ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
    return
  }

  const summaryLines = [
    `${rich(host, "成功", "green")}  ${action === "register" ? data.registeredCount : data.unregisteredCount}`,
    `${rich(host, "失败", "red")}  ${data.failedCount}`,
    `${rich(host, "计划", "cyan")}  ${data.plan.length} 个注册表操作`,
  ]
  writeRichPanel(host, "Summary", summaryLines, {
    color: result.success ? "green" : "yellow",
    maxWidth: columns - 2,
    minWidth: Math.min(76, columns - 6),
  })

  if (data.errors.length) {
    writeRichPanel(host, "Error", data.errors.slice(0, 10).join("\n"), { color: "red", minWidth: 76 })
  }
}

async function detectDefaultConfig(host: CliHost): Promise<string | undefined> {
  // Prefer xiranite.config.toml when it contains a [nodes.owithu] section
  const xiranitePath = resolveXiraniteConfigPath({ cwd: host.cwd, env: host.env })
  if (await pathExists(xiranitePath)) {
    try {
      const { config } = await loadXiraniteConfig({ configPath: xiranitePath })
      if (getNodeConfig(config, "owithu") !== undefined) {
        return xiranitePath
      }
    } catch {
      // xiranite.config.toml exists but failed to parse; fall through to legacy paths
    }
  }

  // Backward-compatible fallback: legacy standalone owithu.toml locations
  const cwd = host.cwd
  const candidates = [
    join(cwd, "owithu.toml"),
    join(cwd, "config", "owithu.toml"),
    join(cwd, "Xiranite", "owithu.toml"),
  ]
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }
  return undefined
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function cleanPath(value = ""): string {
  return value.trim().replace(/^["']|["']$/g, "")
}

function splitArg(value: string): string[] {
  return value
    .split(/[,;\r\n]/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function writeProgress(host: CliHost, line: string): void {
  if (host.stdout.isTTY) {
    host.stdout.write(`\r\u001b[2K${line}`)
    return
  }
  writeLine(host, line)
}

function endProgress(host: CliHost, active: boolean): void {
  if (active && host.stdout.isTTY) host.stdout.write("\n")
}

if (process.argv[1] && /\bcli\.js$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
