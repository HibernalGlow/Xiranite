import { parse as parseYaml } from "yaml"
import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"

export type LataAction = "list" | "plan" | "execute"

export interface LataInput {
  action?: LataAction
  taskfilePath?: string
  taskfile_path?: string
  taskName?: string
  task_name?: string
  taskArgs?: string
  task_args?: string
  cwd?: string
}

export interface LataTaskInfo {
  name: string
  desc: string
  prompt: string | null
  cmds: string[]
  cmdCount: number
  silent: boolean
  vars: Record<string, unknown>
  deps: string[]
  sources: string[]
  generates: string[]
}

export interface LataCommandPlanItem {
  taskName: string
  command: string
  index: number
}

export interface LataCommandResult extends LataCommandPlanItem {
  exitCode: number
  stdout: string
  stderr: string
}

export interface LataData {
  taskfilePath: string
  tasks: LataTaskInfo[]
  selectedTask: string
  commandPlan: LataCommandPlanItem[]
  commandResults: LataCommandResult[]
  exitCode: number
  errors: string[]
}

export interface LataRuntime {
  cwd: () => string
  exists: (path: string) => Promise<boolean>
  readText: (path: string) => Promise<string | null>
  runCommand: (command: string, options: { cwd: string; env?: Record<string, string> }, onOutput?: (chunk: string, stream: "stdout" | "stderr") => void) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  join: (...parts: string[]) => string
  dirname: (path: string) => string
  basename: (path: string) => string
  resolve: (...parts: string[]) => string
}

interface NormalizedLataInput {
  action: LataAction
  taskfilePath: string
  taskName: string
  taskArgs: string
  cwd: string
}

export type LataResult = NodeRunResult<LataData>

export function normalizeLataInput(input: LataInput, runtime: Pick<LataRuntime, "cwd">): NormalizedLataInput {
  return {
    action: input.action ?? "list",
    taskfilePath: clean(input.taskfilePath ?? input.taskfile_path),
    taskName: clean(input.taskName ?? input.task_name),
    taskArgs: input.taskArgs ?? input.task_args ?? "",
    cwd: clean(input.cwd) || runtime.cwd(),
  }
}

export async function runLata(
  input: LataInput,
  runtime: LataRuntime,
  onEvent: (event: NodeRunEvent) => void = () => {},
): Promise<LataResult> {
  const normalized = normalizeLataInput(input, runtime)
  try {
    const loaded = await loadTaskfile(normalized, runtime)
    if (normalized.action === "list") {
      return success(`Found ${loaded.tasks.length} task(s).`, {
        taskfilePath: loaded.path,
        tasks: loaded.tasks,
      })
    }

    if (!normalized.taskName) return failure("Task name is required.")
    const plan = buildLataCommandPlan(loaded.tasks, normalized.taskName, normalized.taskArgs)
    if (normalized.action === "plan") {
      return success(`Planned ${plan.length} command(s) for ${normalized.taskName}.`, {
        taskfilePath: loaded.path,
        tasks: loaded.tasks,
        selectedTask: normalized.taskName,
        commandPlan: plan,
      })
    }

    return await executePlan(loaded.path, loaded.tasks, normalized, plan, runtime, onEvent)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export async function loadTaskfile(input: NormalizedLataInput, runtime: LataRuntime): Promise<{ path: string; tasks: LataTaskInfo[] }> {
  const taskfilePath = input.taskfilePath || await findTaskfile(input.cwd, runtime)
  if (!taskfilePath) throw new Error("Taskfile path is required or Taskfile.yml/Taskfile.yaml must exist in cwd.")
  const resolved = runtime.resolve(taskfilePath)
  if (!await runtime.exists(resolved)) throw new Error(`Taskfile does not exist: ${resolved}`)
  const content = await runtime.readText(resolved)
  if (!content) throw new Error(`Taskfile is empty or unreadable: ${resolved}`)
  return { path: resolved, tasks: parseTaskfile(content) }
}

export function parseTaskfile(content: string): LataTaskInfo[] {
  const doc = parseYaml(content) as unknown
  if (!doc || typeof doc !== "object") throw new Error("Taskfile YAML must be an object.")
  const tasksObject = (doc as { tasks?: unknown }).tasks
  if (!tasksObject || typeof tasksObject !== "object") return []

  const tasks: LataTaskInfo[] = []
  for (const [name, raw] of Object.entries(tasksObject as Record<string, unknown>)) {
    if (name === "default") continue
    const task = normalizeTask(name, raw)
    tasks.push(task)
  }
  return tasks.sort((a, b) => a.name.localeCompare(b.name))
}

export function buildLataCommandPlan(tasks: LataTaskInfo[], taskName: string, taskArgs = ""): LataCommandPlanItem[] {
  const taskMap = new Map(tasks.map((task) => [task.name, task]))
  const order = resolveTaskOrder(taskMap, taskName)
  const plan: LataCommandPlanItem[] = []
  for (const name of order) {
    const task = taskMap.get(name)
    if (!task) continue
    for (const command of task.cmds) {
      plan.push({
        taskName: name,
        command: renderCommand(command, task.vars, taskArgs),
        index: plan.length,
      })
    }
  }
  return plan
}

async function executePlan(
  taskfilePath: string,
  tasks: LataTaskInfo[],
  input: NormalizedLataInput,
  plan: LataCommandPlanItem[],
  runtime: LataRuntime,
  onEvent: (event: NodeRunEvent) => void,
): Promise<LataResult> {
  const cwd = runtime.dirname(taskfilePath)
  const commandResults: LataCommandResult[] = []
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index]
    onEvent({ type: "progress", progress: Math.round((index / Math.max(plan.length, 1)) * 100), message: item.command })
    const result = await runtime.runCommand(item.command, { cwd, env: { LATA_ARGS: input.taskArgs } }, (chunk, stream) => {
      onEvent({ type: "log", message: stream === "stderr" ? `[stderr] ${chunk}` : chunk })
    })
    commandResults.push({ ...item, ...result })
    if (result.exitCode !== 0) {
      onEvent({ type: "progress", progress: 100, message: "Task failed." })
      return {
        success: false,
        message: `Task '${input.taskName}' failed with exit code ${result.exitCode}.`,
        data: data({
          taskfilePath,
          tasks,
          selectedTask: input.taskName,
          commandPlan: plan,
          commandResults,
          exitCode: result.exitCode,
          errors: [result.stderr || `Command failed: ${item.command}`],
        }),
      }
    }
  }
  onEvent({ type: "progress", progress: 100, message: "Task completed." })
  return success(`Task '${input.taskName}' completed.`, {
    taskfilePath,
    tasks,
    selectedTask: input.taskName,
    commandPlan: plan,
    commandResults,
    exitCode: 0,
  })
}

