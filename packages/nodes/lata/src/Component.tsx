import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { NodeComponentProps } from "@xiranite/contract"
import { Clipboard, ListTodo, Play, RefreshCw, RotateCcw, Rocket } from "lucide-react"
import { ActionButton, Field, IconButton, LogView, NodeBody, NodeContent, NodeFooter, NodeHeader, ResultView, SegmentButton, StatPill, createUnavailableNativeAction } from "@xiranite/ui"
import type { LataData, LataInput, LataResult } from "./core.js"

interface LataCardState {
  taskfilePath?: string
  taskName?: string
  taskArgs?: string
  result?: LataData | null
  logs?: string[]
  phase?: string
}

export function Component({ compId, host }: NodeComponentProps) {
  const { t } = useTranslation()
  const data = host.getData<LataCardState>(compId) ?? {}
  const [running, setRunning] = useState(false)
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
    host.patchData(compId, patchData)
  }

  function log(message: string) {
    patch({ logs: [...logs.slice(-50), message] })
  }

  async function pastePath() {
    const text = await host.clipboard?.readText?.()
    if (text) patch({ taskfilePath: text.trim() })
  }

  async function execute(action: LataInput["action"]) {
    if (running) return
    const runNativeAction = createUnavailableNativeAction("Native action is unavailable in the shell-less Component. Use the xiranite-lata CLI for Taskfile actions.")
    setRunning(true)
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
    setRunning(false)
  }

  function reset() {
    patch({ result: null, logs: [], phase: "idle" })
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
