import { useEffect, useState } from "react"
import { FolderOpen, Play, ScanSearch, Square, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ClipmWorkspaceController } from "../useClipmWorkspace"
import { scoreFailures, scoreWorks } from "../workspace-state"
import { FailureTable, IconButton, LogsPanel, ViewHeading, WorkScoreTable } from "./shared"

export function ScoringView({ controller }: { controller: ClipmWorkspaceController }) {
  const { data, running, patch } = controller
  const [resultTab, setResultTab] = useState("positive")
  const works = scoreWorks(data.scoreResult)
  const positives = works.filter((work) => work.label === "P")
  const negatives = works.filter((work) => work.label === "N")
  const failures = scoreFailures(data.scoreResult)

  async function score() {
    await controller.run({
      action: "score",
      path: data.path,
      scope: data.scoreScope ?? "library",
      scoreOptions: {
        rescore: data.rescore ?? false,
        rename: data.rename ?? true,
        writeMetadata: data.writeMetadata ?? true,
        dryRun: data.dryRun ?? false,
      },
    })
  }

  return <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto @5xl/clipm:grid-cols-[minmax(280px,0.72fr)_minmax(520px,1.55fr)] @5xl/clipm:overflow-hidden">
    <section className="flex min-h-[540px] min-w-0 flex-col border-r @5xl/clipm:min-h-0">
      <ViewHeading icon={ScanSearch} title="评分任务" detail="选择作品或目录并同步 CM 名称、JSON 与数据库" />
      <div className="grid gap-3 p-3">
        <div className="grid gap-1.5">
          <label className="text-xs font-medium" htmlFor="clipm-score-path">漫画路径</label>
          <div className="flex gap-1.5"><Input id="clipm-score-path" aria-label="漫画路径" className="font-mono text-xs" disabled={running} value={data.path ?? ""} onChange={(event) => patch({ path: event.currentTarget.value })} /><IconButton icon={FolderOpen} label="选择漫画目录" disabled={running} onClick={controller.pickDirectory} /></div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium">评分范围</span>
          <ToggleGroup aria-label="评分范围" type="single" value={data.scoreScope ?? "library"} variant="selection" size="sm" className="grid w-full grid-cols-2" disabled={running} onValueChange={(value) => value && patch({ scoreScope: value as "library" | "work" })}>
            <ToggleGroupItem value="library" className="min-w-0">整库</ToggleGroupItem>
            <ToggleGroupItem value="work" className="min-w-0">单本</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <ScoringPerformanceControls controller={controller} />
        <ScoreSetting title="重命名" description="同步规范 CM 后缀" checked={data.rename ?? true} disabled={running} onChange={(rename) => patch({ rename })} />
        <ScoreSetting title="包内元数据" description="写入根目录恢复 JSON" checked={data.writeMetadata ?? true} disabled={running} onChange={(writeMetadata) => patch({ writeMetadata })} />
        <ScoreSetting title="重新评分" description="忽略已有当前评分" checked={data.rescore ?? false} disabled={running} onChange={(rescore) => patch({ rescore })} />
        <ScoreSetting title="预演" description="不修改作品文件" checked={data.dryRun ?? false} disabled={running} onChange={(dryRun) => patch({ dryRun })} />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={running || !data.path?.trim()} onClick={() => void score()}>{running ? <ScanSearch className="animate-pulse" /> : <Play />}{data.dryRun ? "预演评分" : "评分并同步"}</Button>
          {running ? <IconButton icon={Square} label="取消当前任务" variant="destructive" onClick={controller.cancel} /> : null}
        </div>
        {running ? <Progress aria-label="ClipM 评分进度" value={data.progress ?? 0} /> : null}
      </div>
      <div className="mt-auto"><LogsPanel logs={data.logs} /></div>
    </section>

    <section className="flex min-h-[360px] min-w-0 flex-col @5xl/clipm:min-h-0">
      <ViewHeading icon={ScanSearch} title="评分结果" detail={data.progressText || "按 P/N 分组并在组内按数值评分查看"} actions={<div className="flex gap-1"><Metric label="P" value={positives.length} tone="positive" /><Metric label="N" value={negatives.length} tone="negative" /><Metric label="失败" value={failures.length} tone="warning" /></div>} />
      <Tabs className="min-h-0 flex-1 gap-0" value={resultTab} onValueChange={setResultTab}>
        <TabsList className="w-full justify-start border-b px-3" variant="line"><TabsTrigger value="positive">喜欢 <Badge variant="secondary">{positives.length}</Badge></TabsTrigger><TabsTrigger value="negative">不喜欢 <Badge variant="secondary">{negatives.length}</Badge></TabsTrigger><TabsTrigger value="failures"><TriangleAlert />问题 <Badge variant="secondary">{failures.length}</Badge></TabsTrigger></TabsList>
        <TabsContent value="positive" className="flex min-h-0 min-w-0 flex-col"><WorkScoreTable works={positives} /></TabsContent>
        <TabsContent value="negative" className="flex min-h-0 min-w-0 flex-col"><WorkScoreTable works={negatives} /></TabsContent>
        <TabsContent value="failures" className="flex min-h-0 min-w-0 flex-col"><FailureTable failures={failures} /></TabsContent>
      </Tabs>
    </section>
  </div>
}