async function findTaskfile(cwd: string, runtime: LataRuntime): Promise<string> {
  for (const name of ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"]) {
    const candidate = runtime.resolve(cwd, name)
    if (await runtime.exists(candidate)) return candidate
  }
  return ""
}

function normalizeTask(name: string, raw: unknown): LataTaskInfo {
  if (typeof raw === "string") {
    return taskInfo(name, { cmds: [raw] })
  }
  if (!raw || typeof raw !== "object") return taskInfo(name, {})
  const value = raw as Record<string, unknown>
  return taskInfo(name, {
    desc: stringValue(value.desc),
    prompt: nullableString(value.prompt),
    cmds: parseCommands(value.cmds),
    silent: Boolean(value.silent),
    vars: recordValue(value.vars),
    deps: parseDeps(value.deps),
    sources: parseStringList(value.sources),
    generates: parseStringList(value.generates),
  })
}

function taskInfo(name: string, partial: Partial<LataTaskInfo>): LataTaskInfo {
  const cmds = partial.cmds ?? []
  return {
    name,
    desc: partial.desc ?? "",
    prompt: partial.prompt ?? null,
    cmds,
    cmdCount: cmds.length,
    silent: partial.silent ?? false,
    vars: partial.vars ?? {},
    deps: partial.deps ?? [],
    sources: partial.sources ?? [],
    generates: partial.generates ?? [],
  }
}

function parseCommands(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === "string") return item
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>
      if (typeof record.cmd === "string") return record.cmd
      if (typeof record.task === "string") return `task ${record.task}`
    }
    return ""
  }).filter(Boolean)
}

function parseDeps(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    if (typeof item === "string") return item
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).task === "string") return (item as Record<string, string>).task
    return ""
  }).filter(Boolean)
}

function parseStringList(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === "string" ? item : "").filter(Boolean)
}

function resolveTaskOrder(taskMap: Map<string, LataTaskInfo>, taskName: string): string[] {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const order: string[] = []

  function visit(name: string) {
    const task = taskMap.get(name)
    if (!task) throw new Error(`Task not found: ${name}`)
    if (visited.has(name)) return
    if (visiting.has(name)) throw new Error(`Task dependency cycle detected at: ${name}`)
    visiting.add(name)
    for (const dep of task.deps) visit(dep)
    visiting.delete(name)
    visited.add(name)
    order.push(name)
  }

  visit(taskName)
  return order
}

function renderCommand(command: string, vars: Record<string, unknown>, taskArgs: string): string {
  return command
    .replace(/\{\{\s*\.CLI_ARGS\s*\}\}/g, taskArgs)
    .replace(/\{\{\s*\.([A-Za-z0-9_]+)\s*\}\}/g, (_, key: string) => stringValue(vars[key]))
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value)
  return text || null
}

function clean(value?: string): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "")
}

function data(partial: Partial<LataData>): LataData {
  return {
    taskfilePath: "",
    tasks: [],
    selectedTask: "",
    commandPlan: [],
    commandResults: [],
    exitCode: 0,
    errors: [],
    ...partial,
  }
}

function success(message: string, partial: Partial<LataData>): LataResult {
  return { success: true, message, data: data(partial) }
}

function failure(message: string): LataResult {
  return { success: false, message, data: data({ exitCode: 1, errors: [message] }) }
}
