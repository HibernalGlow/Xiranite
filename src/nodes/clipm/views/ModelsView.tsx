import { Cpu, Database, HardDrive, PackageCheck, Power, RefreshCw, RotateCcw, ServerCog, TriangleAlert } from "lucide-react"
import type { ModelSummary } from "@xiranite/node-clipm/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ClipmWorkspaceController } from "../useClipmWorkspace"
import { EnvironmentDialog } from "./EnvironmentDialog"
import { IconButton, StatusBadge, ViewHeading } from "./shared"

export function ModelsView({ controller }: { controller: ClipmWorkspaceController }) {
  const { data, running, patch } = controller
  const environment = data.environmentStatus
  const configuredRoot = controller.environmentConfig.value?.runtime_root
  const models = data.modelsResult?.models ?? []
  const activeVersion = data.modelsResult?.activeBundleVersion ?? environment?.activeBundleVersion

  async function activate(model: ModelSummary) {
    const response = model.status === "inactive"
      ? await controller.run({ action: "model-rollback", bundleVersion: model.bundleVersion })
      : await controller.run({ action: "model-activate", bundleVersion: model.bundleVersion, force: data.forceActivation ?? false })
    if (response?.success) await controller.refreshModels()
  }

  return <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)]">
    <section className="border-b">
      <ViewHeading
        icon={ServerCog}
        title="运行环境"
        detail={environment?.runtimeRoot ?? configuredRoot ?? "尚未设置 ClipM 外置运行环境"}
        actions={<div className="flex items-center gap-2">
          <EnvironmentDialog controller={controller} mode={configuredRoot ? "migrate" : "setup"} />
          <IconButton icon={RefreshCw} label="刷新模型与环境" disabled={running || !configuredRoot} onClick={controller.refreshModels} />
        </div>}
      />
      {controller.environmentConfig.error ? <div role="alert" className="flex items-center gap-1.5 border-t bg-destructive/5 px-3 py-2 text-xs text-destructive"><TriangleAlert className="size-3.5" />{controller.environmentConfig.error}</div> : null}
      {!configuredRoot && !controller.environmentConfig.loading ? <div className="border-t bg-muted/20 px-3 py-3"><div className="text-sm font-medium">需要设置外置运行目录</div><div className="truncate text-xs text-muted-foreground">UV、Python、模型与缓存将写入所选目录。</div></div> : null}
      <div className="grid grid-cols-2 divide-x @3xl/clipm:grid-cols-4">
        <HealthCell icon={Cpu} label="计算设备" value={environment ? `${environment.device.toUpperCase()} / CUDA ${environment.cudaAvailable ? "ON" : "OFF"}` : "--"} healthy={environment ? environment.device === "cpu" || environment.cudaAvailable : false} />
        <HealthCell icon={Database} label="数据库" value={environment?.databaseOk ? "ready" : "unavailable"} healthy={environment?.databaseOk ?? false} />
        <HealthCell icon={PackageCheck} label="活动模型" value={activeVersion ? `v${activeVersion}` : "--"} healthy={environment?.modelAvailable ?? false} />
        <HealthCell icon={HardDrive} label="归档工具" value={environment ? `7Z ${environment.sevenZipAvailable ? "ON" : "OFF"} / RAR ${environment.rarAvailable ? "ON" : "OFF"}` : "--"} healthy={environment?.sevenZipAvailable ?? false} />
      </div>
      {environment?.warnings?.length ? <div role="alert" className="flex flex-wrap gap-x-4 gap-y-1 border-t bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{environment.warnings.map((warning) => <span key={warning} className="flex items-center gap-1.5"><TriangleAlert className="size-3.5" />{warning}</span>)}</div> : null}
    </section>

    <section className="flex min-h-0 flex-col">
      <ViewHeading icon={PackageCheck} title="模型版本" detail="候选、失败版本与历史版本均保留为不可变 bundle" actions={<Field orientation="horizontal" className="w-52 border px-2 py-1"><FieldContent><FieldTitle className="text-[11px]">强制激活失败候选</FieldTitle><FieldDescription className="text-[9px]">回滚后恢复 failed</FieldDescription></FieldContent><Switch aria-label="强制激活失败候选" size="sm" checked={data.forceActivation ?? false} disabled={running} onCheckedChange={(forceActivation) => patch({ forceActivation })} /></Field>} />
      <ScrollArea className="min-h-0 flex-1">
        <Table className="min-w-[820px] text-xs"><TableHeader><TableRow><TableHead className="w-20">版本</TableHead><TableHead className="w-24">状态</TableHead><TableHead>分类验证</TableHead><TableHead>评分验证</TableHead><TableHead className="w-28">数据 revision</TableHead><TableHead className="w-24 text-right">操作</TableHead></TableRow></TableHeader><TableBody>
          {models.length ? models.map((model) => <TableRow key={model.bundleVersion} data-testid={`clipm-model-${model.bundleVersion}`} data-state={model.bundleVersion === activeVersion ? "selected" : undefined}><TableCell><div className="font-mono text-base font-semibold">v{model.bundleVersion}</div>{model.bundleVersion === activeVersion ? <Badge className="mt-1" variant="secondary">ACTIVE</Badge> : null}</TableCell><TableCell><StatusBadge value={model.status} /></TableCell><TableCell><ValidationSummary status={model.classificationValidationStatus} reasons={model.classificationValidationReasons} /></TableCell><TableCell><ValidationSummary status={model.rankingValidationStatus ?? "none"} reasons={model.rankingValidationReasons} /></TableCell><TableCell className="font-mono tabular-nums">{model.dataRevision}</TableCell><TableCell className="text-right">{model.bundleVersion === activeVersion ? null : <Button size="sm" variant="outline" disabled={running || (model.status === "failed" && !data.forceActivation)} onClick={() => void activate(model)}>{model.status === "inactive" ? <RotateCcw /> : <Power />}{model.status === "inactive" ? "回滚" : "激活"}</Button>}</TableCell></TableRow>) : <TableRow><TableCell colSpan={6} className="h-48 text-center text-muted-foreground">刷新后显示模型版本</TableCell></TableRow>}
        </TableBody>
        </Table>
      </ScrollArea>
    </section>
  </div>
}

function HealthCell(props: { icon: typeof Cpu; label: string; value: string; healthy: boolean }) {
  const Icon = props.icon
  return <div className="flex min-w-0 items-center gap-2 px-3 py-2"><Icon className={props.healthy ? "size-4 text-emerald-600" : "size-4 text-muted-foreground"} /><div className="min-w-0"><div className="text-[10px] text-muted-foreground">{props.label}</div><div className="truncate font-mono text-xs font-medium">{props.value}</div></div></div>
}

function ValidationSummary({ status, reasons }: { status: string; reasons?: string[] }) {
  return <div className="grid gap-1"><StatusBadge value={status} />{reasons?.length ? <div className="max-w-72 truncate text-[10px] text-muted-foreground" title={reasons.join("\n")}>{reasons.join("; ")}</div> : null}</div>
}
