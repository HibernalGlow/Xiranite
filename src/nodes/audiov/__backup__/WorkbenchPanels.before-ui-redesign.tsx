import type { CommandResult, PackuCommandPlan, PackuToolData } from "@xiranite/packu-node-runtime/core"
import { Clipboard, Copy, FileVideo, ScrollText, Terminal, Volume2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { AudiovCardState } from "./types"

export function PathsColumn(props: {
  data: AudiovCardState
  disabled?: boolean
  onPaste: () => void
  onPatch: (patch: Partial<AudiovCardState>) => void
}) {
  return (
    <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border bg-background/60">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FileVideo className="size-3.5" />
          <span>视频路径</span>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">每行一条</span>
      </div>
      <Separator className="shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
        <Textarea
          id="audiov-paths"
          aria-label="audiov 视频路径"
          disabled={props.disabled}
          className="min-h-0 flex-1 resize-none font-mono text-xs leading-5"
          placeholder={"粘贴视频文件路径，例如：\nD:/Video/clip1.mp4\nD:/Video/clip2.mkv"}
          value={props.data.pathsText ?? ""}
          onChange={(event) => props.onPatch({ pathsText: event.currentTarget.value })}
        />
        <Button disabled={props.disabled} size="xs" variant="outline" onClick={props.onPaste}>
          <Clipboard data-icon="inline-start" />
          粘贴路径
        </Button>
      </div>
    </section>
  )
}

export function CommandPreview(props: {
  compact?: boolean
  result: PackuToolData | null
  running?: boolean
  onCopy: () => void
}) {
  const command: PackuCommandPlan | undefined = props.result?.command
  const commandResult: CommandResult | undefined = props.result?.commandResult
  const hasCommand = Boolean(command?.command)
  const status = commandResult ? (commandResult.code === 0 ? "success" : "error") : hasCommand ? "planned" : "idle"

  return (
    <section
      data-testid="audiov-command-preview"
      className="relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-inner"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 rounded-full bg-rose-500/80" />
          <span className="size-2 rounded-full bg-amber-500/80" />
          <span className="size-2 rounded-full bg-emerald-500/80" />
          <Terminal className="ml-1 size-3.5 text-zinc-400" />
          <span className="truncate text-xs font-semibold text-zinc-200">命令预览</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasCommand && (
            <Badge
              variant={status === "error" ? "destructive" : status === "success" ? "default" : "outline"}
              className="shrink-0"
            >
              {status === "planned" && "待执行"}
              {status === "success" && "成功"}
              {status === "error" && "失败"}
            </Badge>
          )}
          <Button disabled={!hasCommand} size="xs" variant="ghost" className="text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100" onClick={props.onCopy}>
            <Copy data-icon="inline-start" />
            复制
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {hasCommand && command ? (
          <div className={props.compact ? "flex flex-col gap-2 p-2.5" : "flex flex-col gap-3 p-4"}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 font-mono text-sm text-emerald-400">▶</span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "break-all font-mono leading-relaxed text-zinc-100",
                    props.compact ? "text-sm" : "text-base @3xl/audiov:text-lg",
                  )}
                >
                  <span className="text-emerald-400">{command.command}</span>
                  <span className="text-zinc-400"> </span>
                  <span className="text-sky-300">{command.args.join(" ")}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
              <span className="h-px flex-1 bg-gradient-to-r from-emerald-500/40 via-zinc-700 to-transparent" />
              <Volume2 className="size-3" />
              <span className="h-px flex-1 bg-gradient-to-l from-sky-500/30 via-zinc-700 to-transparent" />
            </div>

            <div className="grid gap-1 font-mono text-[11px] text-zinc-400">
              <div className="flex min-w-0 gap-2">
                <span className="shrink-0 text-zinc-600">label</span>
                <span className="truncate text-zinc-300" title={command.label}>{command.label}</span>
              </div>
              {command.cwd && (
                <div className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-zinc-600">cwd</span>
                  <span className="truncate text-zinc-300" title={command.cwd}>{command.cwd}</span>
                </div>
              )}
              {command.env && Object.keys(command.env).length > 0 && (
                <div className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-zinc-600">env</span>
                  <span className="truncate text-zinc-300" title={JSON.stringify(command.env)}>
                    {Object.entries(command.env).map(([k, v]) => `${k}=${v}`).join(" ")}
                  </span>
                </div>
              )}
            </div>

            {commandResult?.stdout && (
              <pre className="overflow-auto rounded border border-zinc-800 bg-zinc-900/60 p-2 font-mono text-[11px] leading-5 text-zinc-300">
                {commandResult.stdout}
              </pre>
            )}
            {commandResult?.stderr && (
              <pre className="overflow-auto rounded border border-rose-900/50 bg-rose-950/30 p-2 font-mono text-[11px] leading-5 text-rose-300">
                {commandResult.stderr}
              </pre>
            )}
          </div>
        ) : (
          <div className={props.compact ? "flex h-full min-h-20 flex-col items-center justify-center gap-1.5 p-4 text-center" : "flex h-full min-h-28 flex-col items-center justify-center gap-2 p-6 text-center"}>
            <Volume2 className="text-zinc-600" />
            <div className="text-xs font-medium text-zinc-400">等待 ffmpeg 命令</div>
            <div className="text-[11px] text-zinc-600">运行生成计划后会显示音轨提取命令。</div>
          </div>
        )}
      </ScrollArea>

      {props.running && (
        <div className="flex h-1.5 shrink-0 items-end gap-0.5 bg-zinc-900/80 px-2 py-0.5" aria-hidden="true">
          {Array.from({ length: 48 }).map((_, i) => (
            <span
              key={i}
              className="flex-1 animate-pulse bg-emerald-400/70"
              style={{
                height: `${20 + Math.abs(Math.sin(i * 0.7 + Date.now() / 400)) * 80}%`,
                animationDelay: `${i * 40}ms`,
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function OutputConsole(props: {
  compact?: boolean
  logs: string[]
  running?: boolean
  onCopy: () => void
}) {
  return (
    <section
      data-testid="audiov-output-console"
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background/60"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ScrollText className="size-3.5" />
          <span>输出</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.logs.length > 0 && (
            <span className="text-[10px] tabular-nums text-muted-foreground/70">{props.logs.length} 行</span>
          )}
          <Button disabled={!props.logs.length} size="xs" variant="ghost" onClick={props.onCopy}>
            <Copy data-icon="inline-start" />
            复制
          </Button>
        </div>
      </div>
      <Separator className="shrink-0" />
      <ScrollArea className="min-h-0 flex-1">
        {props.logs.length ? (
          <pre className={props.compact ? "whitespace-pre-wrap p-2 font-mono text-[11px] leading-5 text-muted-foreground" : "whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-muted-foreground"}>
            {props.logs.join("\n")}
          </pre>
        ) : (
          <div className={props.compact ? "flex h-full min-h-20 items-center justify-center p-3 text-center text-[11px] text-muted-foreground" : "flex h-full min-h-28 items-center justify-center p-6 text-center text-xs text-muted-foreground"}>
            <span className="flex flex-col items-center gap-1.5">
              <ScrollText className="size-4" />
              <span>运行日志会显示在这里。</span>
            </span>
          </div>
        )}
      </ScrollArea>
    </section>
  )
}
