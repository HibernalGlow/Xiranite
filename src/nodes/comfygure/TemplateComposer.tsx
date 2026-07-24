import { Fragment, useEffect, useRef, useState } from "react"
import { Braces, GripVertical, Plus, TextCursorInput, X } from "lucide-react"
import {
  COMFYGURE_TEMPLATE_VARIABLES,
  parseComfygureVisualTemplate,
  serializeComfygureVisualTemplate,
  type ComfygureTemplatePart,
} from "@xiranite/node-comfygure/core"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Sortable, SortableContent, SortableItem, SortableItemHandle, SortableOverlay } from "@/components/ui/sortable"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"

type TemplateScope = "positive" | "negative" | "filenamePrefix"
type NodeTranslator = ReturnType<typeof useNodeI18n>["t"]
type SortableTemplateVariable = { id: string; expression: string }
type TemplateVisualState = { variables: SortableTemplateVariable[]; literals: string[] }

export function TemplateComposer(props: { label: string; t: NodeTranslator; scope: TemplateScope; value: string; onValueChange(value: string): void }) {
  const [mode, setMode] = useState<"visual" | "source">("visual")
  const visual = parseComfygureVisualTemplate(props.value)
  const availableVariables = COMFYGURE_TEMPLATE_VARIABLES.filter((variable) => variable.scopes.includes(props.scope))
  const sourceRef = useRef(props.value)
  const [state, setState] = useState<TemplateVisualState>(() => templateVisualState(visual.parts))

  useEffect(() => {
    if (!visual.supported) setMode("source")
  }, [visual.supported])

  useEffect(() => {
    if (props.value === sourceRef.current) return
    sourceRef.current = props.value
    setState(templateVisualState(parseComfygureVisualTemplate(props.value).parts))
  }, [props.value])

  function commit(next: TemplateVisualState) {
    const source = serializeComfygureVisualTemplate(templateParts(next))
    sourceRef.current = source
    setState(next)
    props.onValueChange(source)
  }

  function addVariable(path: string, type: "string" | "number" | "string[]") {
    const separator = state.variables.length ? props.scope === "filenamePrefix" ? "-" : ", " : ""
    const expression = type === "string[]" ? `${path} | join: ', '` : path
    const literals = [...state.literals]
    const trailingIndex = literals.length - 1
    literals[trailingIndex] = `${literals[trailingIndex] ?? ""}${separator}`
    literals.push("")
    commit({ variables: [...state.variables, { id: nextTemplatePartId(), expression }], literals })
  }

  function addText() {
    const literals = [...state.literals]
    const trailingIndex = literals.length - 1
    literals[trailingIndex] = `${literals[trailingIndex] ?? ""}text`
    commit({ ...state, literals })
  }

  function updateLiteral(index: number, value: string) {
    const literals = [...state.literals]
    literals[index] = value
    commit({ ...state, literals })
  }

  function removeVariable(id: string) {
    const index = state.variables.findIndex((variable) => variable.id === id)
    if (index < 0) return
    const variables = state.variables.filter((variable) => variable.id !== id)
    const literals = [...state.literals]
    if (state.variables.length === 1) literals.splice(0, 2, `${literals[0] ?? ""}${literals[1] ?? ""}`)
    else if (index < state.variables.length - 1) literals.splice(index + 1, 1)
    else literals.splice(index, 1)
    commit({ variables, literals })
  }

  const empty = state.variables.length === 0 && state.literals.every((literal) => !literal)
  return <div className="min-w-0 space-y-1"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{props.label}</span><div className="flex flex-wrap items-center justify-end gap-1"><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost"><Plus />{props.t("actions.addVariable", "Variable")}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">{availableVariables.map((variable) => <DropdownMenuItem key={variable.path} onSelect={() => addVariable(variable.path, variable.type)}><span className="truncate text-xs">{templateVariableLabel(variable.path, props.t)}</span><code className="ml-auto text-[10px] text-muted-foreground">{variable.path}</code></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu><Button type="button" size="sm" variant="ghost" onClick={addText}><TextCursorInput />{props.t("actions.addTextPart", "Text")}</Button></div></div><Tabs value={mode} onValueChange={(value) => setMode(value as "visual" | "source")}><TabsList variant="line" className="h-7 self-start"><TabsTrigger value="visual" disabled={!visual.supported} className="text-xs"><GripVertical />{props.t("values.visual", "Arrange")}</TabsTrigger><TabsTrigger value="source" className="text-xs"><Braces />{props.t("values.source", "Source")}</TabsTrigger></TabsList><TabsContent value="visual"><div className="min-h-14 border bg-muted/20 p-2" data-testid={`${props.scope}-template-composer`}><TooltipProvider><Sortable value={state.variables} getItemValue={getTemplateVariableId} orientation="mixed" onValueChange={(variables) => commit({ ...state, variables })}><SortableContent className="flex min-h-9 flex-wrap content-start items-center gap-1.5">{state.variables.map((variable, index) => <Fragment key={variable.id}><TemplateLiteralInput index={index} value={state.literals[index] ?? ""} t={props.t} onChange={updateLiteral} /><TemplateVariableChip variable={variable} t={props.t} onRemove={removeVariable} /></Fragment>)}<TemplateLiteralInput index={state.variables.length} value={state.literals[state.variables.length] ?? ""} t={props.t} onChange={updateLiteral} /></SortableContent><SortableOverlay>{({ value }) => { const variable = state.variables.find((candidate) => candidate.id === value); return variable ? <TemplateVariablePreview variable={variable} t={props.t} /> : null }}</SortableOverlay></Sortable></TooltipProvider>{empty ? <p className="py-2 text-center text-xs text-muted-foreground">{props.t("templates.empty", "Add variables or fixed text.")}</p> : null}</div></TabsContent><TabsContent value="source"><Textarea aria-label={`${props.label} ${props.t("values.source", "Source")}`} className="min-h-20 font-mono text-xs" value={props.value} onChange={(event) => props.onValueChange(event.currentTarget.value)} />{visual.error ? <p className="mt-1 text-xs text-destructive">{visual.error}</p> : null}</TabsContent></Tabs></div>
}

function TemplateLiteralInput({ index, value, t, onChange }: { index: number; value: string; t: NodeTranslator; onChange(index: number, value: string): void }) {
  if (!value) return null
  return <Input aria-label={t("fields.fixedTemplateText", "Fixed template text")} className="h-8 w-24 shrink-0 bg-background px-2 font-mono text-xs" value={value} onChange={(event) => onChange(index, event.currentTarget.value)} />
}

function TemplateVariableChip({ variable, t, onRemove }: { variable: SortableTemplateVariable; t: NodeTranslator; onRemove(id: string): void }) {
  return <SortableItem value={variable.id} className="flex h-8 max-w-full items-center border bg-background shadow-xs"><Tooltip><TooltipTrigger asChild><SortableItemHandle className="grid size-7 shrink-0 place-items-center border-r text-muted-foreground" aria-label={t("actions.dragTemplatePart", "Drag to reorder")}><GripVertical className="size-3.5" /></SortableItemHandle></TooltipTrigger><TooltipContent>{t("actions.dragTemplatePart", "Drag to reorder")}</TooltipContent></Tooltip><span className="max-w-48 truncate px-2 text-xs font-medium" title={variable.expression}>{templateVariableLabel(variable.expression, t)}</span><Button type="button" size="icon-xs" variant="ghost" className="mx-0.5 shrink-0" aria-label={t("actions.removeTemplatePart", "Remove template part")} onClick={() => onRemove(variable.id)}><X /></Button></SortableItem>
}

function TemplateVariablePreview({ variable, t }: { variable: SortableTemplateVariable; t: NodeTranslator }) {
  return <div className="flex h-8 max-w-64 items-center gap-1 border bg-background px-2 text-xs shadow-md"><GripVertical className="size-3.5 text-muted-foreground" /><span className="truncate">{templateVariableLabel(variable.expression, t)}</span></div>
}

function templateVisualState(parts: readonly ComfygureTemplatePart[]): TemplateVisualState {
  const variables: SortableTemplateVariable[] = []
  const literals = [""]
  for (const part of parts) {
    if (part.kind === "text") literals[literals.length - 1] = `${literals[literals.length - 1] ?? ""}${part.value}`
    else {
      variables.push({ id: nextTemplatePartId(), expression: part.value })
      literals.push("")
    }
  }
  return { variables, literals }
}

function templateParts(state: TemplateVisualState): ComfygureTemplatePart[] {
  const parts: ComfygureTemplatePart[] = []
  for (let index = 0; index < state.variables.length; index += 1) {
    const literal = state.literals[index]
    if (literal) parts.push({ kind: "text", value: literal })
    parts.push({ kind: "variable", value: state.variables[index]!.expression })
  }
  const trailing = state.literals[state.variables.length]
  if (trailing) parts.push({ kind: "text", value: trailing })
  return parts
}

let templatePartSequence = 0

function nextTemplatePartId(): string {
  templatePartSequence += 1
  return `comfygure-template-part-${templatePartSequence}`
}

function getTemplateVariableId(variable: SortableTemplateVariable): string {
  return variable.id
}

function templateVariableLabel(expression: string, t: NodeTranslator): string {
  const path = expression.split("|")[0]?.trim() ?? expression
  const labels: Record<string, string> = {
    project: "Project name", run: "Run name", job: "Job index", seed: "Seed", model: "Model name", sourceName: "Source filename",
    "prompt.prefix": "Positive prefix", "prompt.positive": "Positive prompt", "prompt.negative": "Negative prompt",
    "batch.text": "Batch text", "batch.sourceName": "Source filename", "batch.sourceStem": "Source name", "batch.sourcePath": "Source path", "batch.sourceIndex": "Source index", "batch.loopIndex": "Loop index",
    "lora.names": "LoRA names", "lora.tags": "LoRA prompt tags", "models.unet": "UNet model", "models.clip": "CLIP model", "models.vae": "VAE model",
    "image.width": "Image width", "image.height": "Image height", "image.batchSize": "Image batch size", "sampler.name": "Sampler", "sampler.scheduler": "Scheduler", "sampler.steps": "Steps", "sampler.cfg": "CFG", "output.prefix": "Output prefix",
  }
  return t(`variables.${path.replaceAll(".", "_")}`, labels[path] ?? path)
}
