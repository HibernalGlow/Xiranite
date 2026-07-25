import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Activity, CheckCircle2, CircleAlert, Download, FileCode2, FileUp, Network, Play, RefreshCw, Save, Settings2, Sparkles } from "lucide-react"
import type { NodeComponentProps, NodeRunEvent } from "@xiranite/contract"
import {
  DEFAULT_COMFYUI_ENDPOINT,
  DEFAULT_COMFYGURE_PROGRAM,
  confirmComfygureTemplateBindings,
  compressComfygureText,
  decompressComfygureText,
  normalizeComfygureProgram,
  type ComfygureBatchEntry,
  type ComfygureCanvasExport,
  type ComfygureData,
  type ComfygureInput,
  type ComfygureProgram,
} from "@xiranite/node-comfygure/core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { createCapabilityAdapters, NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover"
import { useNodeSurface } from "@/nodes/shared/useNodeSurface"
import { TemplateComposer } from "./TemplateComposer"
import { LoraRuleEditor } from "./LoraRuleEditor"
import type { ComfygureCardState, ComfygureTargetConfig } from "./types"

type ComfygureT = ReturnType<typeof useNodeI18n>["t"]

interface ComfygureTargetEditorContextValue {
  target: ComfygureTargetConfig
  disabled: boolean
  t: ComfygureT
  updateTarget<Key extends keyof ComfygureTargetConfig>(key: Key, value: ComfygureTargetConfig[Key]): void
}

const ComfygureTargetEditorContext = createContext<ComfygureTargetEditorContextValue | null>(null)
const COMFYGURE_TARGET_PRESENTATION = { current: ComfygureTargetCurrentView }

