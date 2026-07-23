import { useEffect, useRef, useState, type ReactNode } from "react"
import { Activity, CheckCircle2, CircleAlert, FileCode2, Network, Play, RefreshCw, Save, Settings2, Sparkles } from "lucide-react"
import type { NodeComponentProps, NodeRunEvent } from "@xiranite/contract"
import {
  DEFAULT_COMFYUI_ENDPOINT,
  DEFAULT_COMFYGURE_PROGRAM,
  normalizeComfygureProgram,
  type ComfygureData,
  type ComfygureInput,
  type ComfygureProgram,
} from "@xiranite/node-comfygure/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { formatLoraRows, parseLoraRows, type ComfygureCardState, type ComfygureTargetConfig } from "./types"

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface()
  const stored = host.getData<ComfygureCardState>(compId) ?? {}
  const stateRef = useRef(stored)
  stateRef.current = stored
  const [revision, setRevision] = useState(0)
  const [running, setRunning] = useState<"compile" | "preflight" | "submit" | null>(null)
  const [target, setTarget] = useState<ComfygureTargetConfig>({ endpoint: DEFAULT_COMFYUI_ENDPOINT, libraryPath: "" })
  const [targetLoaded, setTargetLoaded] = useState(false)
  const program = normalizeComfygureProgram(stored.program ?? DEFAULT_COMFYGURE_PROGRAM)
  void revision

  useEffect(() => {
    if (!host.getNodeConfig) {
      setTargetLoaded(true)
      return
    }
    let active = true
    void host.getNodeConfig<ComfygureTargetConfig>().then((response) => {
      if (!active || !response?.config) return
      setTarget({
        endpoint: response.config.endpoint || DEFAULT_COMFYUI_ENDPOINT,
        libraryPath: response.config.libraryPath ?? "",
      })
      setTargetLoaded(true)
    }).catch(() => { if (active) setTargetLoaded(true) })
    return () => { active = false }
  }, [host])

  function patch(next: Partial<ComfygureCardState>) {
    stateRef.current = { ...stateRef.current, ...next }
    host.patchData(compId, next)
    setRevision((value) => value + 1)
  }

  function updateProgram(next: Partial<ComfygureProgram>) {
    const current = normalizeComfygureProgram(stateRef.current.program ?? DEFAULT_COMFYGURE_PROGRAM)
    patch({
      program: normalizeComfygureProgram({
        ...current,
        ...next,
        model: { ...current.model, ...next.model },
        prompts: { ...current.prompts, ...next.prompts },
        parameters: { ...current.parameters, ...next.parameters },
        teaCache: { ...current.teaCache, ...next.teaCache },
        output: { ...current.output, ...next.output },
      }),
    })
  }

  async function saveTarget() {
    await host.saveNodeConfig?.({ endpoint: target.endpoint?.trim() || DEFAULT_COMFYUI_ENDPOINT, libraryPath: target.libraryPath?.trim() || undefined })
    patch({ status: "Local ComfyUI target saved." })
  }

  async function execute(action: "compile" | "preflight" | "submit") {
    const run = host.runner?.run ?? host.actions?.run
    if (!run || running) {
      if (!run) patch({ status: "The Xiranite backend runner is unavailable." })
      return
    }
    setRunning(action)
    patch({ status: action === "compile" ? "Compiling a fixed prompt graph." : action === "preflight" ? "Inspecting the local ComfyUI target." : "Submitting a fixed prompt graph.", progress: 0 })
    try {
      const result = await run<ComfygureInput, ComfygureData>("comfygure", {
        action,
        program: stateRef.current.program ?? program,
        target: { endpoint: target.endpoint },
      }, (event: NodeRunEvent) => {
        if (event.type === "progress") patch({ status: event.message, progress: event.progress })
      })
      const data = result?.data
      if (data?.compiled) {
        patch({
          preview: {
            graphNodeCount: Object.keys(data.compiled.graph).length,
            activeLoraNames: data.compiled.activeLoras.map((lora) => lora.name),
            positivePrompt: data.compiled.positivePrompt,
            negativePrompt: data.compiled.negativePrompt,
          },
          preflight: data.preflight,
          submission: data.submission,
          status: result.message,
          progress: result.success ? 100 : stateRef.current.progress,
        })
      } else patch({ status: result?.message ?? "The backend did not return a compiler result." })
    } finally {
      setRunning(null)
    }
  }

  const preflight = stored.preflight
  const preview = stored.preview
  const isCollapsed = surface.mode === "collapsed"
  return <div ref={surface.ref} className="@container/comfygure flex h-full min-h-0 w-full flex-col overflow-auto p-3" data-testid="comfygure-workbench">
    <header className="flex min-w-0 items-center justify-between gap-2 border-b pb-2">
      <div className="flex min-w-0 items-center gap-2"><Sparkles className="size-4 shrink-0" /><div className="min-w-0"><h2 className="truncate text-sm font-semibold">Comfygure</h2><p className="truncate text-xs text-muted-foreground">{stored.status ?? "Fixed ComfyUI compiler"}</p></div></div>
      <div className="flex shrink-0 items-center gap-1"><Badge variant={preflight?.online ? "secondary" : "outline"}>{preflight?.online ? "Target online" : "Local target"}</Badge>{running ? <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" /> : null}</div>
    </header>
    {isCollapsed ? <p className="mt-2 truncate text-xs text-muted-foreground">{preview ? `${preview.graphNodeCount} fixed nodes` : "Expand to edit and preflight."}</p> : <div className="grid min-h-0 flex-1 gap-3 pt-3 @4xl/comfygure:grid-cols-[minmax(0,1fr)_minmax(248px,0.72fr)]">
      <section className="min-w-0 space-y-3">
        <div className="grid gap-2 @xl/comfygure:grid-cols-2"><Field label="Program"><Input value={program.name} onChange={(event) => updateProgram({ name: event.currentTarget.value })} /></Field><Field label="Output prefix"><Input value={program.output.filenamePrefix} onChange={(event) => updateProgram({ output: { ...program.output, filenamePrefix: event.currentTarget.value } })} /></Field></div>
        <Field label="Positive prompt"><Textarea className="min-h-24" value={program.prompts.positive} onChange={(event) => updateProgram({ prompts: { ...program.prompts, positive: event.currentTarget.value } })} /></Field>
        <div className="grid gap-2 @xl/comfygure:grid-cols-2"><Field label="Positive prefix"><Textarea className="min-h-18" value={program.prompts.positivePrefix} onChange={(event) => updateProgram({ prompts: { ...program.prompts, positivePrefix: event.currentTarget.value } })} /></Field><Field label="Negative prompt"><Textarea className="min-h-18" value={program.prompts.negative} onChange={(event) => updateProgram({ prompts: { ...program.prompts, negative: event.currentTarget.value } })} /></Field></div>
        <Field label="LoRA rows"><Textarea className="min-h-24 font-mono text-xs" value={formatLoraRows(program.loras)} placeholder="folder/style.safetensors | 1 | 1 | activation terms | injected terms" onChange={(event) => updateProgram({ loras: parseLoraRows(event.currentTarget.value) })} /></Field>
        <div className="grid gap-2 grid-cols-2 @2xl/comfygure:grid-cols-4"><NumberField label="Width" value={program.parameters.width} onValueChange={(width) => updateProgram({ parameters: { ...program.parameters, width } })} /><NumberField label="Height" value={program.parameters.height} onValueChange={(height) => updateProgram({ parameters: { ...program.parameters, height } })} /><NumberField label="Seed" value={program.parameters.seed} onValueChange={(seed) => updateProgram({ parameters: { ...program.parameters, seed } })} /><NumberField label="Batch" value={program.parameters.batchSize} onValueChange={(batchSize) => updateProgram({ parameters: { ...program.parameters, batchSize } })} /><NumberField label="Steps" value={program.parameters.steps} onValueChange={(steps) => updateProgram({ parameters: { ...program.parameters, steps } })} /><NumberField label="CFG" value={program.parameters.cfg} step="0.1" onValueChange={(cfg) => updateProgram({ parameters: { ...program.parameters, cfg } })} /><NumberField label="Denoise" value={program.parameters.denoise} step="0.01" onValueChange={(denoise) => updateProgram({ parameters: { ...program.parameters, denoise } })} /></div>
        <div className="grid gap-2 @xl/comfygure:grid-cols-2"><Field label="Sampler"><Input value={program.parameters.samplerName} onChange={(event) => updateProgram({ parameters: { ...program.parameters, samplerName: event.currentTarget.value } })} /></Field><Field label="Scheduler"><Input value={program.parameters.scheduler} onChange={(event) => updateProgram({ parameters: { ...program.parameters, scheduler: event.currentTarget.value } })} /></Field></div>
      </section>
      <aside className="min-w-0 space-y-3 border-t pt-3 @4xl/comfygure:border-l @4xl/comfygure:border-t-0 @4xl/comfygure:pl-3 @4xl/comfygure:pt-0">
        <div className="flex items-center gap-2"><Network className="size-4" /><h3 className="text-sm font-semibold">Local target</h3></div>
        <Field label="Endpoint"><Input value={target.endpoint ?? DEFAULT_COMFYUI_ENDPOINT} disabled={running !== null} onChange={(event) => setTarget((current) => ({ ...current, endpoint: event.currentTarget.value }))} /></Field>
        <Field label="ComfyUI Library"><Input value={target.libraryPath ?? ""} disabled={running !== null} placeholder="D:/1Repo/Github/ComfyUI/Library" onChange={(event) => setTarget((current) => ({ ...current, libraryPath: event.currentTarget.value }))} /></Field>
        <Button className="w-full" size="sm" variant="outline" disabled={running !== null || !targetLoaded} onClick={() => void saveTarget()}><Save />Save target</Button>
        <div className="space-y-2 border-t pt-3"><Field label="UNet"><Input value={program.model.unetName} onChange={(event) => updateProgram({ model: { ...program.model, unetName: event.currentTarget.value } })} /></Field><Field label="CLIP"><Input value={program.model.clipName} onChange={(event) => updateProgram({ model: { ...program.model, clipName: event.currentTarget.value } })} /></Field><Field label="VAE"><Input value={program.model.vaeName} onChange={(event) => updateProgram({ model: { ...program.model, vaeName: event.currentTarget.value } })} /></Field></div>
        <div className="grid grid-cols-3 gap-2"><Button size="sm" variant="outline" disabled={running !== null} onClick={() => void execute("compile")}><FileCode2 />Compile</Button><Button size="sm" variant="outline" disabled={running !== null} onClick={() => void execute("preflight")}><Activity />Preflight</Button><Button size="sm" disabled={running !== null} onClick={() => void execute("submit")}><Play />Run</Button></div>
        <CompilerSummary preview={preview} preflight={preflight} submission={stored.submission} />
      </aside>
    </div>}
  </div>
}

