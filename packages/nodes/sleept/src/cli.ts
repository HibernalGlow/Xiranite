#!/usr/bin/env node
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
  runGuidedInteraction,
  runMain,
  selectRich,
  terminalColumns,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type {
  CliCommand,
  CliHost,
} from "@xiranite/cli-runtime"
import {
  requireInteractiveMode,
  resolveCliInvocation,
  resolveInteractionPreferences,
  resolveTerminalUiFlags,
} from "@xiranite/cli-runtime/interaction"
import type {
  CliInteractionPreferencesSource,
  TerminalInteractionDefinition,
  TerminalRenderer,
} from "@xiranite/cli-runtime/interaction"
import { resolveTerminalLanguage, type TerminalLanguage } from "@xiranite/cli-runtime/i18n"
import { listTerminalThemes, runTerminalUi } from "@xiranite/cli-runtime/terminal"
import { loadNodeConfigWithHints } from "@xiranite/config"

import type { NetTriggerMode, PowerMode, SleeptAction, SleeptInput, SleeptResult, SleeptRuntime } from "./core.js"
import { runSleept } from "./core.js"
import { createSleeptInteractionSchema, type SleeptInteractionValues } from "./interaction.js"
import { createNodeSleeptRuntime, readClipboardText } from "./platform.js"

const CLI_NAME = nodeCliName("sleept")
export const SLEEPT_MAX_WAIT_HELP = "Maximum wait in seconds; use 0 to monitor indefinitely."

interface SleeptNodeConfig extends CliInteractionPreferencesSource {
  timerMode?: SleeptInteractionValues["action"]
  powerMode?: PowerMode
  power_mode?: PowerMode
  dryrun?: boolean
  hours?: number
  minutes?: number
  seconds?: number
  target_datetime?: string
  upload_threshold?: number
  download_threshold?: number
  net_duration?: number
  net_trigger_mode?: NetTriggerMode
  cpu_threshold?: number
  cpu_duration?: number
  max_wait_seconds?: number
}

interface SleeptDefaults {
  interactionMode?: "ui" | "gd"
  interactionRenderer?: TerminalRenderer
  interactionLanguage?: TerminalLanguage
  interactionTheme?: string
  action?: SleeptInteractionValues["action"]
  powerMode?: PowerMode
  dryrun?: boolean
  hours?: number
  minutes?: number
  seconds?: number
  targetDatetime?: string
  uploadThreshold?: number
  downloadThreshold?: number
  netDuration?: number
  netTriggerMode?: NetTriggerMode
  cpuThreshold?: number
  cpuDuration?: number
  maxWaitSeconds?: number
}

async function resolveSleeptDefaults(host: CliHost, json = false): Promise<SleeptDefaults> {
  try {
    const { config: nodeConfig } = await loadNodeConfigWithHints<SleeptNodeConfig>("sleept", {
      env: host.env,
      cwd: host.cwd,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    })
    const interaction = resolveInteractionPreferences(nodeConfig)
    return {
      interactionMode: interaction.mode,
      interactionRenderer: interaction.renderer,
      interactionLanguage: interaction.language,
      interactionTheme: interaction.theme,
      action: nodeConfig?.timerMode,
      powerMode: nodeConfig?.power_mode ?? nodeConfig?.powerMode,
      dryrun: nodeConfig?.dryrun,
      hours: nodeConfig?.hours,
      minutes: nodeConfig?.minutes,
      seconds: nodeConfig?.seconds,
      targetDatetime: nodeConfig?.target_datetime?.trim() || undefined,
      uploadThreshold: nodeConfig?.upload_threshold,
      downloadThreshold: nodeConfig?.download_threshold,
      netDuration: nodeConfig?.net_duration,
      netTriggerMode: nodeConfig?.net_trigger_mode,
      cpuThreshold: nodeConfig?.cpu_threshold,
      cpuDuration: nodeConfig?.cpu_duration,
      maxWaitSeconds: nodeConfig?.max_wait_seconds,
    }
  } catch {
    return {}
  }
}

type GuidedAction = "countdown" | "specific_time" | "netspeed" | "cpu" | "status" | "exit"
type PowerChoice = PowerMode | "exit"
type TriggerChoice = NetTriggerMode | "exit"

