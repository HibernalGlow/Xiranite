import { useEffect, useMemo, useRef, useState } from "react"
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract"
import type { DinyAction, DinyData, DinyInput } from "@xiranite/node-gitalso/core"
import {
  CheckCircle2,
  Copy,
  Eye,
  GitBranch,
  GitPullRequestArrow,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Terminal,
  Zap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { NodeConfigButton } from "@/nodes/shared/NodeConfigPopover"
import { STATUS_CODE_MAP } from "./constants"
import type { DinyCardState, DinyPhase, DinyStatusMeta } from "./types"
import { CONFIG_FIELDS } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const { t } = useNodeI18n("gitalso")
  const data = host.getData<DinyCardState>(compId) ?? {}
  const dataRef = useRef<DinyCardState>(data)
  dataRef.current = data

  const [running, setRunning] = useState(false)
  const [defaults, setDefaults] = useState<Partial<DinyCardState> | undefined>(undefined)
  const [configDirty, setConfigDirty] = useState(false)

  const logs = data.logs ?? []
  const result = data.result ?? null
  const progress = data.progress ?? 0
  const phase = phaseFromState(data, running)
  const status = statusFromState(data, running)
  const dryRun = data.dryRun ?? true
  const noVerify = data.noVerify ?? false
  const manualMessage = data.manualMessage ?? ""
  const compactSurface = surface.mode === "compact" || surface.mode === "portrait"
  const commitMessage = result?.commitMessage ?? null
  const stagedFiles = result?.git?.stagedFiles ?? []
  const branch = result?.git?.branch ?? null
  const diffStat = result?.git?.diffStat ?? null

  useEffect(() => {
    host.getNodeConfig?.<Partial<DinyCardState>>()
      .then((response) => setDefaults(response.config))
      .catch(() => undefined)
  }, [host])

  useEffect(() => {
    if (!defaults) return
    setConfigDirty(CONFIG_FIELDS.some((field) => String(data[field] ?? "") !== String(defaults[field] ?? "")))
  }, [data.repoPath, data.dinyPath, data.noVerify, data.dryRun, defaults])

  function patch(patchData: Partial<DinyCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData }
    host.patchData(compId, patchData)
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-100)
    patch({ logs: nextLogs })
  }

  async function execute(action: DinyAction) {
    if (running) return
    const run = host.actions?.run
    if (!run) {
      patch({ phase: "error", progressText: t("error.noRunEnv", "当前环境没有本地运行能力，请使用桌面模式或 CLI。") })
      pushLog("Native action is unavailable in this host.")
      return
    }

    const input: DinyInput = {
      action,
      repoPath: dataRef.current.repoPath ?? defaults?.repoPath,
      dinyPath: dataRef.current.dinyPath ?? defaults?.dinyPath,
      noVerify: dataRef.current.noVerify ?? defaults?.noVerify,
      dryRun: dataRef.current.dryRun ?? defaults?.dryRun,
      message: dataRef.current.manualMessage?.trim() || undefined,
    }

    setRunning(true)
    const phaseMap: Record<DinyAction, DinyPhase> = {
      status: "generating",
      generate: "generating",
      commit: "committing",
      push: "pushing",
      gitbutler_commit: "committing",
    }
    try {
      patch({ phase: phaseMap[action], progress: 0, progressText: t("progress.start", "开始执行..."), result: null })
      const response = await run<DinyInput, DinyData>("gitalso", input, (event) => {
        if (event.type === "progress") {
          patch({ progress: event.progress ?? 0, progressText: event.message })
          pushLog(`[${event.progress ?? 0}%] ${event.message}`)
        } else {
          pushLog(event.message)
        }
      }) as NodeRunResult<DinyData>

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
      })
      pushLog(response.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      patch({ phase: "error", progress: 0, progressText: message })
      pushLog(message)
    } finally {
      setRunning(false)
    }
  }

  async function copyMessage() {
    if (commitMessage) await host.clipboard?.writeText?.(commitMessage)
  }

  function reset() {
    patch({ phase: "idle", progress: 0, progressText: "", result: null, logs: [] })
  }

  async function saveAsDefault() {
    const config: Partial<DinyCardState> = {}
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field]
      if (value !== undefined) (config as Record<string, unknown>)[field] = value
    }
    await host.saveNodeConfig?.(config)
    setDefaults(config)
    setConfigDirty(false)
  }

  const stats = useMemo(() => {
    if (!result) return null
    return [
      { label: t("stats.staged", "暂存文件"), value: String(stagedFiles.length) },
      { label: t("stats.branch", "分支"), value: branch ?? "-" },
      { label: t("stats.insertions", "新增行"), value: String(diffStat?.insertions ?? 0) },
      { label: t("stats.deletions", "删除行"), value: String(diffStat?.deletions ?? 0) },
    ]
  }, [result, stagedFiles.length, branch, diffStat])

  const canGenerate = !running
  const canCommit = !running && !!commitMessage
  const canPush = !running && !!commitMessage

  return (
    <div ref={surface.ref} className="flex h-full w-full flex-col gap-3 p-3">
      {/* Status Strip */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={status.badgeVariant} className={cn("gap-1", status.iconClass)}>
          {phase === "generating" || phase === "committing" || phase === "pushing"
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : phase === "completed"
              ? <CheckCircle2 className="h-3 w-3" />
              : phase === "error"
                ? <ShieldAlert className="h-3 w-3" />
                : <Terminal className="h-3 w-3" />}
          {status.label}
        </Badge>
        {branch && (
          <Badge variant="outline" className="gap-1">
            <GitBranch className="h-3 w-3" />
            {branch}
          </Badge>
        )}
        {result?.dinyVersion && (
          <Badge variant="secondary" className="text-xs">
            GitAlso · diny v{result.dinyVersion}
          </Badge>
        )}
        {progress > 0 && progress < 100 && (
          <span className="text-xs text-muted-foreground">{progress}%</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          aria-label={t("fields.repoPath", "Git 仓库路径")}
          className="h-8 min-w-0 flex-1 font-mono text-xs"
          disabled={running}
          onChange={(event) => patch({ repoPath: event.target.value })}
          placeholder={t("placeholder.repoPath", "留空使用当前仓库")}
          value={data.repoPath ?? ""}
        />
        <Button className="h-8 gap-1.5" disabled={running} onClick={() => execute("status")} size="sm" variant="outline">
          <Terminal className="h-3.5 w-3.5" />
          {t("actions.analyze", "分析变更")}
        </Button>
      </div>

      {/* Stats Row */}
      {stats && !compactSurface && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-md border bg-muted/30 px-2 py-1.5">
              <div className="text-xs text-muted-foreground">{stat.label}</div>
              <div className="text-sm font-medium truncate">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className={cn("flex flex-1 gap-3 overflow-hidden", compactSurface && "flex-col")}>
        {/* Left: Staged Files */}
        {!compactSurface && (
          <div className="flex w-1/3 flex-col gap-1.5 overflow-hidden">
            <div className="text-xs font-medium text-muted-foreground">
              {t("labels.stagedFiles", "暂存文件")} ({stagedFiles.length})
            </div>
            <ScrollArea className="flex-1 rounded-md border">
              <div className="p-1.5">
                {stagedFiles.length === 0 ? (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    {t("empty.staged", "无暂存文件")}
                  </div>
                ) : (
                  <ul className="space-y-0.5">
                    {stagedFiles.map((file) => {
                      const statusInfo = STATUS_CODE_MAP[file.status] ?? STATUS_CODE_MAP["?"]
                      return (
                        <li key={file.path} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-muted/50">
                          <span className={cn("w-4 text-center font-mono", statusInfo.color)}>{file.status}</span>
                          <span className="truncate" title={file.path}>{file.path}</span>
                          {(file.insertions > 0 || file.deletions > 0) && (
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                              <span className="text-green-600">+{file.insertions}</span>
                              <span className="text-red-600">-{file.deletions}</span>
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Center: Commit Message + Diff Preview */}
        <div className="flex flex-1 flex-col gap-2 overflow-hidden">
          {/* Generated Message */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">
                {t("labels.commitMessage", "Commit 消息")}
              </div>
              {commitMessage && (
                <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={copyMessage}>
                  <Copy className="h-3 w-3" />
                  {t("actions.copy", "复制")}
                </Button>
              )}
            </div>
            {commitMessage ? (
              <div className="rounded-md border bg-muted/20 p-2.5">
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{commitMessage}</pre>
              </div>
            ) : (
              <Textarea
                placeholder={t("placeholder.manualMessage", "手动输入 commit 消息，或留空使用 diny AI 生成...")}
                value={manualMessage}
                onChange={(e) => patch({ manualMessage: e.target.value })}
                className="min-h-[60px] resize-y text-xs"
                disabled={running}
              />
            )}
          </div>

          {/* Diff Preview */}
          {result?.git?.diffPreview && !compactSurface && (
            <div className="flex flex-1 flex-col gap-1 overflow-hidden">
              <div className="text-xs font-medium text-muted-foreground">{t("labels.diffPreview", "Diff 预览")}</div>
              <ScrollArea className="flex-1 rounded-md border bg-muted/10">
                <pre className="p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {result.git.diffPreview}
                </pre>
              </ScrollArea>
            </div>
          )}

          {/* Log Panel */}
          {logs.length > 0 && (
            <div className="flex flex-col gap-1 overflow-hidden" style={{ maxHeight: compactSurface ? 100 : 140 }}>
              <div className="text-xs font-medium text-muted-foreground">{t("labels.logs", "日志")}</div>
              <ScrollArea className="flex-1 rounded-md border bg-muted/10">
                <div className="p-1.5">
                  {logs.map((log, i) => (
                    <div key={i} className="px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{log}</div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={!canGenerate}
          onClick={() => execute("generate")}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("actions.generate", "生成消息")}
        </Button>
        <Button
          size="sm"
          variant={dryRun ? "outline" : "default"}
          className="gap-1.5"
          disabled={!canCommit}
          onClick={() => execute("commit")}
        >
          {dryRun ? <Eye className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
          {dryRun ? t("actions.dryCommit", "预演提交") : t("actions.commit", "提交")}
        </Button>
        <Button
          size="sm"
          variant={dryRun ? "outline" : "default"}
          className="gap-1.5"
          disabled={!canPush}
          onClick={() => execute("push")}
        >
          <Send className="h-3.5 w-3.5" />
          {t("actions.push", "推送")}
        </Button>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 gap-1 text-xs", dryRun && "text-amber-500")}
            onClick={() => patch({ dryRun: !dryRun })}
          >
            <Eye className="h-3 w-3" />
            {dryRun ? t("switches.dryRunOn", "预演") : t("switches.dryRunOff", "实模式")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 gap-1 text-xs", noVerify && "text-amber-500")}
            onClick={() => patch({ noVerify: !noVerify })}
          >
            <ShieldAlert className="h-3 w-3" />
            {noVerify ? t("switches.noVerifyOn", "跳过钩子") : t("switches.noVerifyOff", "钩子")}
          </Button>
          {running ? (
            <Button variant="destructive" size="sm" className="h-7 gap-1" onClick={() => host.actions?.cancelCurrent?.()}>
              <Square className="h-3 w-3" />
              {t("actions.stop", "停止")}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={reset}>
              <RotateCcw className="h-3 w-3" />
              {t("actions.reset", "重置")}
            </Button>
          )}
          <NodeConfigButton nodeKey="gitalso" configDirty={configDirty} defaults={defaults} disabled={running} onResetOverride={() => defaults && patch(defaults)} onRestoreDefault={() => defaults && patch(defaults)} onSaveDefault={saveAsDefault} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="h-7 gap-1 text-xs" disabled={running} size="sm" title="备用：会初始化 GitButler 工作区并创建临时分支" variant="ghost">
                <GitPullRequestArrow className="h-3 w-3" />
                GitButler 备用
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>使用 GitButler 作为备用提交方式？</AlertDialogTitle>
                <AlertDialogDescription>这会执行 GitButler setup，切换到其 workspace、创建临时分支，并在 AI 提交后直接 land 到已配置的目标分支。日常提交请优先使用 diny。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => execute("gitbutler_commit")}>继续使用 GitButler</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Progress text */}
      {data.progressText && (
        <div className="text-xs text-muted-foreground truncate">{data.progressText}</div>
      )}

    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────

function phaseFromState(data: DinyCardState, running: boolean): DinyPhase {
  if (running) return data.phase ?? "generating"
  return data.phase ?? "idle"
}

function statusFromState(data: DinyCardState, running: boolean): DinyStatusMeta {
  const phase = phaseFromState(data, running)
  switch (phase) {
    case "generating":
    case "committing":
    case "pushing":
      return {
        label: data.progressText ?? "运行中",
        description: "Diny 正在执行操作。",
        tone: "running",
        badgeVariant: "default",
        iconClass: "text-blue-500",
      }
    case "completed":
      return {
        label: "完成",
        description: "操作已完成。",
        tone: "success",
        badgeVariant: "default",
        iconClass: "text-green-500",
      }
    case "error":
      return {
        label: "失败",
        description: "操作失败，请查看日志。",
        tone: "error",
        badgeVariant: "destructive",
        iconClass: "text-red-500",
      }
    default:
      return {
        label: "就绪",
        description: "粘贴仓库路径或留空使用当前目录。",
        tone: "idle",
        badgeVariant: "secondary",
        iconClass: "text-muted-foreground",
      }
  }
}
