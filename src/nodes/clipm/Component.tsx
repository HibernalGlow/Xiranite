import type { NodeComponentProps } from "@xiranite/contract"
import { BrainCircuit, ClipboardCheck, Play, ScanSearch, ServerCog } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import type { ClipmCardState, ClipmWorkspaceView } from "./types"
import type { ClipmNodeConfig } from "@xiranite/node-clipm/platform"
import { useClipmWorkspace, type ClipmWorkspaceController } from "./useClipmWorkspace"
import { CorrectionsView } from "./views/CorrectionsView"
import { ModelsView } from "./views/ModelsView"
import { ScoringView } from "./views/ScoringView"
import { TrainingView } from "./views/TrainingView"

const views = [
  { id: "scoring", label: "评分", icon: ScanSearch },
  { id: "corrections", label: "修正", icon: ClipboardCheck },
  { id: "training", label: "训练", icon: BrainCircuit },
  { id: "models", label: "模型与环境", icon: ServerCog },
] as const

export function Component({ compId, host }: NodeComponentProps<ClipmCardState, ClipmNodeConfig>) {
  "use no memo"
  const surface = useNodeSurface()
  const controller = useClipmWorkspace(compId, host)
  return <TooltipProvider><div ref={surface.ref} data-testid="clipm-surface" className="@container/clipm flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
    {surface.mode === "collapsed" || surface.mode === "compact" ? <Collapsed controller={controller} /> : <Workbench controller={controller} />}
  </div></TooltipProvider>
}

function Collapsed({ controller }: { controller: ClipmWorkspaceController }) {
  const { data, running } = controller
  return <div className="flex h-full w-full items-center gap-2 border px-3">
    <ScanSearch className="size-5 shrink-0 text-primary" />
    <div className="min-w-0 flex-1"><div className="text-sm font-semibold">ClipM</div><div className="truncate text-[10px] text-muted-foreground">{data.progressText || data.path || "等待任务"}</div></div>
    <Badge variant={data.phase === "error" ? "destructive" : data.phase === "completed" ? "default" : "outline"}>{data.phase ?? "idle"}</Badge>
    <Button aria-label="运行 ClipM 评分" size="icon-sm" disabled={running || !data.path?.trim()} onClick={() => void controller.run({ action: "score", path: data.path, scope: data.scoreScope ?? "library", scoreOptions: scoreOptions(data) })}><Play /></Button>
  </div>
}

function Workbench({ controller }: { controller: ClipmWorkspaceController }) {
  const { data } = controller
  const activeView = data.activeView ?? "scoring"
  const activeModel = data.modelsResult?.activeBundleVersion ?? data.environmentStatus?.activeBundleVersion
  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
      <div className="flex size-8 shrink-0 items-center justify-center border bg-muted/30"><ScanSearch className="size-4 text-primary" /></div>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-base font-semibold">ClipM 漫画偏好</h3><Badge variant="outline" className="font-mono">v{activeModel ?? "--"}</Badge></div><div className="truncate text-[10px] text-muted-foreground">{data.progressText || "评分、修正、训练与模型生命周期"}</div></div>
      <Badge variant={data.phase === "error" ? "destructive" : data.phase === "completed" ? "default" : "outline"}>{(data.phase ?? "idle").toUpperCase()}</Badge>
    </header>
    {data.phase === "running" ? <Progress className="h-1 shrink-0 rounded-none" value={data.progress ?? 0} /> : null}
    <Tabs className="min-h-0 flex-1 gap-0" value={activeView} onValueChange={(value) => controller.selectView(value as ClipmWorkspaceView)}>
      <TabsList aria-label="ClipM 工作区" className="h-10 w-full shrink-0 justify-start rounded-none border-b bg-muted/10 px-2" variant="line">
        {views.map(({ id, label, icon: Icon }) => <TabsTrigger key={id} value={id} aria-label={label}><Icon /><span className="hidden @xl/clipm:inline">{label}</span></TabsTrigger>)}
      </TabsList>
      <TabsContent value="scoring" className="min-h-0"><ScoringView controller={controller} /></TabsContent>
      <TabsContent value="corrections" className="min-h-0"><CorrectionsView controller={controller} /></TabsContent>
      <TabsContent value="training" className="min-h-0"><TrainingView controller={controller} /></TabsContent>
      <TabsContent value="models" className="min-h-0"><ModelsView controller={controller} /></TabsContent>
    </Tabs>
  </div>
}

function scoreOptions(data: ClipmCardState) {
  return {
    rescore: data.rescore ?? false,
    rename: data.rename ?? true,
    writeMetadata: data.writeMetadata ?? true,
    dryRun: data.dryRun ?? false,
  }
}