interface SleeptCliOptions {
  hours?: string
  minutes?: string
  seconds?: string
  target?: string
  upload?: string
  download?: string
  duration?: string
  trigger?: string
  threshold?: string
  maxWait?: string
  power?: string
  dryrun?: boolean
  json?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "System timer with countdown, scheduled time, network, and CPU triggers.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export interface SleeptCliDependencies {
  createRuntime: () => SleeptRuntime
  runGuide: <Input, Result>(
    definition: TerminalInteractionDefinition<Input, Result>,
    options: { host: CliHost; language: TerminalLanguage },
  ) => Promise<void>
  runUi: <Input, Result>(
    definition: TerminalInteractionDefinition<Input, Result>,
    options: {
      host: CliHost
      renderer: TerminalRenderer
      language: TerminalLanguage
      theme?: string
      reexec?: { entrypoint: string; args: readonly string[] }
    },
  ) => Promise<void>
}

const defaultDependencies: SleeptCliDependencies = {
  createRuntime: createNodeSleeptRuntime,
  runGuide: runGuidedInteraction,
  runUi: runTerminalUi,
}

export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createDefaultHost(),
  dependencies: SleeptCliDependencies = defaultDependencies,
): Promise<void> {
  if (args.length === 0 && (!host.stdin.isTTY || !host.stdout.isTTY)) {
    writeError(host, `No interactive terminal detected. Use \`${CLI_NAME} status --json\` or run \`${CLI_NAME} ui\` in a terminal.`)
    process.exitCode = 2
    return
  }

  const explicitInvocation = resolveCliInvocation(args, host, "ui")
  if (args.length > 0 && explicitInvocation !== "pipe") {
    const ttyError = requireInteractiveMode(host, explicitInvocation)
    if (ttyError) {
      writeError(host, ttyError)
      process.exitCode = 2
      return
    }
  }

  if (explicitInvocation === "pipe") {
    await runMain(createProgram(host), { rawArgs: args })
    return
  }

  if (args.includes("--help") || args.includes("-h")) {
    await runMain(createProgram(host), { rawArgs: args })
    return
  }

  // Interactive renderers own the full screen; config hints would corrupt it.
  const defaults = await resolveSleeptDefaults(host, true)
  const invocation = args.length === 0
    ? resolveCliInvocation(args, host, defaults.interactionMode ?? "ui")
    : explicitInvocation

  const flags = resolveTerminalUiFlags(args.slice(1), {
    renderer: defaults.interactionRenderer ?? "opentui",
    language: defaults.interactionLanguage ?? resolveTerminalLanguage(undefined, host.env),
    theme: defaults.interactionTheme,
  })
  if (flags.error || flags.args.length > 0 || !flags.renderer || !flags.language) {
    writeError(host, flags.error ?? `Unknown ui argument: ${flags.args[0]}.`)
    process.exitCode = 2
    return
  }
  if (flags.theme && !listTerminalThemes().includes(flags.theme)) {
    writeError(host, `Unknown terminal theme: ${flags.theme}. Available themes: ${listTerminalThemes().join(", ")}.`)
    process.exitCode = 2
    return
  }

  const definition = createSleeptUiDefinition(defaults, flags.language, dependencies.createRuntime)
  if (invocation === "gd") {
    await dependencies.runGuide(definition, { host, language: flags.language })
    return
  }
  await dependencies.runUi(definition, {
    host,
    renderer: flags.renderer,
    language: flags.language,
    theme: flags.theme,
    reexec: process.argv[1] ? { entrypoint: process.argv[1], args } : undefined,
  })
}