export function Component({ compId, host }: NodeComponentProps) {
  "use no memo"

  const { t } = useNodeI18n("comfygure")
  const surface = useNodeSurface()
  const stored = host.getData<ComfygureCardState>(compId) ?? {}
  const stateRef = useRef(stored)
  stateRef.current = stored
  const [revision, setRevision] = useState(0)
  const [running, setRunning] = useState<"compile" | "import" | "profiles" | "saveProfile" | "loadProfile" | "canvas" | "options" | "preflight" | "submit" | "refresh" | null>(null)
  const [target, setTarget] = useState<ComfygureTargetConfig>({ endpoint: DEFAULT_COMFYUI_ENDPOINT, libraryPath: "" })
  const [targetDefaults, setTargetDefaults] = useState<ComfygureTargetConfig>()
  const [targetConfigPath, setTargetConfigPath] = useState<string>()
  const [targetTomlSource, setTargetTomlSource] = useState<string>()
  const targetDirtyRef = useRef<Set<keyof ComfygureTargetConfig>>(new Set())
  const [targetDirty, setTargetDirty] = useState(false)
  const program = programFromStored(stored)
  void revision

  const loadTarget = useCallback(async (preserveDirty = true) => {
    const getConfig = host.config?.get ?? host.getNodeConfig
    if (!getConfig) return
    const [response, exported] = await Promise.all([
      getConfig<ComfygureTargetConfig>(),
      host.config?.exportConfig?.("toml").catch(() => undefined),
    ])
    const persisted = normalizedTarget(response.config)
    setTargetDefaults(persisted)
    setTargetConfigPath(response.path)
    if (exported) setTargetTomlSource(exported.content)
    setTarget((current) => preserveDirty ? mergeTargetDraft(current, persisted, targetDirtyRef.current) : persisted)
    if (!preserveDirty) {
      targetDirtyRef.current.clear()
      setTargetDirty(false)
    }
  }, [host.config, host.getNodeConfig])

  useEffect(() => {
    void loadTarget().catch(() => undefined)
  }, [loadTarget])

  const targetConfigAdapters = useMemo(() => createCapabilityAdapters(host.config, () => loadTarget(false)), [host.config, loadTarget])

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
      templates: { ...current.templates, ...next.templates },
      batch: { ...current.batch, ...next.batch },
      parameters: { ...current.parameters, ...next.parameters },
      teaCache: { ...current.teaCache, ...next.teaCache },
      output: { ...current.output, ...next.output },
    }))
  }

  function storeProgram(next: ComfygureProgram) {
    patch(storedProgramPatch(next))
  }

  function updateTarget<Key extends keyof ComfygureTargetConfig>(key: Key, value: ComfygureTargetConfig[Key]) {
    targetDirtyRef.current.add(key)
    setTargetDirty(true)
    setTarget((current) => ({ ...current, [key]: value }))
  }

  async function saveTarget() {
    const saveConfig = host.config?.save ?? host.saveNodeConfig
    if (!saveConfig || targetDirtyRef.current.size === 0) return
    const next: ComfygureTargetConfig = {}
    if (targetDirtyRef.current.has("endpoint")) next.endpoint = target.endpoint?.trim() || DEFAULT_COMFYUI_ENDPOINT
    if (targetDirtyRef.current.has("libraryPath")) next.libraryPath = target.libraryPath?.trim() || undefined
    if (targetDirtyRef.current.has("profileLibraryPath")) next.profileLibraryPath = target.profileLibraryPath?.trim() || undefined
    if (targetDirtyRef.current.has("lastProfileId")) next.lastProfileId = target.lastProfileId || undefined
    try {
      await saveConfig(next)
      setTargetDefaults((current) => ({ ...current, ...next }))
      const exported = await host.config?.exportConfig?.("toml").catch(() => undefined)
      if (exported) setTargetTomlSource(exported.content)
      targetDirtyRef.current.clear()
      setTargetDirty(false)
      patch({ status: t("status.targetSaved", "Local ComfyUI target saved.") })
    } catch (error) {
      patch({ status: error instanceof Error ? t("status.targetSaveError", "Could not save the local target: {{message}}", { message: error.message }) : t("status.targetSaveFailed", "Could not save the local target.") })
    }
  }

  async function importBatchTextFiles() {
    const localFiles = host.localFiles
    if (!localFiles?.pickFiles) {
      patch({ status: t("status.promptFilesUnsupported", "This host cannot select local prompt text files.") })
      return
    }
    try {
      const paths = await localFiles.pickFiles({ title: t("filePicker.promptTitle", "Import Comfygure prompt text"), filters: [{ displayName: t("filePicker.textFiles", "Text files"), pattern: "*.txt" }] })
      if (!paths.length) return
      const files = await Promise.all(paths.map(async (path) => {
        const response = await fetch(localFiles.getUrl(path), { cache: "no-store" })
        if (!response.ok) throw new Error(t("status.readFileError", "Could not read {{path}}: HTTP {{status}}", { path, status: response.status }))
        return await response.text()
      }))
      const current = programFromStored(stateRef.current)
      const importedEntries = paths.flatMap((path, fileIndex) => batchPrompts(files[fileIndex] ?? "").map((text) => ({ text, sourceName: localFileName(path), sourcePath: path })))
      const entries = [...current.batch.entries, ...importedEntries]
      updateProgram({ batch: { ...current.batch, prompts: entries.map((entry) => entry.text), entries } })
      patch({ status: t("status.promptFilesImported", "Imported {{count}} prompt text file(s).", { count: paths.length }) })
    } catch (error) {
      patch({ status: error instanceof Error ? error.message : t("status.promptFilesImportFailed", "Could not import prompt text files.") })
    }
  }

  async function importWorkflowFile() {
    const localFiles = host.localFiles
    if (!localFiles?.pickFiles) {
      patch({ status: t("status.workflowFilesUnsupported", "This host cannot select local workflow files.") })
      return
    }
    try {
      const paths = await localFiles.pickFiles({ title: t("filePicker.workflowTitle", "Import ComfyUI workflow"), filters: [{ displayName: t("filePicker.workflow", "ComfyUI workflow"), pattern: "*.json" }] })
      const path = paths[0]
      if (!path) return
      const response = await fetch(localFiles.getUrl(path), { cache: "no-store" })
      if (!response.ok) throw new Error(t("status.readFileError", "Could not read {{path}}: HTTP {{status}}", { path, status: response.status }))
      await execute("import", await response.text())
    } catch (error) {
      patch({ status: error instanceof Error ? error.message : t("status.workflowImportFailed", "Could not import the ComfyUI workflow.") })
    }
  }

  function confirmTemplateBindings() {
    const template = stateRef.current.template
    if (!template || template.bindingManifest.confirmed) return
    patch({ template: confirmComfygureTemplateBindings(template), status: t("status.templateConfirmed", "Template bindings confirmed. The fixed controls now compile into this template.") })
  }

  async function loadProfile(profileId: string) {
    updateTarget("lastProfileId", profileId)
    await execute("loadProfile", undefined, profileId)
  }

  async function execute(action: "compile" | "import" | "profiles" | "saveProfile" | "loadProfile" | "canvas" | "options" | "preflight" | "submit" | "refresh", workflowSource?: string, selectedProfileId?: string) {
    const run = host.runner?.run ?? host.actions?.run
    if (!run || running) {
      if (!run) patch({ status: t("status.runnerUnavailable", "The Xiranite backend runner is unavailable.") })
      return
    }
    const promptIds = action === "refresh" ? storedPromptIds(stateRef.current) : []
    if (action === "refresh" && promptIds.length === 0) {
      patch({ status: t("status.refreshRequiresPrompt", "Run a ComfyUI prompt before refreshing results.") })
      return
    }
    setRunning(action)
    patch({ status: action === "import" ? t("status.running.import", "Normalizing the ComfyUI workflow.") : action === "profiles" ? t("status.running.profiles", "Reading local generation profiles.") : action === "saveProfile" ? t("status.running.saveProfile", "Saving the generation profile.") : action === "loadProfile" ? t("status.running.loadProfile", "Loading the generation profile.") : action === "compile" ? t("status.running.compile", "Compiling a fixed prompt graph.") : action === "canvas" ? t("status.running.canvas", "Exporting an inspectable ComfyUI canvas.") : action === "options" ? t("status.running.options", "Reading sampler options from the local ComfyUI target.") : action === "preflight" ? t("status.running.preflight", "Inspecting the local ComfyUI target.") : action === "refresh" ? t("status.running.refresh", "Refreshing ComfyUI results.") : t("status.running.submit", "Submitting a fixed prompt graph."), progress: 0 })
    try {
      const result = await run<ComfygureInput, ComfygureData>("comfygure", {
        action,
        program: programFromStored(stateRef.current),
        template: action === "import" ? undefined : stateRef.current.template,
        workflowSource,
        profileId: selectedProfileId ?? (action === "saveProfile" ? stateRef.current.profile?.id : undefined),
        profileName: action === "saveProfile" ? programFromStored(stateRef.current).name : undefined,
        target: { endpoint: target.endpoint, libraryPath: target.libraryPath, profileLibraryPath: target.profileLibraryPath },
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
            filenamePrefix: data.compiled.filenamePrefix,
          },
          status: result.message,
          progress: result.success ? 100 : stateRef.current.progress,
        }
        if (data.preflight) next.preflight = data.preflight
        if (data.controlOptions) next.controlOptions = data.controlOptions
        if (data.submission) next.submission = data.submission
        if (data.submissions) {
          next.submissions = data.submissions
          next.history = undefined
        }
        if (data.history) next.history = data.history
        if (data.profiles) next.profiles = data.profiles
        if (data.canvas) downloadCanvas(data.canvas, programFromStored(stateRef.current).name)
        if (data.profile) {
          next.profile = data.profile
          const current = programFromStored(stateRef.current)
          const profiled = normalizeComfygureProgram({
            ...current,
            ...data.profile.program,
            prompts: current.prompts,
            batch: current.batch,
          })
          Object.assign(next, storedProgramPatch(profiled))
          updateTarget("lastProfileId", data.profile.id)
        }
        if (data.workflowImport) {
          next.templateDiagnostics = data.workflowImport.diagnostics
          if (data.workflowImport.template) {
            next.template = data.workflowImport.template
            const current = programFromStored(stateRef.current)
            if (current.loras.length === 0 && data.workflowImport.template.defaultLoras.length) {
              const importedProgram = normalizeComfygureProgram({ ...current, loras: data.workflowImport.template.defaultLoras })
              Object.assign(next, storedProgramPatch(importedProgram))
            }
          }
        }
        patch(next)
      } else patch({ status: result?.message ?? t("status.noCompilerResult", "The backend did not return a compiler result.") })
    } finally {
      setRunning(null)
    }
  }

  const preflight = stored.preflight
  const controlOptions = stored.controlOptions
  const preview = stored.preview
  const promptIds = storedPromptIds(stored)
  const template = stored.template
  const templateReady = !template || template.bindingManifest.confirmed
  const isCollapsed = surface.mode === "collapsed"
  const wideWorkbench = surface.mode === "workspace" || surface.mode === "expanded"
  const targetEditor = useMemo<ComfygureTargetEditorContextValue>(() => ({ target, disabled: running !== null, t, updateTarget }), [running, t, target])
  return <ComfygureTargetEditorContext.Provider value={targetEditor}><div ref={surface.ref} className="@container/comfygure flex h-full min-h-0 w-full flex-col overflow-hidden p-3" data-testid="comfygure-workbench">
    <header className="flex min-w-0 items-center justify-between gap-2 border-b pb-2">
      <div className="flex min-w-0 items-center gap-2"><Sparkles className="size-4 shrink-0" /><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{t("title", "Comfygure")}</h2><p className="truncate text-xs text-muted-foreground">{stored.status ?? t("status.fixedCompiler", "Fixed ComfyUI compiler")}</p></div></div>
      <div className="flex shrink-0 items-center gap-1"><NodeConfigPopover autoRestoreKey="comfygure" configPath={targetConfigPath} defaults={targetDefaults as Record<string, unknown> | undefined} fallbackDefaults={{ endpoint: DEFAULT_COMFYUI_ENDPOINT }} tomlSource={targetTomlSource} dirty={targetDirty} triggerLabel={t("config.targetTrigger", "Comfygure configuration")} disabled={running !== null} t={t} onOpenFile={host.config?.openFile ?? host.openConfigFile} onOpenChange={(open) => { if (open) return loadTarget(true) }} onReload={() => loadTarget(false)} onRestore={() => loadTarget(false)} onSave={saveTarget} history={targetConfigAdapters.history} transfer={targetConfigAdapters.transfer} backup={targetConfigAdapters.backup} presentation={COMFYGURE_TARGET_PRESENTATION} /><Badge variant={preflight?.online ? "secondary" : "outline"}>{preflight?.online ? t("targetOnline", "Target online") : t("localTarget", "Local target")}</Badge>{running ? <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" /> : null}</div>
    </header>
    {isCollapsed ? <p className="mt-2 truncate text-xs text-muted-foreground">{preview ? t("collapsed.fixedNodes", "{{count}} fixed nodes", { count: preview.graphNodeCount }) : t("collapsed.expandHint", "Expand to edit and preflight.")}</p> : <div className="min-h-0 flex-1 pt-3" data-testid="comfygure-swimlane-workbench"><ResizablePanelGroup orientation={wideWorkbench ? "horizontal" : "vertical"} className="h-full min-h-0">
      <ResizablePanel id="comfygure-project" defaultSize={wideWorkbench ? "42%" : "45%"} minSize={wideWorkbench ? "30%" : "32%"} maxSize={wideWorkbench ? "56%" : "60%"}>
        <section className="flex h-full min-h-0 flex-col overflow-y-auto pr-2" aria-labelledby="comfygure-project-heading" data-testid="comfygure-project-lane">
          <LaneHeading icon={<Sparkles className="size-4" />} id="comfygure-project-heading" title={t("lanes.project.title", "Project compiler")} description={t("lanes.project.description", "Prompts, batch jobs, LoRAs, models, and sampler settings.")} />
          <div className="min-w-0 space-y-3 pt-3">
        <div className="grid gap-2 @xl/comfygure:grid-cols-2"><Field label={t("fields.program", "Program")}><Input value={program.name} onChange={(event) => updateProgram({ name: event.currentTarget.value })} /></Field><Field label={t("fields.outputPrefix", "Output prefix")}><Input value={program.output.filenamePrefix} onChange={(event) => updateProgram({ output: { ...program.output, filenamePrefix: event.currentTarget.value } })} /></Field></div>
        <Field label={t("fields.positivePrompt", "Positive prompt")}><Textarea className="min-h-24" value={program.prompts.positive} onChange={(event) => updateProgram({ prompts: { ...program.prompts, positive: event.currentTarget.value } })} /></Field>
        <div className="grid gap-2 @xl/comfygure:grid-cols-2"><Field label={t("fields.positivePrefix", "Positive prefix")}><Textarea className="min-h-18" value={program.prompts.positivePrefix} onChange={(event) => updateProgram({ prompts: { ...program.prompts, positivePrefix: event.currentTarget.value } })} /></Field><Field label={t("fields.negativePrompt", "Negative prompt")}><Textarea className="min-h-18" value={program.prompts.negative} onChange={(event) => updateProgram({ prompts: { ...program.prompts, negative: event.currentTarget.value } })} /></Field></div>
        <div className="grid gap-2 @xl/comfygure:grid-cols-2"><TemplateComposer label={t("fields.positiveTemplate", "Positive template")} t={t} scope="positive" value={program.templates.positive} onValueChange={(positive) => updateProgram({ templates: { ...program.templates, positive } })} /><TemplateComposer label={t("fields.negativeTemplate", "Negative template")} t={t} scope="negative" value={program.templates.negative} onValueChange={(negative) => updateProgram({ templates: { ...program.templates, negative } })} /></div>
        <TemplateComposer label={t("fields.filenameTemplate", "Filename template")} t={t} scope="filenamePrefix" value={program.templates.filenamePrefix} onValueChange={(filenamePrefix) => updateProgram({ templates: { ...program.templates, filenamePrefix } })} />
        <div className="min-w-0 space-y-1"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{t("fields.batchPrompts", "Batch positive prompts")}</span><Button size="sm" variant="ghost" disabled={running !== null || !host.localFiles?.pickFiles} onClick={() => void importBatchTextFiles()}><FileUp />{t("actions.importText", "Import text")}</Button></div><Textarea aria-label={t("fields.batchPrompts", "Batch positive prompts")} className="min-h-24" placeholder={t("fields.batchPlaceholder", "One fixed generation job per non-empty line")} value={program.batch.prompts.join("\n")} onChange={(event) => { const prompts = batchPrompts(event.currentTarget.value); updateProgram({ batch: { ...program.batch, prompts, entries: prompts.map((text) => ({ text })) } }) }} /></div>
        <div className="grid gap-2 @xl/comfygure:grid-cols-2"><NumberField label={t("fields.batchJobs", "Batch jobs (0 = all)")} value={program.batch.queueCount} onValueChange={(queueCount) => updateProgram({ batch: { ...program.batch, queueCount } })} /><NumberField label={t("fields.batchSelectionSeed", "Batch selection seed")} value={program.batch.selectionSeed} onValueChange={(selectionSeed) => updateProgram({ batch: { ...program.batch, selectionSeed } })} /><CheckField label={t("fields.shuffleBatch", "Shuffle batch jobs")} checked={program.batch.shuffle} onCheckedChange={(shuffle) => updateProgram({ batch: { ...program.batch, shuffle } })} /><CheckField label={t("fields.allowDuplicates", "Allow repeated batch prompts")} checked={program.batch.allowDuplicates} onCheckedChange={(allowDuplicates) => updateProgram({ batch: { ...program.batch, allowDuplicates } })} /></div>
        <LoraRuleEditor loras={program.loras} rules={program.rules} controlOptions={controlOptions} disabled={running !== null} t={t} onChange={(value) => updateProgram(value)} />
        <div className="grid gap-2 grid-cols-2 @2xl/comfygure:grid-cols-4"><NumberField label={t("fields.width", "Width")} value={program.parameters.width} onValueChange={(width) => updateProgram({ parameters: { ...program.parameters, width } })} /><NumberField label={t("fields.height", "Height")} value={program.parameters.height} onValueChange={(height) => updateProgram({ parameters: { ...program.parameters, height } })} /><NumberField label={t("fields.seed", "Seed")} value={program.parameters.seed} onValueChange={(seed) => updateProgram({ parameters: { ...program.parameters, seed } })} /><NumberField label={t("fields.batch", "Batch")} value={program.parameters.batchSize} onValueChange={(batchSize) => updateProgram({ parameters: { ...program.parameters, batchSize } })} /><NumberField label={t("fields.steps", "Steps")} value={program.parameters.steps} onValueChange={(steps) => updateProgram({ parameters: { ...program.parameters, steps } })} /><NumberField label={t("fields.cfg", "CFG")} value={program.parameters.cfg} step="0.1" onValueChange={(cfg) => updateProgram({ parameters: { ...program.parameters, cfg } })} /><NumberField label={t("fields.denoise", "Denoise")} value={program.parameters.denoise} step="0.01" onValueChange={(denoise) => updateProgram({ parameters: { ...program.parameters, denoise } })} /></div>
        <div className="flex min-w-0 items-end gap-2"><div className="grid min-w-0 flex-1 gap-2 @xl/comfygure:grid-cols-3"><OptionField label={t("fields.sampler", "Sampler")} value={program.parameters.samplerName} options={controlOptions?.samplerNames ?? []} onValueChange={(samplerName) => updateProgram({ parameters: { ...program.parameters, samplerName } })} /><OptionField label={t("fields.scheduler", "Scheduler")} value={program.parameters.scheduler} options={controlOptions?.schedulers ?? []} onValueChange={(scheduler) => updateProgram({ parameters: { ...program.parameters, scheduler } })} /><Field label={t("fields.seedPolicy", "Seed policy")}><Select value={program.parameters.seedMode} onValueChange={(seedMode) => updateProgram({ parameters: { ...program.parameters, seedMode: seedMode === "fixed" ? "fixed" : "increment" } })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="increment">{t("values.increment", "Increment per job")}</SelectItem><SelectItem value="fixed">{t("values.fixed", "Fixed")}</SelectItem></SelectContent></Select></Field></div><Button className="shrink-0" size="sm" variant="outline" disabled={running !== null} onClick={() => void execute("options")}><RefreshCw />{t("actions.loadOptions", "Load options")}</Button></div>
          <div className="space-y-2 border-t pt-3"><Field label={t("fields.unet", "UNet")}><Input value={program.model.unetName} onChange={(event) => updateProgram({ model: { ...program.model, unetName: event.currentTarget.value } })} /></Field><Field label={t("fields.clip", "CLIP")}><Input value={program.model.clipName} onChange={(event) => updateProgram({ model: { ...program.model, clipName: event.currentTarget.value } })} /></Field><Field label={t("fields.vae", "VAE")}><Input value={program.model.vaeName} onChange={(event) => updateProgram({ model: { ...program.model, vaeName: event.currentTarget.value } })} /></Field></div>
          </div>
        </section>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="comfygure-inspection" defaultSize={wideWorkbench ? "28%" : "28%"} minSize={wideWorkbench ? "21%" : "22%"} maxSize={wideWorkbench ? "38%" : "36%"}>
        <section className="flex h-full min-h-0 flex-col overflow-y-auto px-2" aria-labelledby="comfygure-inspection-heading" data-testid="comfygure-inspection-lane">
          <LaneHeading icon={<FileCode2 className="size-4" />} id="comfygure-inspection-heading" title={t("lanes.inspection.title", "Inspection")} description={t("lanes.inspection.description", "Template bindings, fixed graph preview, and canvas export.")} />
          <div className="min-w-0 space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={running !== null || !host.localFiles?.pickFiles} onClick={() => void importWorkflowFile()}><FileUp />{t("actions.importWorkflow", "Import workflow")}</Button>{template ? <Button size="sm" variant={templateReady ? "outline" : "default"} disabled={running !== null || templateReady} onClick={confirmTemplateBindings}><CheckCircle2 />{t("actions.confirmBindings", "Confirm bindings")}</Button> : null}</div>
            <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={running !== null || !templateReady} onClick={() => void execute("compile")}><FileCode2 />{t("actions.compile", "Compile")}</Button><Button size="sm" variant="outline" disabled={running !== null || !templateReady} onClick={() => void execute("canvas")}><Download />{t("actions.exportCanvas", "Export canvas")}</Button></div>
            <CompilerSummary t={t} preview={preview} preflight={preflight} submission={stored.submission} submissions={stored.submissions} history={stored.history} template={template} templateDiagnostics={stored.templateDiagnostics} />
          </div>
        </section>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="comfygure-execution" defaultSize={wideWorkbench ? "30%" : "27%"} minSize={wideWorkbench ? "23%" : "22%"} maxSize={wideWorkbench ? "42%" : "38%"}>
        <section className="flex h-full min-h-0 flex-col overflow-y-auto pl-2" aria-labelledby="comfygure-execution-heading" data-testid="comfygure-execution-lane">
          <LaneHeading icon={<Network className="size-4" />} id="comfygure-execution-heading" title={t("lanes.execution.title", "Execution")} description={t("lanes.execution.description", "Local target, generation profiles, preflight, and result refresh.")} />
          <div className="min-w-0 space-y-3 pt-3">
        <TargetSummary target={target} t={t} dirty={targetDirty} online={preflight?.online === true} />
        <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={running !== null} onClick={() => void execute("profiles")}><RefreshCw />{t("actions.profiles", "Profiles")}</Button><Button size="sm" variant="outline" disabled={running !== null} onClick={() => void execute("saveProfile")}><Save />{t("actions.saveProfile", "Save profile")}</Button></div>
        {(stored.profiles?.length || stored.profile) ? <Field label={t("fields.generationProfile", "Generation profile")}><Select value={stored.profile?.id ?? "__current"} disabled={running !== null} onValueChange={(value) => { if (value !== "__current") void loadProfile(value) }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__current">{t("values.currentSnapshot", "Current project snapshot")}</SelectItem>{stored.profiles?.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name} · r{profile.revision}</SelectItem>)}</SelectContent></Select></Field> : null}
            <div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" disabled={running !== null || !templateReady} onClick={() => void execute("preflight")}><Activity />{t("actions.preflight", "Preflight")}</Button><Button size="sm" variant="outline" disabled={running !== null || promptIds.length === 0} onClick={() => void execute("refresh")}><RefreshCw />{t("actions.refreshResults", "Refresh results")}</Button><Button className="col-span-2" size="sm" disabled={running !== null || !templateReady} onClick={() => void execute("submit")}><Play />{t("actions.run", "Run")}</Button></div>
          </div>
        </section>
      </ResizablePanel>
    </ResizablePanelGroup></div>}
  </div></ComfygureTargetEditorContext.Provider>
}

function LaneHeading(props: { icon: ReactNode; id: string; title: string; description: string }) {
  return <div className="border-b pb-2"><div className="flex items-center gap-2"><span className="text-muted-foreground">{props.icon}</span><h3 id={props.id} className="text-sm font-semibold">{props.title}</h3></div><p className="mt-1 text-xs text-muted-foreground">{props.description}</p></div>
}

function ComfygureTargetCurrentView() {
  const editor = useContext(ComfygureTargetEditorContext)
  if (!editor) return null
  return <div className="grid gap-3" data-testid="comfygure-target-editor">
    <Field label={editor.t("fields.endpoint", "Endpoint")}><Input value={editor.target.endpoint ?? DEFAULT_COMFYUI_ENDPOINT} disabled={editor.disabled} onChange={(event) => editor.updateTarget("endpoint", event.currentTarget.value)} /></Field>
    <Field label={editor.t("fields.library", "ComfyUI Library")}><Input value={editor.target.libraryPath ?? ""} disabled={editor.disabled} placeholder={editor.t("fields.libraryPlaceholder", "D:/1Repo/Github/ComfyUI/Library")} onChange={(event) => editor.updateTarget("libraryPath", event.currentTarget.value)} /></Field>
    <Field label={editor.t("fields.profileLibrary", "Profile library")}><Input value={editor.target.profileLibraryPath ?? ""} disabled={editor.disabled} placeholder={editor.t("fields.profileLibraryPlaceholder", "Default Xiranite data directory")} onChange={(event) => editor.updateTarget("profileLibraryPath", event.currentTarget.value)} /></Field>
  </div>
}

function TargetSummary({ target, t, dirty, online }: { target: ComfygureTargetConfig; t: ComfygureT; dirty: boolean; online: boolean }) {
  return <div className="min-w-0 space-y-2 border bg-muted/20 p-3" data-testid="comfygure-target-summary">
    <div className="flex min-w-0 items-center justify-between gap-2"><span className="truncate text-xs font-medium" title={target.endpoint}>{target.endpoint || DEFAULT_COMFYUI_ENDPOINT}</span><Badge variant={online ? "secondary" : dirty ? "outline" : "secondary"}>{dirty ? t("config.unsaved", "Unsaved") : online ? t("targetOnline", "Online") : t("localTarget", "Local")}</Badge></div>
    <p className="truncate font-mono text-[10px] text-muted-foreground" title={target.libraryPath}>{target.libraryPath || t("config.libraryUnset", "ComfyUI library not set")}</p>
  </div>
}

function normalizedTarget(config: ComfygureTargetConfig | undefined): ComfygureTargetConfig {
  return {
    endpoint: config?.endpoint?.trim() || DEFAULT_COMFYUI_ENDPOINT,
    libraryPath: config?.libraryPath?.trim() ?? "",
    profileLibraryPath: config?.profileLibraryPath?.trim() ?? "",
    lastProfileId: config?.lastProfileId,
  }
}

function mergeTargetDraft(current: ComfygureTargetConfig, persisted: ComfygureTargetConfig, dirty: ReadonlySet<keyof ComfygureTargetConfig>): ComfygureTargetConfig {
  return {
    endpoint: dirty.has("endpoint") ? current.endpoint : persisted.endpoint,
    libraryPath: dirty.has("libraryPath") ? current.libraryPath : persisted.libraryPath,
    profileLibraryPath: dirty.has("profileLibraryPath") ? current.profileLibraryPath : persisted.profileLibraryPath,
    lastProfileId: dirty.has("lastProfileId") ? current.lastProfileId : persisted.lastProfileId,
  }
}

function downloadCanvas(canvas: ComfygureCanvasExport, programName: string) {
  const fileName = `${programName.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/^-+|-+$/g, "") || "comfygure"}.workflow.json`
  const blob = new Blob([JSON.stringify(canvas, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function Field(props: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1"><span className="block text-xs font-medium">{props.label}</span>{props.children}</label>
}

function OptionField(props: { label: string; value: string; options: readonly string[]; onValueChange: (value: string) => void }) {
  if (props.options.length === 0) return <Field label={props.label}><Input value={props.value} onChange={(event) => props.onValueChange(event.currentTarget.value)} /></Field>
  const options = props.options.includes(props.value) ? props.options : [props.value, ...props.options]
  return <Field label={props.label}><Select value={props.value} onValueChange={props.onValueChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field>
}

function NumberField(props: { label: string; value: number; step?: string; onValueChange: (value: number) => void }) {
  return <Field label={props.label}><Input type="number" min={0} step={props.step ?? "1"} value={props.value} onChange={(event) => props.onValueChange(Number(event.currentTarget.value))} /></Field>
}

function CheckField(props: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <label className="flex min-h-9 items-center gap-2 border px-2 text-xs font-medium"><Checkbox checked={props.checked} onCheckedChange={(checked) => props.onCheckedChange(checked === true)} /><span>{props.label}</span></label>
}

function CompilerSummary({ t, preview, preflight, submission, submissions, history, template, templateDiagnostics }: Pick<ComfygureCardState, "preview" | "preflight" | "submission" | "submissions" | "history" | "template" | "templateDiagnostics"> & { t: ReturnType<typeof useNodeI18n>["t"] }) {
  if (!preview && !preflight && !submission && !history?.length && !template) return <div className="border-t pt-3 text-xs text-muted-foreground">{t("summary.empty", "Compile a fixed graph or inspect the local target. Preflight never submits a prompt.")}</div>
  const healthy = Boolean(preflight?.online && preflight.missingClasses.length === 0 && preflight.missingResources.length === 0)
  const complete = history?.filter((item) => item.state === "complete").length ?? 0
  const failed = history?.filter((item) => item.state === "error").length ?? 0
  const images = history?.flatMap((item) => item.images) ?? []
  const templateErrors = templateDiagnostics?.filter((diagnostic) => diagnostic.severity === "error") ?? []
  if (template) return <div className={cn("space-y-1 border-t pt-3 text-xs", templateErrors.length ? "text-destructive" : "text-muted-foreground")}><div className="flex items-center gap-1 font-medium">{templateErrors.length ? <CircleAlert className="size-3" /> : <CheckCircle2 className="size-3 text-chart-2" />}<span>{templateErrors.length ? t("summary.templateAttention", "Template needs attention") : template.bindingManifest.confirmed ? t("summary.templateConfirmed", "Template bindings confirmed") : t("summary.templateNeedsConfirmation", "Template bindings need confirmation")}</span></div><p>{t("summary.importedNodes", "{{name}}: {{count}} imported nodes", { name: template.name, count: Object.keys(template.graph).length })}</p><p>{t("summary.inferredBindings", "{{count}} inferred bindings", { count: template.bindingManifest.bindings.length })}</p>{templateErrors.slice(0, 4).map((diagnostic) => <p key={`${diagnostic.code}-${diagnostic.nodeId ?? ""}-${diagnostic.inputName ?? ""}`}>{diagnostic.nodeId ? `${diagnostic.nodeId}: ` : ""}{diagnostic.message}</p>)}</div>
  return <div className="space-y-2 border-t pt-3 text-xs"><div className="flex items-center gap-1 font-medium">{failed ? <CircleAlert className="size-3 text-destructive" /> : preflight ? healthy ? <CheckCircle2 className="size-3 text-chart-2" /> : <CircleAlert className="size-3 text-destructive" /> : <Settings2 className="size-3" />}<span>{history?.length ? failed ? t("summary.resultsAttention", "ComfyUI results need attention") : t("summary.resultsRefreshed", "ComfyUI results refreshed") : submission ? t("summary.submitted", "Submitted to ComfyUI") : preflight ? healthy ? t("summary.ready", "Ready to run") : t("summary.preflightAttention", "Preflight needs attention") : t("summary.compilerPreview", "Compiler preview")}</span></div>{preview ? <><p>{t("summary.fixedNodes", "{{count}} fixed ComfyUI nodes", { count: preview.graphNodeCount })}{preview.generationJobCount > 1 ? t("summary.jobs", " per job · {{count}} jobs", { count: preview.generationJobCount }) : ""}</p><p className="break-words text-muted-foreground">{preview.activeLoraNames.length ? t("summary.loras", "LoRAs: {{names}}", { names: preview.activeLoraNames.join(", ") }) : t("summary.noLoras", "No active LoRAs")}</p><p className="break-all text-muted-foreground">{t("summary.filenamePrefix", "Output: {{prefix}}", { prefix: preview.filenamePrefix })}</p></> : null}{submission ? <p className="break-all text-muted-foreground">{submissions && submissions.length > 1 ? t("summary.promptIds", "Prompt IDs ({{count}}): {{ids}}", { count: submissions.length, ids: submissions.map((item) => item.promptId).join(", ") }) : t("summary.promptId", "Prompt ID: {{id}}", { id: submission.promptId })}</p> : null}{history?.length ? <div className={cn("space-y-2", failed ? "text-destructive" : "text-muted-foreground")}><p>{t("summary.completed", "{{complete}} of {{total}} complete · {{images}} image(s)", { complete, total: history.length, images: images.length })}</p>{history.filter((item) => item.error).map((item) => <p key={item.promptId}>{item.promptId}: {item.error}</p>)}{images.length ? <div className="grid grid-cols-3 gap-1">{images.map((image, index) => <a key={`${image.url}-${index}`} href={image.url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden border"><img src={image.url} alt={t("summary.resultAlt", "ComfyUI result {{index}}", { index: index + 1 })} className="size-full object-cover" loading="lazy" /></a>)}</div> : null}</div> : null}{preflight ? <div className={cn("space-y-1", healthy ? "text-muted-foreground" : "text-destructive")}><p>{preflight.online ? t("summary.classesReported", "{{count}} classes reported", { count: preflight.availableClassCount }) : t("summary.unavailable", "Unavailable: {{endpoint}}", { endpoint: preflight.endpoint })}</p>{preflight.missingClasses.length ? <p>{t("summary.missingNodes", "Missing nodes: {{nodes}}", { nodes: preflight.missingClasses.join(", ") })}</p> : null}{preflight.missingResources.length ? <p>{t("summary.missingResources", "Missing resources: {{resources}}", { resources: preflight.missingResources.map((item) => item.resourceName).join(", ") })}</p> : null}{preflight.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}</div>
}

function batchPrompts(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

function storedProgramPatch(program: ComfygureProgram): Pick<ComfygureCardState, "program" | "batchText" | "batchEntryMetadata"> {
  const entries = program.batch.entries.length ? program.batch.entries : program.batch.prompts.map((text) => ({ text }))
  const metadata = entries.map(({ sourceName, sourcePath }) => ({ ...(sourceName ? { sourceName } : {}), ...(sourcePath ? { sourcePath } : {}) }))
  const hasMetadata = metadata.some((entry) => entry.sourceName || entry.sourcePath)
  return {
    program: { ...program, batch: { ...program.batch, prompts: [], entries: [] } },
    batchText: compressComfygureText(entries.map((entry) => entry.text).join("\n")),
    batchEntryMetadata: hasMetadata ? compressComfygureText(JSON.stringify(metadata)) : undefined,
  }
}

function programFromStored(state: ComfygureCardState): ComfygureProgram {
  const stored = normalizeComfygureProgram(state.program ?? DEFAULT_COMFYGURE_PROGRAM)
  const storedEntries = stored.batch.entries.length ? stored.batch.entries : stored.batch.prompts.map((text) => ({ text }))
  const source = decompressComfygureText(state.batchText) || storedEntries.map((entry) => entry.text).join("\n")
  const prompts = batchPrompts(source)
  const metadata = batchEntryMetadata(state.batchEntryMetadata)
  const entries: ComfygureBatchEntry[] = prompts.map((text, index) => ({ text, ...(metadata[index] ?? storedEntries[index] ?? {}) }))
  return normalizeComfygureProgram({ ...stored, batch: { ...stored.batch, prompts, entries } })
}

function batchEntryMetadata(value: ComfygureCardState["batchEntryMetadata"]): Array<Pick<ComfygureBatchEntry, "sourceName" | "sourcePath">> {
  const source = decompressComfygureText(value)
  if (!source) return []
  try {
    const parsed = JSON.parse(source)
    if (!Array.isArray(parsed)) return []
    return parsed.map((entry) => ({
      ...(entry && typeof entry.sourceName === "string" && entry.sourceName.trim() ? { sourceName: entry.sourceName.trim() } : {}),
      ...(entry && typeof entry.sourcePath === "string" && entry.sourcePath.trim() ? { sourcePath: entry.sourcePath.trim() } : {}),
    }))
  } catch {
    return []
  }
}

function localFileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path
}

function storedPromptIds(state: ComfygureCardState): readonly string[] {
  const submissions = state.submissions?.length ? state.submissions : state.submission ? [state.submission] : []
  return [...new Set(submissions.map((submission) => submission.promptId).filter(Boolean))]
}