function Field(props: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1"><span className="block text-xs font-medium">{props.label}</span>{props.children}</label>
}

function NumberField(props: { label: string; value: number; step?: string; onValueChange: (value: number) => void }) {
  return <Field label={props.label}><Input type="number" min={0} step={props.step ?? "1"} value={props.value} onChange={(event) => props.onValueChange(Number(event.currentTarget.value))} /></Field>
}

function CompilerSummary({ preview, preflight, submission }: Pick<ComfygureCardState, "preview" | "preflight" | "submission">) {
  if (!preview && !preflight && !submission) return <div className="border-t pt-3 text-xs text-muted-foreground">Compile a fixed graph or inspect the local target. Preflight never submits a prompt.</div>
  const healthy = Boolean(preflight?.online && preflight.missingClasses.length === 0 && preflight.missingResources.length === 0)
  return <div className="space-y-2 border-t pt-3 text-xs"><div className="flex items-center gap-1 font-medium">{preflight ? healthy ? <CheckCircle2 className="size-3 text-chart-2" /> : <CircleAlert className="size-3 text-destructive" /> : <Settings2 className="size-3" />}<span>{submission ? "Submitted to ComfyUI" : preflight ? healthy ? "Ready to run" : "Preflight needs attention" : "Compiler preview"}</span></div>{preview ? <><p>{preview.graphNodeCount} fixed ComfyUI nodes</p><p className="break-words text-muted-foreground">{preview.activeLoraNames.length ? `LoRAs: ${preview.activeLoraNames.join(", ")}` : "No active LoRAs"}</p></> : null}{submission ? <p className="break-all text-muted-foreground">Prompt ID: {submission.promptId}</p> : null}{preflight ? <div className={cn("space-y-1", healthy ? "text-muted-foreground" : "text-destructive")}><p>{preflight.online ? `${preflight.availableClassCount} classes reported` : `Unavailable: ${preflight.endpoint}`}</p>{preflight.missingClasses.length ? <p>Missing nodes: {preflight.missingClasses.join(", ")}</p> : null}{preflight.missingResources.length ? <p>Missing resources: {preflight.missingResources.map((item) => item.resourceName).join(", ")}</p> : null}{preflight.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}</div>
}