function createSleeptUiDefinition(
  defaults: SleeptDefaults,
  language: TerminalLanguage,
  createRuntime: () => SleeptRuntime,
): TerminalInteractionDefinition<SleeptInput, SleeptResult> {
  let cancelled = false
  const schema = createSleeptInteractionSchema({
    action: defaults.action,
    powerMode: defaults.powerMode,
    dryrun: defaults.dryrun,
    hours: defaults.hours,
    minutes: defaults.minutes,
    seconds: defaults.seconds,
    targetDatetime: defaults.targetDatetime,
    uploadThreshold: defaults.uploadThreshold,
    downloadThreshold: defaults.downloadThreshold,
    netDuration: defaults.netDuration,
    netTriggerMode: defaults.netTriggerMode,
    cpuThreshold: defaults.cpuThreshold,
    cpuDuration: defaults.cpuDuration,
    maxWaitSeconds: defaults.maxWaitSeconds,
  }, language)
  return {
    schema,
    async run(input, onEvent) {
      cancelled = false
      const runtime = createRuntime()
      return runSleept(input, { ...runtime, isCancelled: () => cancelled }, onEvent)
    },
    cancel() {
      cancelled = true
    },
  }
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
    meta: { name: CLI_NAME, description: "System timer CLI with ui, gd, and pipe-safe subcommands." },
    subCommands: {
      ui: defineCommand({
        meta: { name: "ui", description: "Open the full terminal UI using OpenTUI." },
        args: {
          renderer: { type: "string", description: "opentui." },
          lang: { type: "string", description: "en or zh." },
          theme: { type: "string", description: "default, dracula, or high-contrast." },
        },
        async run({ args }) {
          const rawArgs = ["ui"]
          if (args.renderer) rawArgs.push("--renderer", String(args.renderer))
          if (args.lang) rawArgs.push("--lang", String(args.lang))
          if (args.theme) rawArgs.push("--theme", String(args.theme))
          await runProgram(rawArgs, host)
        },
      }),
      gd: defineCommand({
        meta: { name: "gd", description: "Open the compact guided terminal workflow." },
        async run() {
          await runProgram(["gd"], host)
        },
      }),
      status: defineCommand({
        meta: { name: "status", description: "Print current system status." },
        args: { json: { type: "boolean", description: "Print JSON result." } },
        async run({ args }) {
          await runAction({ action: "get_stats" }, Boolean(args.json), host)
        },
      }),
      countdown: defineCommand({
        meta: { name: "countdown", description: "Run a countdown timer." },
        args: timerArgs(),
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveSleeptDefaults(host, json)
          await runAction(inputFromCountdownArgs(args as SleeptCliOptions, defaults), json, host)
        },
      }),
      at: defineCommand({
        meta: { name: "at", description: "Run at a specific datetime." },
        args: {
          target: { type: "string", required: true, description: "Target datetime: YYYY-MM-DD HH:MM:SS." },
          power: { type: "string", description: "sleep, shutdown, or restart." },
          dryrun: { type: "boolean", description: "Simulate the power action." },
          json: { type: "boolean", description: "Print JSON result." },
        },
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveSleeptDefaults(host, json)
          await runAction(
            {
              action: "specific_time",
              targetDatetime: String(args.target),
              powerMode: powerMode(args.power ?? defaults.powerMode),
              dryrun: Boolean(args.dryrun ?? defaults.dryrun ?? true),
            },
            json,
            host,
          )
        },
      }),
      netspeed: defineCommand({
        meta: { name: "netspeed", description: "Trigger after sustained low network throughput." },
        args: {
          upload: { type: "string", description: "Upload threshold in KB/s." },
          download: { type: "string", description: "Download threshold in KB/s." },
          duration: { type: "string", description: "Low-speed duration in minutes." },
          trigger: { type: "string", description: "both or any." },
          maxWait: { type: "string", description: SLEEPT_MAX_WAIT_HELP },
          power: { type: "string", description: "sleep, shutdown, or restart." },
          dryrun: { type: "boolean", description: "Simulate the power action." },
          json: { type: "boolean", description: "Print JSON result." },
        },
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveSleeptDefaults(host, json)
          await runAction(
            {
              action: "netspeed",
              uploadThreshold: Number(args.upload ?? defaults.uploadThreshold ?? 242),
              downloadThreshold: Number(args.download ?? defaults.downloadThreshold ?? 242),
              netDuration: Number(args.duration ?? defaults.netDuration ?? 2),
              netTriggerMode: (args.trigger ?? defaults.netTriggerMode ?? "both") === "any" ? "any" : "both",
              maxWaitSeconds: Number(args.maxWait ?? defaults.maxWaitSeconds ?? 3600),
              powerMode: powerMode(args.power ?? defaults.powerMode),
              dryrun: Boolean(args.dryrun ?? defaults.dryrun ?? true),
            },
            json,
            host,
          )
        },
      }),
      cpu: defineCommand({
        meta: { name: "cpu", description: "Trigger after sustained low CPU usage." },
        args: {
          threshold: { type: "string", description: "CPU threshold percentage." },
          duration: { type: "string", description: "Low-CPU duration in minutes." },
          maxWait: { type: "string", description: SLEEPT_MAX_WAIT_HELP },
          power: { type: "string", description: "sleep, shutdown, or restart." },
          dryrun: { type: "boolean", description: "Simulate the power action." },
          json: { type: "boolean", description: "Print JSON result." },
        },
        async run({ args }) {
          const json = Boolean(args.json)
          const defaults = await resolveSleeptDefaults(host, json)
          await runAction(
            {
              action: "cpu",
              cpuThreshold: Number(args.threshold ?? defaults.cpuThreshold ?? 10),
              cpuDuration: Number(args.duration ?? defaults.cpuDuration ?? 2),
              maxWaitSeconds: Number(args.maxWait ?? defaults.maxWaitSeconds ?? 3600),
              powerMode: powerMode(args.power ?? defaults.powerMode),
              dryrun: Boolean(args.dryrun ?? defaults.dryrun ?? true),
            },
            json,
            host,
          )
        },
      }),
      guided: defineCommand({
        meta: { name: "guided", description: "Compatibility alias for gd." },
        async run() {
          await runProgram(["guided"], host)
        },
      }),
    },
  })
}