type ScoringPerformanceValues = {
  scoring_work_batch_size: number
  scoring_page_batch_size: number
  scoring_batch_pause_ms: number
}

const DAILY_LIMITS: ScoringPerformanceValues = {
  scoring_work_batch_size: 1,
  scoring_page_batch_size: 8,
  scoring_batch_pause_ms: 250,
}
const FULL_SPEED_LIMITS: ScoringPerformanceValues = {
  scoring_work_batch_size: 8,
  scoring_page_batch_size: 32,
  scoring_batch_pause_ms: 0,
}

function ScoringPerformanceControls({ controller }: { controller: ClipmWorkspaceController }) {
  const config = controller.environmentConfig.value
  const configured = {
    scoring_work_batch_size: config?.scoring_work_batch_size ?? FULL_SPEED_LIMITS.scoring_work_batch_size,
    scoring_page_batch_size: config?.scoring_page_batch_size ?? FULL_SPEED_LIMITS.scoring_page_batch_size,
    scoring_batch_pause_ms: config?.scoring_batch_pause_ms ?? FULL_SPEED_LIMITS.scoring_batch_pause_ms,
  }
  const [draft, setDraft] = useState(configured)
  useEffect(() => setDraft(configured), [
    configured.scoring_work_batch_size,
    configured.scoring_page_batch_size,
    configured.scoring_batch_pause_ms,
  ])
  const mode = sameLimits(configured, DAILY_LIMITS)
    ? "daily"
    : sameLimits(configured, FULL_SPEED_LIMITS) ? "full" : "custom"

  async function apply(values: ScoringPerformanceValues) {
    setDraft(values)
    await controller.updateConfig(values)
  }

  async function commit(
    key: keyof ScoringPerformanceValues,
    minimum: number,
    maximum: number,
  ) {
    const value = Math.min(maximum, Math.max(minimum, Math.round(draft[key])))
    await apply({ ...draft, [key]: value })
  }

  return <div className="grid gap-2 border-y py-2" data-testid="clipm-scoring-performance">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium">性能上限</span>
      <ToggleGroup aria-label="评分性能模式" type="single" value={mode} variant="selection" size="sm" onValueChange={(value) => {
        if (value === "daily") void apply(DAILY_LIMITS)
        if (value === "full") void apply(FULL_SPEED_LIMITS)
      }}>
        <ToggleGroupItem value="daily">日常</ToggleGroupItem>
        <ToggleGroupItem value="full">挂机</ToggleGroupItem>
        <ToggleGroupItem value="custom" disabled>自定</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div className="grid grid-cols-3 gap-2">
      <PerformanceInput label="作品批量" value={draft.scoring_work_batch_size} min={1} max={32} onChange={(value) => setDraft((current) => ({ ...current, scoring_work_batch_size: value }))} onCommit={() => void commit("scoring_work_batch_size", 1, 32)} />
      <PerformanceInput label="页面批量" value={draft.scoring_page_batch_size} min={1} max={128} onChange={(value) => setDraft((current) => ({ ...current, scoring_page_batch_size: value }))} onCommit={() => void commit("scoring_page_batch_size", 1, 128)} />
      <PerformanceInput label="批间暂停 ms" value={draft.scoring_batch_pause_ms} min={0} max={10000} step={50} onChange={(value) => setDraft((current) => ({ ...current, scoring_batch_pause_ms: value }))} onCommit={() => void commit("scoring_batch_pause_ms", 0, 10_000)} />
    </div>
  </div>
}

function PerformanceInput(props: { label: string; value: number; min: number; max: number; step?: number; onChange(value: number): void; onCommit(): void }) {
  return <label className="grid min-w-0 gap-1 text-[10px] text-muted-foreground">
    <span className="truncate">{props.label}</span>
    <Input aria-label={props.label} className="h-8 font-mono text-xs tabular-nums" type="number" value={props.value} min={props.min} max={props.max} step={props.step ?? 1} onChange={(event) => props.onChange(Number(event.currentTarget.value))} onBlur={props.onCommit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur() }} />
  </label>
}

function sameLimits(left: ScoringPerformanceValues, right: ScoringPerformanceValues): boolean {
  return left.scoring_work_batch_size === right.scoring_work_batch_size
    && left.scoring_page_batch_size === right.scoring_page_batch_size
    && left.scoring_batch_pause_ms === right.scoring_batch_pause_ms
}

function ScoreSetting(props: { title: string; description: string; checked: boolean; disabled: boolean; onChange(value: boolean): void }) {
  return <Field orientation="horizontal" className="border px-2.5 py-2"><FieldContent><FieldTitle className="text-xs">{props.title}</FieldTitle><FieldDescription className="text-[10px]">{props.description}</FieldDescription></FieldContent><Switch aria-label={props.title} size="sm" checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} /></Field>
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "positive" | "negative" | "warning" }) {
  const color = tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : "text-amber-600"
  return <div className="min-w-12 border-l px-2 text-right"><div className="text-[9px] text-muted-foreground">{label}</div><div className={`font-mono text-sm font-semibold tabular-nums ${color}`}>{value}</div></div>
}
