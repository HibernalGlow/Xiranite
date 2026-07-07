import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, ListTodo, Play, RefreshCw, RotateCcw, Rocket } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, NodeConfigButton, ResultView, SegmentButton, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { LataData, LataInput, LataResult } from "./core.js"

interface LataCardState {
  taskfilePath?: string
  taskName?: string
  taskArgs?: string
  result?: LataData | null
  logs?: string[]
  phase?: string
}

/** comp.data 中属于"配置覆盖"的字段，可保存到 TOML */
const CONFIG_FIELDS: (keyof LataCardState)[] = ["taskfilePath", "taskName", "taskArgs"]

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<LataCardState>(compId) ?? {}
  const dataRef = useRef<LataCardState>(data)
  dataRef.current = data
  const [running, setRunning] = useState(false)

  // 节点默认配置（从 xiranite.config.toml [nodes.lata] 读取）
  const [defaults, setDefaults] = useState<Partial<LataCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  useEffect(() => {
    host.getNodeConfig?.<Partial<LataCardState>>().then((result) => {
      setDefaults(result.config)
    }).catch(() => {
      // backend 不可用或配置文件不存在
    })
  }, [])

  // 检测 comp.data 中的配置字段是否与 TOML 默认值不同
  useEffect(() => {
    if (!defaults) return
    const dirty = CONFIG_FIELDS.some((field) => {
      const current = data[field]
      const defaultVal = defaults[field]
      return String(current ?? "") !== String(defaultVal ?? "")
    })
    setConfigDirty(dirty)
  }, [data.taskfilePath, data.taskName, data.taskArgs, defaults])

  const logs = data.logs ?? []
  const tasks = data.result?.tasks ?? []
  const selectedTask = data.taskName || tasks[0]?.name || ""
  const phase = data.phase ?? "idle"

  function phaseLabelFor(p: string): string {
    return p === "idle" ? t("module:lata.phaseIdle")
      : p === "loading" ? t("module:lata.phaseLoading")
      : p === "running" ? t("module:lata.phaseRunning")
      : p === "completed" ? t("module:lata.phaseCompleted")
      : p === "error" ? t("module:lata.phaseError")
      : p
  }

  function patch(patchData: Partial<LataCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    const current = dataRef.current.logs ?? []
    patch({ logs: [...current.slice(-50), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ taskfilePath: text.trim() })
  }

  async function execute(action: LataInput["action"]) {
    if (running) return
    const runNativeAction = host.actions?.run ?? createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the package CLI for Taskfile actions.")
    setRunning(true)
    try {
      patch({ phase: action === "execute" ? "running" : "loading" })
      const response = await runNativeAction<LataInput, LataData>("lata", {
        action,
        taskfilePath: data.taskfilePath,
        taskName: selectedTask,
        taskArgs: data.taskArgs,
      }, (event) => {
        if (event.type === "progress") log(`[${event.progress ?? 0}%] ${event.message}`)
        else log(event.message)
      }) as LataResult
      patch({
        phase: response.success ? "completed" : "error",
        result: response.data ?? null,
        taskName: selectedTask || response.data?.tasks[0]?.name,
      })
      log(response.message)
    } finally {
      setRunning(false)
    }
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
  }

  async function saveAsDefault() {
    const config: Partial<LataCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined && value !== "") (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  function restoreDefault() {
    if (defaults) patch(defaults)
  }

  function resetOverride() {
    const reset: Record<string, undefined> = {}
    for (const field of CONFIG_FIELDS) reset[field] = undefined
    patch(reset)
  }

  async function copyLogs() {
    await host.clipboard?.writeText?.(logs.join("\n"))
  }

  return (
    <NodeContent>
      <NodeHeader
        title={t("module:lata.title")}
        meta={t("module:lata.meta", { phase: phaseLabelFor(phase), task: selectedTask || t("module:lata.noTask") })}
        actions={
          <>
            <NodeConfigButton
              isDirty={configDirty}
              onSaveDefault={saveAsDefault}
              onRestoreDefault={restoreDefault}
              onResetOverride={resetOverride}
              onOpenConfigFile={host.openConfigFile}
            />
            <ActionButton disabled={running} onClick={() => execute("list")}><RefreshCw size={14} /> {t("module:lata.load")}</ActionButton>
            <ActionButton disabled={running || !selectedTask} onClick={() => execute("plan")}><ListTodo size={14} /> {t("module:lata.plan")}</ActionButton>
            <ActionButton disabled={running || !selectedTask} onClick={() => execute("execute")}><Play size={14} /> {t("module:lata.run")}</ActionButton>
            <IconButton title={t("module:lata.copyLogs")} onClick={copyLogs}><Clipboard size={14} /></IconButton>
            <IconButton title={t("module:lata.reset")} onClick={reset}><RotateCcw size={14} /></IconButton>
          </>
        }
      />

      <NodeBody className="flex flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-end gap-2">
          <Field label={t("module:lata.taskfileLabel")} value={data.taskfilePath ?? ""} disabled={running} onChange={(event) => patch({ taskfilePath: event.currentTarget.value })} className="min-w-0 flex-1" />
          <IconButton title={t("module:lata.pasteTaskfile")} onClick={pastePath} disabled={running}><Rocket size={13} /></IconButton>
          <Field label={t("module:lata.argsLabel")} value={data.taskArgs ?? ""} disabled={running} onChange={(event) => patch({ taskArgs: event.currentTarget.value })} className="min-w-0 flex-1" />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          {tasks.length ? tasks.slice(0, 12).map((task) => (
            <SegmentButton key={task.name} active={selectedTask === task.name} disabled={running} onClick={() => patch({ taskName: task.name })}>
              {task.name}
            </SegmentButton>
          )) : <SegmentButton active={false} disabled>{t("module:lata.loadTasks")}</SegmentButton>}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <StatPill label={t("module:lata.statTasks")} value={tasks.length} tone="accent" />
          <StatPill label={t("module:lata.statCommands")} value={data.result?.commandPlan.length ?? selectedTaskInfo(tasks, selectedTask)?.cmdCount ?? 0} tone="good" />
          <StatPill label={t("module:lata.statExit")} value={data.result?.exitCode ?? "-"} tone={(data.result?.exitCode ?? 0) === 0 ? "neutral" : "bad"} />
        </div>

        <ResultView className="flex-1 text-muted-foreground">
          {data.result?.commandResults.length ? data.result.commandResults.slice(0, 40).map((item) => (
            <div key={`${item.index}:${item.command}`} className="mb-1 truncate">
              {item.exitCode} {item.taskName}: {item.command}
            </div>
          )) : data.result?.commandPlan.length ? data.result.commandPlan.slice(0, 40).map((item) => (
            <div key={`${item.index}:${item.command}`} className="mb-1 truncate">
              {item.taskName}: {item.command}
            </div>
          )) : tasks.length ? tasks.map((task) => (
            <div key={task.name} className="mb-1 truncate">
              {task.name} / {task.cmdCount} cmd(s){task.desc ? ` / ${task.desc}` : ""}
            </div>
          )) : t("module:lata.noTasksLoaded")}
        </ResultView>
      </NodeBody>

      <NodeFooter>
        <LogView lines={logs} className="h-14" />
      </NodeFooter>
    </NodeContent>
  )
}

function selectedTaskInfo(tasks: LataData["tasks"], name: string) {
  return tasks.find((task) => task.name === name)
}
