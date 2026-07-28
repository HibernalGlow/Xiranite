// Read-only presentation of the latest workflow run: per-source step chain
// with inputs/outputs/errors plus the final diffs. Never executes transforms.
import { Clipboard } from "lucide-react"
import type { MarkuData, MarkuWorkflowRunData, MarkuWorkflowSourceResult } from "@xiranite/node-marku/core"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { findModuleMeta } from "./constants"
import { ActionIconButton } from "./controls"

interface WorkflowResultsProps {
  result: MarkuData | null
  run: MarkuWorkflowRunData | null
  onCopyText: (text: string) => void
}

export function WorkflowResults(props: WorkflowResultsProps) {
  return (
    <div data-testid="marku-workflow-results" className="flex h-full min-h-0 flex-col rounded-lg border bg-background/70">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <span>工作流结果</span>
          {props.run && (
            <>
              <Badge variant="outline" className="shrink-0">{props.run.stepCount} 步</Badge>
              <Badge variant="outline" className="shrink-0">{props.run.sources.length} 个来源</Badge>
            </>
          )}
        </div>
        {props.run && (
          <ActionIconButton
            disabled={!props.run.sources.some((source) => source.outputText)}
            icon={Clipboard}
            label="复制全部输出"
            onClick={() => props.onCopyText(props.run?.sources.map((source) => source.outputText).join("\n\n") ?? "")}
          />
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {props.run ? (
          <div className="grid gap-2 p-3">
            {props.run.sources.map((source) => (
              <SourceResult key={source.sourceId} source={source} onCopyText={props.onCopyText} />
            ))}
            {props.result && props.result.diffs.some((item) => item.changed) && (
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="mb-1 text-xs font-medium">最终差异</div>
                <div className="grid gap-1.5">
                  {props.result.diffs.filter((item) => item.changed).slice(0, 40).map((item) => (
                    <div key={item.file} className="rounded-md border bg-background/70 px-2 py-1.5">
                      <div className="truncate text-xs font-medium text-primary">{item.file}</div>
                      {item.diff && (
                        <pre className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] opacity-80">{item.diff}</pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-24 items-center justify-center p-4 text-center text-xs text-muted-foreground">
            运行工作流后，这里会按来源展示每一步的输入输出与差异。
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function SourceResult({ onCopyText, source }: { onCopyText: (text: string) => void; source: MarkuWorkflowSourceResult }) {
  return (
    <div className={cn("rounded-md border bg-muted/30 p-2", source.error && "border-destructive/40 bg-destructive/10")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-medium" title={source.sourceLabel}>{source.sourceLabel}</div>
        <div className="flex shrink-0 items-center gap-1">
          {source.error ? <Badge variant="destructive">失败</Badge> : <Badge variant="outline">{source.steps.length} 步完成</Badge>}
          <ActionIconButton disabled={!source.outputText} icon={Clipboard} label="复制来源输出" onClick={() => onCopyText(source.outputText)} />
        </div>
      </div>
      {source.error && <div className="mt-1 text-xs text-destructive">{source.error}</div>}
      <div className="mt-1.5 grid gap-1">
        {source.steps.map((step, index) => {
          const meta = findModuleMeta(step.module)
          return (
            <div key={step.stepId} className={cn("rounded-md border bg-background/70 px-2 py-1.5", step.error && "border-destructive/40")}>
              <div className="flex items-center gap-1.5 text-xs">
                <Badge variant="outline" className="shrink-0 tabular-nums">{index + 1}</Badge>
                <span className="min-w-0 truncate font-medium">{meta.shortLabel}</span>
                {step.error
                  ? <Badge variant="destructive" className="ml-auto shrink-0">错误</Badge>
                  : <Badge variant={step.changed ? "secondary" : "outline"} className="ml-auto shrink-0">{step.changed ? "有变更" : "无变化"}</Badge>}
              </div>
              {step.error ? (
                <div className="mt-1 text-xs text-destructive">{step.error}</div>
              ) : (
                <pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{step.outputText}</pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
