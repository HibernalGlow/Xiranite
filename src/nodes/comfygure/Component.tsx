import { useEffect, useRef, useState, type ReactNode } from "react"
import { Activity, CheckCircle2, CircleAlert, FileCode2, FileUp, Network, Play, RefreshCw, Save, Settings2, Sparkles } from "lucide-react"
import type { NodeComponentProps, NodeRunEvent } from "@xiranite/contract"
import {
  DEFAULT_COMFYUI_ENDPOINT,
  DEFAULT_COMFYGURE_PROGRAM,
  compressComfygureText,
  decompressComfygureText,
  normalizeComfygureProgram,
  type ComfygureData,
  type ComfygureInput,
  type ComfygureProgram,
} from "@xiranite/node-comfygure/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  const [running, setRunning] = useState<"compile" | "preflight" | "submit" | "refresh" | null>(null)
  const [target, setTarget] = useState<ComfygureTargetConfig>({ endpoint: DEFAULT_COMFYUI_ENDPOINT, libraryPath: "" })
  const targetDirtyRef = useRef<Set<keyof ComfygureTargetConfig>>(new Set())
  const [targetDirty, setTargetDirty] = useState(false)
  const program = programFromStored(stored)
  void revision

  useEffect(() => {
    if (!host.getNodeConfig) return
    let active = true
    void host.getNodeConfig<ComfygureTargetConfig>().then((response) => {
      if (!active || !response?.config) return
      setTarget((current) => ({
        endpoint: targetDirtyRef.current.has("endpoint") ? current.endpoint : response.config.endpoint || DEFAULT_COMFYUI_ENDPOINT,
        libraryPath: targetDirtyRef.current.has("libraryPath") ? current.libraryPath : response.config.libraryPath ?? "",
      }))
    }).catch(() => undefined)
    return () => { active = false }
  }, [host])

  function patch(next: Partial<ComfygureCardState>) {
    stateRef.current = { ...stateRef.current, ...next }
    host.patchData(compId, next)
    setRevision((value) => value + 1)
  }

  function updateProgram(next: Partial<ComfygureProgram>) {
    const current = programFromStored(stateRef.current)
    storeProgram(normalizeComfygureProgram({
      ...current,
      ...next,
      model: { ...current.model, ...next.model },
      prompts: { ...current.prompts, ...next.prompts },
      batch: { ...current.batch, ...next.batch },
      parameters: { ...current.parameters, ...next.parameters },
      teaCache: { ...current.teaCache, ...next.teaCache },
      output: { ...current.output, ...next.output },
    }))
  }

  function storeProgram(next: ComfygureProgram) {
    const batchSource = next.batch.prompts.join("\n")
    patch({ program: { ...next, batch: { ...next.batch, prompts: [] } }, batchText: compressComfygureText(batchSource) })
  }

  function updateTarget<Key extends keyof ComfygureTargetConfig>(key: Key, value: ComfygureTargetConfig[Key]) {
    targetDirtyRef.current.add(key)
    setTargetDirty(true)
    setTarget((current) => ({ ...current, [key]: value }))
  }

  async function saveTarget() {
    if (!host.saveNodeConfig || targetDirtyRef.current.size === 0) return
    const next: ComfygureTargetConfig = {}
    if (targetDirtyRef.current.has("endpoint")) next.endpoint = target.endpoint?.trim() || DEFAULT_COMFYUI_ENDPOINT
    if (targetDirtyRef.current.has("libraryPath")) next.libraryPath = target.libraryPath?.trim() || undefined
    try {
      await host.saveNodeConfig(next)
      targetDirtyRef.current.clear()
      setTargetDirty(false)
      patch({ status: "Local ComfyUI target saved." })
    } catch (error) {
      patch({ status: error instanceof Error ? `Could not save the local target: ${error.message}` : "Could not save the local target." })
    }
  }

  async function importBatchTextFiles() {
    const localFiles = host.localFiles
    if (!localFiles?.pickFiles) {
      patch({ status: "This host cannot select local prompt text files." })
      return
    }
    try {
      const paths = await localFiles.pickFiles({ title: "Import Comfygure prompt text", filters: [{ displayName: "Text files", pattern: "*.txt" }] })
      if (!paths.length) return
      const files = await Promise.all(paths.map(async (path) => {
        const response = await fetch(localFiles.getUrl(path), { cache: "no-store" })
        if (!response.ok) throw new Error(`Could not read ${path}: HTTP ${response.status}`)
        return await response.text()
      }))
      const current = programFromStored(stateRef.current)
      updateProgram({ batch: { ...current.batch, prompts: [...current.batch.prompts, ...batchPrompts(files.join("\n"))] } })
      patch({ status: `Imported ${paths.length} prompt text file(s).` })
    } catch (error) {
      patch({ status: error instanceof Error ? error.message : "Could not import prompt text files." })
    }
  }

  async function execute(action: "compile" | "preflight" | "submit" | "refresh") {
    const run = host.runner?.run ?? host.actions?.run
    if (!run || running) {
      if (!run) patch({ status: "The Xiranite backend runner is unavailable." })
      return
    }
    const promptIds = action === "refresh" ? storedPromptIds(stateRef.current) : []
    if (action === "refresh" && promptIds.length === 0) {
      patch({ status: "Run a ComfyUI prompt before refreshing results." })
      return
    }
    setRunning(action)
    patch({ status: action === "compile" ? "Compiling a fixed prompt graph." : action === "preflight" ? "Inspecting the local ComfyUI target." : action === "refresh" ? "Refreshing ComfyUI results." : "Submitting a fixed prompt graph.", progress: 0 })
    try {
      const result = await run<ComfygureInput, ComfygureData>("comfygure", {
        action,
        program: programFromStored(stateRef.current),
        target: { endpoint: target.endpoint, libraryPath: target.libraryPath },
        promptIds: promptIds.length ? promptIds : undefined,
      }, (event: NodeRunEvent) => {
        if (event.type === "progress") patch({ status: event.message, progress: event.progress })
      })
      const data = result?.data
      if (data?.compiled) {
        const next: Partial<ComfygureCardState> = {
          preview: {
            graphNodeCount: Object.keys(data.compiled.graph).length,
            generationJobCount: data.runPlan.jobs.length,
            activeLoraNames: data.compiled.activeLoras.map((lora) => lora.name),
            positivePrompt: data.compiled.positivePrompt,
            negativePrompt: data.compiled.negativePrompt,
          },
          status: result.message,
          progress: result.success ? 100 : stateRef.current.progress,
        }
        if (data.preflight) next.preflight = data.preflight
        if (data.submission) next.submission = data.submission
        if (data.submissions) {
          next.submissions = data.submissions
          next.history = undefined
        }
        if (data.history) next.history = data.history
        patch(next)
      } else patch({ status: result?.message ?? "The backend did not return a compiler result." })
    } finally {
      setRunning(null)
    }
  }

  const preflight = stored.preflight
  const preview = stored.preview
  const promptIds = storedPromptIds(stored)
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
        <div className="min-w-0 space-y-1"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">Batch positive prompts</span><Button size="sm" variant="ghost" disabled={running !== null || !host.localFiles?.pickFiles} onClick={() => void importBatchTextFiles()}><FileUp />Import text</Button></div><Textarea aria-label="Batch positive prompts" className="min-h-24" placeholder="One fixed generation job per non-empty line" value={program.batch.prompts.join("\n")} onChange={(event) => updateProgram({ batch: { ...program.batch, prompts: batchPrompts(event.currentTarget.value) } })} /></div>
        <div className="grid gap-2 @xl/comfygure:grid-cols-2"><NumberField label="Batch jobs (0 = all)" value={program.batch.queueCount} onValueChange={(queueCount) => updateProgram({ batch: { ...program.batch, queueCount } })} /><NumberField label="Batch selection seed" value={program.batch.selectionSeed} onValueChange={(selectionSeed) => updateProgram({ batch: { ...program.batch, selectionSeed } })} /><CheckField label="Shuffle batch jobs" checked={program.batch.shuffle} onCheckedChange={(shuffle) => updateProgram({ batch: { ...program.batch, shuffle } })} /><CheckField label="Allow repeated batch prompts" checked={program.batch.allowDuplicates} onCheckedChange={(allowDuplicates) => updateProgram({ batch: { ...program.batch, allowDuplicates } })} /></div>
        <Field label="LoRA rows"><Textarea className="min-h-24 font-mono text-xs" value={formatLoraRows(program.loras)} placeholder="folder/style.safetensors | 1 | 1 | activation terms | injected terms" onChange={(event) => updateProgram({ loras: parseLoraRows(event.currentTarget.value) })} /></Field>
        <div className="grid gap-2 grid-cols-2 @2xl/comfygure:grid-cols-4"><NumberField label="Width" value={program.parameters.width} onValueChange={(width) => updateProgram({ parameters: { ...program.parameters, width } })} /><NumberField label="Height" value={program.parameters.height} onValueChange={(height) => updateProgram({ parameters: { ...program.parameters, height } })} /><NumberField label="Seed" value={program.parameters.seed} onValueChange={(seed) => updateProgram({ parameters: { ...program.parameters, seed } })} /><NumberField label="Batch" value={program.parameters.batchSize} onValueChange={(batchSize) => updateProgram({ parameters: { ...program.parameters, batchSize } })} /><NumberField label="Steps" value={program.parameters.steps} onValueChange={(steps) => updateProgram({ parameters: { ...program.parameters, steps } })} /><NumberField label="CFG" value={program.parameters.cfg} step="0.1" onValueChange={(cfg) => updateProgram({ parameters: { ...program.parameters, cfg } })} /><NumberField label="Denoise" value={program.parameters.denoise} step="0.01" onValueChange={(denoise) => updateProgram({ parameters: { ...program.parameters, denoise } })} /></div>
        <div className="grid gap-2 @xl/comfygure:grid-cols-3"><Field label="Sampler"><Input value={program.parameters.samplerName} onChange={(event) => updateProgram({ parameters: { ...program.parameters, samplerName: event.currentTarget.value } })} /></Field><Field label="Scheduler"><Input value={program.parameters.scheduler} onChange={(event) => updateProgram({ parameters: { ...program.parameters, scheduler: event.currentTarget.value } })} /></Field><Field label="Seed policy"><Select value={program.parameters.seedMode} onValueChange={(seedMode) => updateProgram({ parameters: { ...program.parameters, seedMode: seedMode === "fixed" ? "fixed" : "increment" } })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="increment">Increment per job</SelectItem><SelectItem value="fixed">Fixed</SelectItem></SelectContent></Select></Field></div>
      </section>
      <aside className="min-w-0 space-y-3 border-t pt-3 @4xl/comfygure:border-l @4xl/comfygure:border-t-0 @4xl/comfygure:pl-3 @4xl/comfygure:pt-0">
        <div className="flex items-center gap-2"><Network className="size-4" /><h3 className="text-sm font-semibold">Local target</h3></div>
        <Field label="Endpoint"><Input value={target.endpoint ?? DEFAULT_COMFYUI_ENDPOINT} disabled={running !== null} onChange={(event) => updateTarget("endpoint", event.currentTarget.value)} /></Field>
        <Field label="ComfyUI Library"><Input value={target.libraryPath ?? ""} disabled={running !== null} placeholder="D:/1Repo/Github/ComfyUI/Library" onChange={(event) => updateTarget("libraryPath", event.currentTarget.value)} /></Field>
        <Button className="w-full" size="sm" variant="outline" disabled={running !== null || !targetDirty} onClick={() => void saveTarget()}><Save />Save target</Button>
        <div className="space-y-2 border-t pt-3"><Field label="UNet"><Input value={program.model.unetName} onChange={(event) => updateProgram({ model: { ...program.model, unetName: event.currentTarget.value } })} /></Field><Field label="CLIP"><Input value={program.model.clipName} onChange={(event) => updateProgram({ model: { ...program.model, clipName: event.currentTarget.value } })} /></Field><Field label="VAE"><Input value={program.model.vaeName} onChange={(event) => updateProgram({ model: { ...program.model, vaeName: event.currentTarget.value } })} /></Field></div>
        <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={running !== null} onClick={() => void execute("compile")}><FileCode2 />Compile</Button><Button size="sm" variant="outline" disabled={running !== null} onClick={() => void execute("preflight")}><Activity />Preflight</Button><Button size="sm" variant="outline" disabled={running !== null || promptIds.length === 0} onClick={() => void execute("refresh")}><RefreshCw />Refresh results</Button><Button size="sm" disabled={running !== null} onClick={() => void execute("submit")}><Play />Run</Button></div>
        <CompilerSummary preview={preview} preflight={preflight} submission={stored.submission} submissions={stored.submissions} history={stored.history} />
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

function CheckField(props: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <label className="flex min-h-9 items-center gap-2 border px-2 text-xs font-medium"><Checkbox checked={props.checked} onCheckedChange={(checked) => props.onCheckedChange(checked === true)} /><span>{props.label}</span></label>
}

function CompilerSummary({ preview, preflight, submission, submissions, history }: Pick<ComfygureCardState, "preview" | "preflight" | "submission" | "submissions" | "history">) {
  if (!preview && !preflight && !submission && !history?.length) return <div className="border-t pt-3 text-xs text-muted-foreground">Compile a fixed graph or inspect the local target. Preflight never submits a prompt.</div>
  const healthy = Boolean(preflight?.online && preflight.missingClasses.length === 0 && preflight.missingResources.length === 0)
  const complete = history?.filter((item) => item.state === "complete").length ?? 0
  const failed = history?.filter((item) => item.state === "error").length ?? 0
  const images = history?.flatMap((item) => item.images) ?? []
  return <div className="space-y-2 border-t pt-3 text-xs"><div className="flex items-center gap-1 font-medium">{failed ? <CircleAlert className="size-3 text-destructive" /> : preflight ? healthy ? <CheckCircle2 className="size-3 text-chart-2" /> : <CircleAlert className="size-3 text-destructive" /> : <Settings2 className="size-3" />}<span>{history?.length ? failed ? "ComfyUI results need attention" : "ComfyUI results refreshed" : submission ? "Submitted to ComfyUI" : preflight ? healthy ? "Ready to run" : "Preflight needs attention" : "Compiler preview"}</span></div>{preview ? <><p>{preview.graphNodeCount} fixed ComfyUI nodes{preview.generationJobCount > 1 ? ` per job · ${preview.generationJobCount} jobs` : ""}</p><p className="break-words text-muted-foreground">{preview.activeLoraNames.length ? `LoRAs: ${preview.activeLoraNames.join(", ")}` : "No active LoRAs"}</p></> : null}{submission ? <p className="break-all text-muted-foreground">{submissions && submissions.length > 1 ? `Prompt IDs (${submissions.length}): ${submissions.map((item) => item.promptId).join(", ")}` : `Prompt ID: ${submission.promptId}`}</p> : null}{history?.length ? <div className={cn("space-y-2", failed ? "text-destructive" : "text-muted-foreground")}><p>{complete} of {history.length} complete · {images.length} image(s)</p>{history.filter((item) => item.error).map((item) => <p key={item.promptId}>{item.promptId}: {item.error}</p>)}{images.length ? <div className="grid grid-cols-3 gap-1">{images.map((image, index) => <a key={`${image.url}-${index}`} href={image.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden border"><img src={image.url} alt={`ComfyUI result ${index + 1}`} className="size-full object-cover" loading="lazy" /></a>)}</div> : null}</div> : null}{preflight ? <div className={cn("space-y-1", healthy ? "text-muted-foreground" : "text-destructive")}><p>{preflight.online ? `${preflight.availableClassCount} classes reported` : `Unavailable: ${preflight.endpoint}`}</p>{preflight.missingClasses.length ? <p>Missing nodes: {preflight.missingClasses.join(", ")}</p> : null}{preflight.missingResources.length ? <p>Missing resources: {preflight.missingResources.map((item) => item.resourceName).join(", ")}</p> : null}{preflight.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}</div>
}

function batchPrompts(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function programFromStored(state: ComfygureCardState): ComfygureProgram {
  const stored = normalizeComfygureProgram(state.program ?? DEFAULT_COMFYGURE_PROGRAM)
  const source = decompressComfygureText(state.batchText) || stored.batch.prompts.join("\n")
  return normalizeComfygureProgram({ ...stored, batch: { ...stored.batch, prompts: batchPrompts(source) } })
}

function storedPromptIds(state: ComfygureCardState): readonly string[] {
  const submissions = state.submissions?.length ? state.submissions : state.submission ? [state.submission] : []
  return [...new Set(submissions.map((submission) => submission.promptId).filter(Boolean))]
}
