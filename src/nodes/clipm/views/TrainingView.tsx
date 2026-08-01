import { useEffect, useState } from "react"
import { Activity, BrainCircuit, Play, RefreshCw, Scale, ShieldCheck } from "lucide-react"
import type { HeadTrainingResult } from "@xiranite/node-clipm/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import type { ClipmWorkspaceController } from "../useClipmWorkspace"
import { LogsPanel, StatusBadge, ViewHeading } from "./shared"

export function TrainingView({ controller }: { controller: ClipmWorkspaceController }) {
  const { data, running } = controller
  const training = data.trainingResult
  const autoTrain = controller.environmentConfig.value?.auto_train ?? false
  const configuredBatchSize = controller.environmentConfig.value?.auto_train_batch_size ?? 20
  const [batchSize, setBatchSize] = useState(configuredBatchSize)

  useEffect(() => setBatchSize(configuredBatchSize), [configuredBatchSize])

  async function train() {
    const response = await controller.run({ action: "train" })
    if (response?.success) await controller.run({ action: "model-list", includeFailed: true })
  }

  return <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto @5xl/clipm:grid-cols-[minmax(300px,0.7fr)_minmax(520px,1.4fr)] @5xl/clipm:overflow-hidden">
    <section className="flex min-h-[420px] flex-col border-r @5xl/clipm:min-h-0">
      <ViewHeading icon={BrainCircuit} title="训练控制" detail="从当前反馈快照独立训练并验证分类头与评分头" />
      <div className="grid gap-4 p-3">
        <div className="grid grid-cols-2 divide-x border text-center"><Stat label="数据 revision" value={training?.dataRevision ?? "--"} /><Stat label="活动模型" value={`v${training?.activeBundleVersion ?? data.modelsResult?.activeBundleVersion ?? "--"}`} /></div>
        <Field orientation="horizontal" className="border px-3 py-2"><FieldContent><FieldTitle className="text-xs">自动训练</FieldTitle><FieldDescription className="text-[10px]">反馈成批后，在 ClipM 空闲十分钟时尝试一次</FieldDescription></FieldContent><Switch aria-label="自动训练" size="sm" checked={autoTrain} disabled={running || controller.environmentConfig.loading} onCheckedChange={(enabled) => void controller.updateConfig({ auto_train: enabled })} /></Field>
        <div className="grid grid-cols-[1fr_96px] items-center gap-3 border px-3 py-2"><div><div className="text-xs font-medium">批量作品数</div><div className="text-[10px] text-muted-foreground">按最新有效修正的不同作品计数</div></div><Input aria-label="自动训练批量作品数" type="number" min={1} max={1000} step={1} value={batchSize} disabled={running || controller.environmentConfig.loading} onChange={(event) => setBatchSize(Number(event.currentTarget.value))} onBlur={() => { const normalized = Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 1000 ? batchSize : 20; setBatchSize(normalized); void controller.updateConfig({ auto_train_batch_size: normalized }) }} /></div>
        <Button disabled={running} onClick={() => void train()}>{running && data.busyAction === "train" ? <RefreshCw className="animate-spin" /> : <Play />}训练并验证新头部</Button>
        {running ? <div className="grid gap-1.5"><Progress aria-label="ClipM 训练进度" value={data.progress ?? 0} /><div className="text-[10px] text-muted-foreground">{data.progressText}</div></div> : null}
      </div>
      <div className="mt-auto"><LogsPanel logs={data.logs} /></div>
    </section>

    <section className="flex min-h-[380px] flex-col @5xl/clipm:min-h-0">
      <ViewHeading icon={Activity} title="训练结果" detail={training ? `run ${training.runId}` : "尚未在当前工作区运行训练"} actions={training ? <Badge variant="outline">revision {training.dataRevision}</Badge> : null} />
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y @3xl/clipm:grid-cols-2 @3xl/clipm:divide-x @3xl/clipm:divide-y-0">
        <HeadResult icon={ShieldCheck} title="P/N 分类头" result={training?.classification} />
        <HeadResult icon={Scale} title="数值评分头" result={training?.ranking} />
      </div>
    </section>
  </div>
}

function HeadResult(props: { icon: typeof ShieldCheck; title: string; result?: HeadTrainingResult }) {
  const Icon = props.icon
  return <div className="flex min-h-0 flex-col p-4">
    <div className="flex items-center justify-between gap-3 border-b pb-3"><div className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-primary" />{props.title}</div>{props.result ? <StatusBadge value={props.result.status} /> : <Badge variant="outline">待训练</Badge>}</div>
    <div className="grid grid-cols-2 gap-px bg-border mt-4"><div className="bg-background p-3"><div className="text-[10px] text-muted-foreground">候选版本</div><div className="mt-1 font-mono text-lg font-semibold">{props.result?.bundleVersion ? `v${props.result.bundleVersion}` : "--"}</div></div><div className="bg-background p-3"><div className="text-[10px] text-muted-foreground">验证状态</div><div className="mt-1 text-sm font-medium">{props.result?.status ?? "pending"}</div></div></div>
    <div className="mt-4 min-h-0 flex-1"><div className="mb-2 text-xs font-medium">验证原因</div><div className="grid gap-2">{props.result?.reasons?.length ? props.result.reasons.map((reason) => <div key={reason} className="border-l-2 border-muted-foreground/30 pl-2 text-xs leading-5 text-muted-foreground">{reason}</div>) : <div className="text-xs text-muted-foreground">暂无验证原因</div>}</div></div>
  </div>
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="px-3 py-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div></div>
}
