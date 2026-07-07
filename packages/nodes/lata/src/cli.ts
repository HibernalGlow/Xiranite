#!/usr/bin/env node
import { pathToFileURL } from "node:url"
import {
  canRunInteractiveCli,
  CliPromptExitError,
  confirmRich,
  defineCommand,
  nodeCliName,
  padVisibleEnd,
  promptRich,
  rich,
  runMain,
  shellQuote,
  terminalColumns,
  truncateVisible,
  visibleWidth,
  writeCliEvent,
  writeError,
  writeJson,
  writeLine,
  writeRichPanel,
} from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"
import { getNodeConfig, loadXiraniteConfig } from "@xiranite/config"
import type { LataInput, LataRuntime, LataTaskInfo } from "./core.js"
import { runLata } from "./core.js"
import { createNodeLataRuntime } from "./platform.js"

const CLI_NAME = nodeCliName("lata")


interface LataCliOptions {
  path?: string
  taskfile?: string
  task?: string
  args?: string
  cwd?: string
  json?: boolean
}

interface LataNodeConfig {
  taskfile?: string
}


export interface LataTaskSelectorOptions {
  cwd?: string
  taskfileContent?: string
  taskfilePath?: string
  title?: string
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Taskfile launcher with list, plan, execute, and guided modes.",
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
    meta: { name: CLI_NAME, description: "Taskfile launcher with guided terminal mode." },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "List tasks from a Taskfile." },
        args: commonArgs(),
        async run({ args }) {
          await runLataAction(args as LataCliOptions, "list", host)
        },
      }),
      plan: defineCommand({
        meta: { name: "plan", description: "Preview the commands for a task." },
        args: commonArgs(),
        async run({ args }) {
          await runLataAction(args as LataCliOptions, "plan", host)
        },
      }),
      execute: defineCommand({
        meta: { name: "execute", description: "Execute a task." },
        args: commonArgs(),
        async run({ args }) {
          await runLataAction(args as LataCliOptions, "execute", host)
        },
      }),
      run: defineCommand({
        meta: { name: "run", description: "Alias for execute." },
        args: commonArgs(),
        async run({ args }) {
          await runLataAction(args as LataCliOptions, "execute", host)
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

/**
 * Resolve the Taskfile path for a lata CLI invocation.
 * Priority:
 *   1. --taskfile / --path explicit arg
 *   2. xiranite.config.toml [nodes.lata].taskfile field
 *   3. cwd auto-discovery (returns undefined; core.findTaskfile handles it)
 */
export async function resolveLataTaskfilePath(
  args: LataCliOptions,
  host: CliHost,
): Promise<string | undefined> {
  const explicit = args.taskfile || args.path
  if (explicit) return explicit

  try {
    const { config } = await loadXiraniteConfig({
      env: host.env,
      cwd: args.cwd || host.cwd,
    })
    const lataNode = getNodeConfig<LataNodeConfig>(config, "lata")
    if (lataNode?.taskfile) return lataNode.taskfile
  } catch {
    // Ignore config errors; fall through to cwd auto-discovery.
  }

  return undefined
}

async function runLataAction(args: LataCliOptions, action: "list" | "plan" | "execute", host: CliHost): Promise<void> {
  const input: LataInput = { action, ...inputFromArgs(args) }
  const resolved = await resolveLataTaskfilePath(args, host)
  if (resolved) input.taskfilePath = resolved
  await runAction(input, Boolean(args.json), host)
}

function commonArgs() {
  return {
    path: { type: "string", description: "Taskfile path." },
    taskfile: { type: "string", description: "Taskfile path." },
    task: { type: "string", description: "Task name." },
    args: { type: "string", description: "Task args exposed as {{.CLI_ARGS}} and LATA_ARGS." },
    cwd: { type: "string", description: "Working directory for Taskfile discovery." },
    json: { type: "boolean", description: "Print JSON result." },
  } as const
}

function inputFromArgs(args: LataCliOptions): LataInput {
  return {
    taskfilePath: args.taskfile || args.path,
    taskName: args.task,
    taskArgs: args.args ?? "",
    cwd: args.cwd,
  }
}

async function runAction(input: LataInput, json: boolean, host: CliHost): Promise<void> {
  const result = await runLata(input, createNodeLataRuntime(), (event) => {
    if (!json) writeCliEvent(host, event, { label: CLI_NAME })
  })
  if (json) {
    writeJson(host, result)
    return
  }
  writeLine(host, result.message)
  for (const task of result.data?.tasks?.slice(0, 80) ?? []) writeLine(host, `${task.name} (${task.cmdCount}) ${task.desc}`)
  for (const item of result.data?.commandPlan?.slice(0, 80) ?? []) writeLine(host, `${item.taskName}: ${item.command}`)
  for (const item of result.data?.commandResults?.slice(0, 80) ?? []) writeLine(host, `${item.exitCode} ${item.taskName}: ${item.command}`)
}

async function runGuided(host: CliHost): Promise<void> {
  await runLataTaskSelector(host)
}

export async function runLataTaskSelector(host: CliHost, options: LataTaskSelectorOptions = {}): Promise<void> {
  if (!canRunInteractiveCli(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `list --path Taskfile.yml --json` for scripted use.")
    process.exitCode = 2
    return
  }

  const runtime = createSelectorRuntime(host, options)
  const cwd = options.cwd || host.cwd
  const taskfilePath = options.taskfilePath || (options.taskfileContent ? runtime.resolve(cwd, "Taskfile.yml") : "")
  const listResult = await runLata({ action: "list", taskfilePath, cwd }, runtime)
  if (!listResult.success || !listResult.data) {
    writeRichPanel(host, "Error", listResult.message, { color: "red", minWidth: 72 })
    process.exitCode = 2
    return
  }

  const taskfile = listResult.data.taskfilePath
  const tasks = listResult.data.tasks
  const selectableTasks = tasks.filter((task) => task.name !== "default")
  if (!selectableTasks.length) {
    writeRichPanel(host, "Error", "No executable tasks found in Taskfile.", { color: "red", minWidth: 72 })
    process.exitCode = 2
    return
  }

  const defaultTask = selectableTasks.find((task) => task.name === "image-only") ?? selectableTasks[0]
  const defaultChoice = selectableTasks.indexOf(defaultTask) + 1
  let firstRender = true
  try {
    while (true) {
      renderTaskSelector(host, {
        defaultTaskName: defaultTask.name,
        taskfile,
        title: options.title ?? "Xiranite Lata",
        selectableTasks,
      }, firstRender)
      firstRender = false

      const choices = ["0", ...selectableTasks.map((_, index) => String(index + 1))]
      const rawChoice = await promptRich(
        host,
        `选择任务、输入任务名，或粘贴路径 ${rich(host, `[${choices.join("/")}]`, "magenta")}`,
        String(defaultChoice),
      )
      const resolvedChoice = await resolveTaskChoice(rawChoice, defaultTask, selectableTasks, runtime)
      const shouldContinue = await handleResolvedChoice(host, runtime, {
        choice: resolvedChoice,
        cwd,
        defaultTask,
        rawChoice,
        selectableTasks,
        taskfile,
      })
      if (!shouldContinue) return
    }
  } catch (error) {
    if (error instanceof CliPromptExitError) {
      writeLine(host, rich(host, "已退出。", "yellow"))
      return
    }
    throw error
  }
}

type ResolvedTaskChoice =
  | { kind: "index"; index: number }
  | { kind: "path"; path: string }
  | { kind: "task"; task: LataTaskInfo }

async function handleResolvedChoice(
  host: CliHost,
  runtime: LataRuntime,
  input: {
    choice: ResolvedTaskChoice
    cwd: string
    defaultTask: LataTaskInfo
    rawChoice: string
    selectableTasks: LataTaskInfo[]
    taskfile: string
  },
): Promise<boolean> {
  if (input.choice.kind === "path") {
    writeLine(host, rich(host, `路径已接入，使用默认任务: ${input.defaultTask.name}`, "yellow"))
    const result = await executeSelectedTask(host, runtime, input.taskfile, input.defaultTask.name, input.cwd, `--path ${shellQuote(input.choice.path)}`)
    if (!result) process.exitCode = 1
    return await confirmRich(host, "继续选择其他任务?", false)
  }

  if (input.choice.kind === "task") {
    const result = await executeSelectedTask(host, runtime, input.taskfile, input.choice.task.name, input.cwd)
    if (!result) process.exitCode = 1
    return await confirmRich(host, "继续选择其他任务?", false)
  }

  if (input.choice.index === 0) {
    writeLine(host, rich(host, "已退出。", "yellow"))
    return false
  }

  const task = Number.isInteger(input.choice.index) ? input.selectableTasks[input.choice.index - 1] : undefined
  if (!task) {
    writeRichPanel(host, "Input", `无法识别: ${input.rawChoice}`, { color: "red", minWidth: 48 })
    return true
  }

  const result = await executeSelectedTask(host, runtime, input.taskfile, task.name, input.cwd)
  if (!result) process.exitCode = 1
  return await confirmRich(host, "继续选择其他任务?", false)
}

async function resolveTaskChoice(
  value: string,
  defaultTask: LataTaskInfo,
  selectableTasks: LataTaskInfo[],
  runtime: LataRuntime,
): Promise<ResolvedTaskChoice> {
  const text = value.trim()
  if (/^\d+$/.test(text)) return { kind: "index", index: Number(text) }
  const namedTask = selectableTasks.find((task) => task.name.toLowerCase() === text.toLowerCase())
  if (namedTask) return { kind: "task", task: namedTask }
  if (text && await runtime.exists(text.replace(/^["']|["']$/g, ""))) return { kind: "path", path: text.replace(/^["']|["']$/g, "") }
  if (!text) return { kind: "task", task: defaultTask }
  return { kind: "index", index: Number.NaN }
}

function createSelectorRuntime(host: CliHost, options: LataTaskSelectorOptions): LataRuntime {
  const runtime = createNodeLataRuntime()
  const columns = String(terminalColumns(host))
  const withTerminalEnv: LataRuntime = {
    ...runtime,
    async runCommand(command, commandOptions, onOutput) {
      return await runtime.runCommand(command, {
        ...commandOptions,
        env: {
          ...commandOptions.env,
          COLUMNS: columns,
          XIRANITE_CLI_COLUMNS: columns,
        },
      }, onOutput)
    },
  }

  if (!options.taskfileContent) return withTerminalEnv
  const virtualPath = runtime.resolve(options.taskfilePath || runtime.resolve(options.cwd || host.cwd, "Taskfile.yml"))
  return {
    ...withTerminalEnv,
    async exists(path) {
      return runtime.resolve(path) === virtualPath || await runtime.exists(path)
    },
    async readText(path) {
      if (runtime.resolve(path) === virtualPath) return options.taskfileContent ?? ""
      return await runtime.readText(path)
    },
  }
}

function renderTaskSelector(
  host: CliHost,
  input: { defaultTaskName: string; title: string; taskfile: string; selectableTasks: LataTaskInfo[] },
  includeHeader: boolean,
): void {
  if (!includeHeader) writeLine(host)
  const columns = terminalColumns(host)
  writeRichPanel(host, input.title, [
    `${rich(host, "Taskfile", "cyan")}  ${truncateVisible(input.taskfile, Math.max(16, columns - 18))}`,
    `${rich(host, "默认任务", "cyan")}  ${input.defaultTaskName}`,
    `${rich(host, "输入方式", "cyan")}  编号 / 任务名 / 文件夹路径`,
  ], { color: "blue", maxWidth: columns - 2, minWidth: Math.min(76, columns - 6) })
  writeLine(host)

  writeLine(host, rich(host, "可执行任务", "white", "bold"))
  input.selectableTasks.forEach((task, index) => {
    writeLine(host, renderTaskRow(host, {
      desc: task.desc,
      index: index + 1,
      isDefault: task.name === input.defaultTaskName,
      name: task.name,
    }))
  })
  writeLine(host, renderTaskRow(host, { desc: "离开引导模式", index: 0, isDefault: false, name: "exit" }))
  writeLine(host)
  writeLine(host, rich(host, "提示: 粘贴一个存在的文件夹路径会用默认任务执行；Ctrl+C 可退出。", "grey"))
}

function renderTaskRow(host: CliHost, task: { desc: string; index: number; isDefault: boolean; name: string }): string {
  const columns = terminalColumns(host)
  const number = padVisibleEnd(rich(host, String(task.index).padStart(2), "cyan"), 4)
  const name = padVisibleEnd(rich(host, task.name, task.isDefault ? "green" : "white"), 26)
  const badge = task.isDefault ? rich(host, "default", "yellow") : ""
  const badgeCell = padVisibleEnd(badge, 9)
  const prefix = `  ${number}${name}${badgeCell}`
  const descWidth = Math.max(0, columns - visibleWidth(prefix) - 1)
  return `${prefix}${rich(host, truncateVisible(task.desc || "-", descWidth), task.index === 0 ? "grey" : "white")}`
}

async function executeSelectedTask(host: CliHost, runtime: LataRuntime, taskfilePath: string, taskName: string, cwd: string, taskArgs = ""): Promise<boolean> {
  const plan = await runLata({ action: "plan", taskfilePath, taskName, taskArgs, cwd }, runtime)
  writeRichPanel(host, "Run", [
    `${rich(host, "task", "cyan")}     ${taskName}`,
    ...(plan.data?.commandPlan ?? []).map((item) => `${rich(host, item.taskName, "green")}  ${truncateVisible(item.command, terminalColumns(host) - 18)}`),
  ], { color: "cyan", minWidth: Math.min(72, terminalColumns(host) - 6) })

  const result = await runLata({ action: "execute", taskfilePath, taskName, taskArgs, cwd }, runtime, (event) => {
    if (event.type === "log" && event.message.trim()) {
      writeLine(host, event.message)
    }
  })

  if (result.success) {
    writeLine(host, rich(host, `完成: ${taskName}`, "green"))
    return true
  }

  const exitCode = result.data?.exitCode || 1
  const errors = [
    ...(result.data?.errors ?? []),
    ...(result.data?.commandResults ?? []).flatMap((item) => [item.stderr, item.stdout]).filter(Boolean),
  ]
  const detail = errors.join("\n").trim() || result.message
  writeRichPanel(host, "Error", detail, { color: "red", minWidth: 72 })
  writeLine(host, rich(host, `task: Failed to run task "${taskName}": exit status ${exitCode}`, "red"))
  writeLine(host, rich(host, `任务 '${taskName}' 执行失败 (退出码: ${exitCode})`, "red"))
  return false
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await runProgram()
  } catch (error) {
    writeError(createDefaultHost(), error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