function timerArgs() {
  return {
    hours: { type: "string", description: "Hours." },
    minutes: { type: "string", description: "Minutes." },
    seconds: { type: "string", description: "Seconds." },
    power: { type: "string", description: "sleep, shutdown, or restart." },
    dryrun: { type: "boolean", description: "Simulate the power action." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromCountdownArgs(args: SleeptCliOptions, defaults: SleeptDefaults = {}): SleeptInput {
  return {
    action: "countdown",
    hours: nonNegativeNumber(args.hours, defaults.hours ?? 0),
    minutes: nonNegativeNumber(args.minutes, defaults.minutes ?? 0),
    seconds: nonNegativeNumber(args.seconds, defaults.seconds ?? 5),
    powerMode: powerMode(args.power ?? defaults.powerMode),
    dryrun: Boolean(args.dryrun ?? defaults.dryrun ?? true),
  }
}

async function runAction(input: SleeptInput, json: boolean, host: CliHost): Promise<void> {
  const runtime = createNodeSleeptRuntime()
  let progressActive = false
  const result = await runSleept(input, runtime, json ? undefined : (event) => {
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
    return
  }

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  if (!result.success) process.exitCode = 1
}

function powerMode(value: unknown): PowerMode {
  return value === "shutdown" || value === "restart" ? value : "sleep"
}

function nonNegativeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

// --- Guided flow ---

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, `Guided mode requires an interactive terminal. Use \`${CLI_NAME} status --json\` for scripted use.`)
    process.exitCode = 2
    return
  }

  const defaults = await resolveSleeptDefaults(host, false)
  let firstRender = true
  try {
    while (true) {
      renderGuidedIntro(host, firstRender)
      firstRender = false

      const action = await resolveAction(host)
      if (!action) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      const input = await buildInputForAction(host, action, defaults)
      if (!input) {
        if (!await confirmRich(host, "重新开始?", false)) return
        continue
      }

      await runGuidedAction(input, host)

      if (!await confirmRich(host, "继续选择其他定时任务?", false)) return
    }
  } catch (error) {
    if (error instanceof CliPromptExitError) {
      writeLine(host, rich(host, "已退出。", "yellow"))
      return
    }
    throw error
  }
}

function renderGuidedIntro(host: CliHost, includeHeader: boolean): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  writeRichPanel(host, "Xiranite Sleept", [
    `${rich(host, "入口", "cyan")}  系统定时器，支持倒计时、定时、网速与 CPU 触发关机`,
    `${rich(host, "执行", "cyan")}  直接调用 sleept core/platform，不经过 lata 或 Taskfile`,
    `${rich(host, "默认", "cyan")}  dry-run 模式仅模拟电源动作；需要真实关机请在确认步骤关闭`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)
  writeLine(host, rich(host, `提示: guided 默认 dry-run；脚本化使用请用 \`${CLI_NAME} status --json\` 或 \`${CLI_NAME} countdown --json\`。`, "grey"))
}

async function resolveAction(host: CliHost): Promise<GuidedAction | null> {
  const choice = await selectRich<GuidedAction>(
    host,
    "选择定时模式",
    [
      { value: "countdown", label: "倒计时", hint: "小时:分钟:秒后触发" },
      { value: "specific_time", label: "定时", hint: "指定日期时间触发" },
      { value: "netspeed", label: "网速", hint: "持续低速网络触发" },
      { value: "cpu", label: "CPU", hint: "持续低 CPU 触发" },
      { value: "status", label: "状态", hint: "查看当前 CPU 与网速" },
      { value: "exit", label: "退出", hint: "不执行任何操作" },
    ],
    { initialValue: "countdown", maxItems: 6 },
  )

  if (choice === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return null
  }
  return choice
}

async function buildInputForAction(host: CliHost, action: GuidedAction, defaults: SleeptDefaults = {}): Promise<SleeptInput | null> {
  if (action === "status") {
    return { action: "get_stats" }
  }
  if (action === "exit") {
    return null
  }

  let input: SleeptInput = { action }

  if (action === "countdown") {
    const hours = await promptRich(host, "倒计时小时数", String(defaults.hours ?? 0))
    const minutes = await promptRich(host, "倒计时分钟数", String(defaults.minutes ?? 0))
    const seconds = await promptRich(host, "倒计时秒数", String(defaults.seconds ?? 5))
    input = {
      ...input,
      hours: nonNegativeNumber(hours, defaults.hours ?? 0),
      minutes: nonNegativeNumber(minutes, defaults.minutes ?? 0),
      seconds: nonNegativeNumber(seconds, defaults.seconds ?? 5),
    }
  } else if (action === "specific_time") {
    const clipboardText = (await readClipboardText()).trim()
    const clipboardTarget = looksLikeDatetime(clipboardText) ? clipboardText : ""
    const defaultTarget = clipboardTarget || defaults.targetDatetime || ""
    const target = await promptRich(host, "目标时间 (YYYY-MM-DD HH:MM:SS)", defaultTarget)
    if (!target) {
      writeRichPanel(host, "Target", "未提供目标时间。", { color: "yellow", minWidth: 40 })
      return null
    }
    input = { ...input, targetDatetime: target }
  } else if (action === "netspeed") {
    const upload = await promptRich(host, "上传阈值 (KB/s)", String(defaults.uploadThreshold ?? 242))
    const download = await promptRich(host, "下载阈值 (KB/s)", String(defaults.downloadThreshold ?? 242))
    const duration = await promptRich(host, "持续低速时长 (分钟)", String(defaults.netDuration ?? 2))
    const maxWait = await promptRich(host, "最长等待秒数，0 表示无限", String(defaults.maxWaitSeconds ?? 3600))
    const trigger = await selectRich<TriggerChoice>(
      host,
      "触发条件",
      [
        { value: "both", label: "全部满足", hint: "上传与下载同时低于阈值" },
        { value: "any", label: "任一满足", hint: "上传或下载低于阈值" },
        { value: "exit", label: "退出", hint: "取消本次操作" },
      ],
      { initialValue: defaults.netTriggerMode ?? "both", maxItems: 3 },
    )
    if (trigger === "exit") {
      writeLine(host, rich(host, "已退出。", "yellow"))
      return null
    }
    input = {
      ...input,
      uploadThreshold: nonNegativeNumber(upload, defaults.uploadThreshold ?? 242),
      downloadThreshold: nonNegativeNumber(download, defaults.downloadThreshold ?? 242),
      netDuration: nonNegativeNumber(duration, defaults.netDuration ?? 2),
      netTriggerMode: trigger,
      maxWaitSeconds: nonNegativeNumber(maxWait, defaults.maxWaitSeconds ?? 3600),
    }
  } else if (action === "cpu") {
    const threshold = await promptRich(host, "CPU 阈值百分比", String(defaults.cpuThreshold ?? 10))
    const duration = await promptRich(host, "持续低 CPU 时长 (分钟)", String(defaults.cpuDuration ?? 2))
    const maxWait = await promptRich(host, "最长等待秒数，0 表示无限", String(defaults.maxWaitSeconds ?? 3600))
    input = {
      ...input,
      cpuThreshold: nonNegativeNumber(threshold, defaults.cpuThreshold ?? 10),
      cpuDuration: nonNegativeNumber(duration, defaults.cpuDuration ?? 2),
      maxWaitSeconds: nonNegativeNumber(maxWait, defaults.maxWaitSeconds ?? 3600),
    }
  }

  const power = await selectPowerMode(host, defaults.powerMode ?? "sleep")
  if (!power) return null
  input = { ...input, powerMode: power }

  const dryrun = await confirmRich(host, "使用 dry-run 模拟电源动作?", defaults.dryrun ?? true)
  input = { ...input, dryrun }

  writeLine(host)
  writeSelectedPlan(host, input)

  const confirmed = await confirmRich(host, "确认开始执行?", true)
  if (!confirmed) {
    writeLine(host, rich(host, "操作已取消。", "yellow"))
    return null
  }
  return input
}

async function selectPowerMode(host: CliHost, initialValue: PowerMode = "sleep"): Promise<PowerMode | null> {
  const choice = await selectRich<PowerChoice>(
    host,
    "选择电源动作",
    [
      { value: "sleep", label: "休眠", hint: "SetSuspendState" },
      { value: "shutdown", label: "关机", hint: "shutdown /s" },
      { value: "restart", label: "重启", hint: "shutdown /r" },
      { value: "exit", label: "退出", hint: "取消本次操作" },
    ],
    { initialValue, maxItems: 4 },
  )
  if (choice === "exit") {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return null
  }
  return choice
}

function writeSelectedPlan(host: CliHost, input: SleeptInput): void {
  const columns = terminalColumns(host)
  const lines: string[] = []
  lines.push(`${rich(host, "模式", "cyan")}  ${describeAction(input.action)}`)
  if (input.action === "countdown") {
    lines.push(`${rich(host, "时长", "cyan")}  ${formatHms(input.hours ?? 0, input.minutes ?? 0, input.seconds ?? 0)}`)
  } else if (input.action === "specific_time") {
    lines.push(`${rich(host, "目标", "cyan")}  ${input.targetDatetime ?? ""}`)
  } else if (input.action === "netspeed") {
    lines.push(`${rich(host, "上传", "cyan")}  ${input.uploadThreshold ?? 242} KB/s`)
    lines.push(`${rich(host, "下载", "cyan")}  ${input.downloadThreshold ?? 242} KB/s`)
    lines.push(`${rich(host, "持续", "cyan")}  ${input.netDuration ?? 2} 分钟`)
    lines.push(`${rich(host, "触发", "cyan")}  ${input.netTriggerMode === "any" ? "任一满足" : "全部满足"}`)
    lines.push(`${rich(host, "等待", "cyan")}  ${input.maxWaitSeconds === 0 ? "无限，直到取消" : `${input.maxWaitSeconds ?? 3600} 秒`}`)
  } else if (input.action === "cpu") {
    lines.push(`${rich(host, "阈值", "cyan")}  ${input.cpuThreshold ?? 10}%`)
    lines.push(`${rich(host, "持续", "cyan")}  ${input.cpuDuration ?? 2} 分钟`)
    lines.push(`${rich(host, "等待", "cyan")}  ${input.maxWaitSeconds === 0 ? "无限，直到取消" : `${input.maxWaitSeconds ?? 3600} 秒`}`)
  }
  lines.push(`${rich(host, "电源", "cyan")}  ${describePower(input.powerMode ?? "sleep")}`)
  lines.push(`${rich(host, "演练", "cyan")}  ${input.dryrun ? "dry-run 模拟" : "真实执行"}`)
  writeRichPanel(host, "即将执行", lines, { color: "cyan", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
}

function describeAction(action: SleeptAction | undefined): string {
  switch (action) {
    case "countdown": return "倒计时触发"
    case "specific_time": return "定时触发"
    case "netspeed": return "网速触发"
    case "cpu": return "CPU 触发"
    case "status":
    case "get_stats": return "查看状态"
    default: return "未知模式"
  }
}

function describePower(mode: PowerMode): string {
  return mode === "shutdown" ? "关机" : mode === "restart" ? "重启" : "休眠"
}

function formatHms(hours: number, minutes: number, seconds: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function looksLikeDatetime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value.trim())
}

async function runGuidedAction(input: SleeptInput, host: CliHost): Promise<void> {
  let progressActive = false
  const result = await runSleept(input, createNodeSleeptRuntime(), (event) => {
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

  writeLine(host, result.success ? rich(host, result.message, "green", "bold") : rich(host, result.message, "red", "bold"))
  writeSleeptSummary(host, result)
  if (!result.success) process.exitCode = 1
}

function writeSleeptSummary(host: CliHost, result: SleeptResult): void {
  const data = result.data
  if (!data) return
  const columns = terminalColumns(host)
  const lines = [`${rich(host, "状态", "cyan")}  ${data.timerStatus}`]
  if (data.targetTime) lines.push(`${rich(host, "目标", "cyan")}  ${data.targetTime}`)
  if (typeof data.currentCpu === "number" && data.currentCpu > 0) lines.push(`${rich(host, "CPU", "cyan")}  ${data.currentCpu.toFixed(1)}%`)
  if (typeof data.currentUpload === "number" && data.currentUpload > 0) lines.push(`${rich(host, "上传", "cyan")}  ${data.currentUpload.toFixed(1)} KB/s`)
  if (typeof data.currentDownload === "number" && data.currentDownload > 0) lines.push(`${rich(host, "下载", "cyan")}  ${data.currentDownload.toFixed(1)} KB/s`)
  writeRichPanel(host, "执行总结", lines, { color: result.success ? "green" : "yellow", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
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

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
