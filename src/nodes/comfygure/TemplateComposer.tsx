import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { Braces, GripVertical, X } from "lucide-react"
import { SEPARATORS, WithContext as ReactTags, type Tag } from "react-tag-input"
import {
  COMFYGURE_TEMPLATE_VARIABLES,
  parseComfygureVisualTemplate,
  serializeComfygureVisualTemplate,
  type ComfygureTemplatePart,
} from "@xiranite/node-comfygure/core"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"

type TemplateScope = "positive" | "negative" | "filenamePrefix"
type NodeTranslator = ReturnType<typeof useNodeI18n>["t"]
type TemplateTagKind = ComfygureTemplatePart["kind"]
type TemplateTag = Tag & { kind: TemplateTagKind; value: string }

const TAG_CLASS_NAMES = {
  tags: "min-w-0",
  tagInput: "relative min-w-36 flex-1",
  tagInputField: "h-8 w-full min-w-36 border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  selected: "flex min-h-10 flex-wrap content-start items-center gap-1.5",
  tag: "inline-flex h-8 max-w-full items-center gap-1 border px-2 text-xs shadow-xs",
  remove: "-mr-1 grid size-6 shrink-0 place-items-center text-muted-foreground hover:text-foreground",
  suggestions: "absolute left-0 top-full z-50 mt-1 max-h-64 min-w-72 overflow-y-auto border bg-popover p-1 text-popover-foreground shadow-md [&_ul]:space-y-0.5",
  activeSuggestion: "bg-accent text-accent-foreground",
  editTagInput: "inline-flex h-8 min-w-32",
  editTagInputField: "h-8 min-w-32 border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
}

export function TemplateComposer(props: { label: string; t: NodeTranslator; scope: TemplateScope; value: string; onValueChange(value: string): void }) {
  const [mode, setMode] = useState<"visual" | "source">("visual")
  const visual = parseComfygureVisualTemplate(props.value)
  const sourceRef = useRef(props.value)
  const [tags, setTags] = useState<TemplateTag[]>(() => templateTags(visual.parts, props.t))
  const suggestions = useMemo(
    () => COMFYGURE_TEMPLATE_VARIABLES
      .filter((variable) => variable.scopes.includes(props.scope))
      .map((variable) => variableTag(variable.path, variable.type, props.t, `suggestion:${variable.path}`)),
    [props.scope, props.t],
  )

  useEffect(() => {
    if (!visual.supported) setMode("source")
  }, [visual.supported])

  useEffect(() => {
    if (props.value === sourceRef.current) return
    sourceRef.current = props.value
    setTags(templateTags(parseComfygureVisualTemplate(props.value).parts, props.t))
  }, [props.t, props.value])

  function commit(next: TemplateTag[]) {
    const source = serializeComfygureVisualTemplate(next.map(tagTemplatePart))
    sourceRef.current = source
    setTags(next)
    props.onValueChange(source)
  }

  function handleAddition(tag: Tag) {
    const nextTag = normalizeAddedTag(tag, suggestions)
    if (!nextTag) return
    const separator = defaultSeparator(props.scope)
    const needsSeparator = tags.at(-1)?.kind === "variable" && nextTag.kind === "variable"
    commit([
      ...tags,
      ...(needsSeparator ? [textTag(separator)] : []),
      { ...nextTag, id: nextTemplatePartId() },
    ])
  }

  function handleDelete(index: number) {
    if (index < 0 || index >= tags.length) return
    const next = tags.filter((_, tagIndex) => tagIndex !== index)
    const separator = defaultSeparator(props.scope)
    if (tags[index]?.kind === "variable") {
      if (next[index]?.kind === "text" && next[index]?.value === separator) next.splice(index, 1)
      else if (next[index - 1]?.kind === "text" && next[index - 1]?.value === separator) next.splice(index - 1, 1)
    }
    commit(next)
  }

  function handleDrag(tag: Tag, currentIndex: number, nextIndex: number) {
    if (currentIndex === nextIndex) return
    const next = [...tags]
    const [moved] = next.splice(currentIndex, 1)
    if (!moved) return
    next.splice(nextIndex, 0, moved)
    commit(next)
  }

  function handleTagUpdate(index: number, tag: Tag) {
    const current = tags[index]
    if (!current) return
    const next = [...tags]
    if (current.kind === "variable") {
      const replacement = suggestionForTag(tag, suggestions)
      if (!replacement) return
      next[index] = { ...replacement, id: current.id }
    } else {
      const value = tag.text ?? ""
      if (!value) return
      next[index] = textTag(value, current.id)
    }
    commit(next)
  }

  const empty = tags.length === 0
  return <div className="min-w-0 space-y-1"><span className="text-xs font-medium">{props.label}</span><Tabs value={mode} onValueChange={(value) => setMode(value as "visual" | "source")}><TabsList variant="line" className="h-7 self-start"><TabsTrigger value="visual" disabled={!visual.supported} className="text-xs"><GripVertical />{props.t("values.visual", "Arrange")}</TabsTrigger><TabsTrigger value="source" className="text-xs"><Braces />{props.t("values.source", "Source")}</TabsTrigger></TabsList><TabsContent value="visual"><div className="min-h-14 border bg-muted/20 p-2" data-testid={`${props.scope}-template-composer`}><ReactTags tags={tags} suggestions={suggestions} separators={[SEPARATORS.ENTER, SEPARATORS.TAB]} labelField="text" placeholder={props.t("templates.addPart", "Add text or choose a variable")} autoFocus={false} minQueryLength={1} allowUnique={false} allowAdditionFromPaste={false} editable inputFieldPosition="inline" classNames={TAG_CLASS_NAMES} removeComponent={TemplateTagRemoveButton} handleAddition={handleAddition} handleDelete={handleDelete} handleDrag={handleDrag} onTagUpdate={handleTagUpdate} handleFilterSuggestions={(query, possible) => filterTemplateSuggestions(query, possible)} renderSuggestion={(tag) => <TemplateSuggestion tag={tag as TemplateTag} />} />{empty ? <p className="py-2 text-center text-xs text-muted-foreground">{props.t("templates.empty", "Add variables or fixed text.")}</p> : null}</div></TabsContent><TabsContent value="source"><Textarea aria-label={`${props.label} ${props.t("values.source", "Source")}`} className="min-h-20 font-mono text-xs" value={props.value} onChange={(event) => props.onValueChange(event.currentTarget.value)} />{visual.error ? <p className="mt-1 text-xs text-destructive">{visual.error}</p> : null}</TabsContent></Tabs></div>
}

function TemplateTagRemoveButton(props: { onRemove(event: MouseEvent<HTMLButtonElement>): void; className?: string; "aria-label"?: string }) {
  return <button type="button" className={props.className} aria-label={props["aria-label"]} onClick={props.onRemove}><X className="size-3.5" /></button>
}

function TemplateSuggestion({ tag }: { tag: TemplateTag }) {
  return <span className="flex min-w-0 items-center gap-3 px-2 py-1.5"><span className="min-w-0 flex-1 truncate text-xs">{tag.text}</span><code className="shrink-0 text-[10px] text-muted-foreground">{tag.value}</code></span>
}

function filterTemplateSuggestions(query: string, suggestions: Tag[]): Tag[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return suggestions
  return suggestions.filter((tag) => `${tag.text} ${(tag as TemplateTag).value}`.toLocaleLowerCase().includes(needle))
}

function normalizeAddedTag(tag: Tag, suggestions: readonly TemplateTag[]): TemplateTag | undefined {
  const suggestion = suggestionForTag(tag, suggestions)
  if (suggestion) return suggestion
  const value = tag.text?.trim()
  return value ? textTag(value) : undefined
}

function suggestionForTag(tag: Tag, suggestions: readonly TemplateTag[]): TemplateTag | undefined {
  const candidate = tag as Partial<TemplateTag>
  if (candidate.kind === "variable" && candidate.value) {
    return suggestions.find((suggestion) => suggestion.value === candidate.value)
  }
  const value = tag.text?.trim().toLocaleLowerCase()
  if (!value) return undefined
  return suggestions.find((suggestion) => suggestion.text.toLocaleLowerCase() === value || suggestion.value.toLocaleLowerCase() === value)
}

function templateTags(parts: readonly ComfygureTemplatePart[], t: NodeTranslator): TemplateTag[] {
  return parts.map((part) => part.kind === "variable"
    ? variableTagFromExpression(part.value, t)
    : textTag(part.value))
}

function tagTemplatePart(tag: TemplateTag): ComfygureTemplatePart {
  return { kind: tag.kind, value: tag.value }
}

function textTag(value: string, id = nextTemplatePartId()): TemplateTag {
  return { id, text: value, className: "bg-background font-mono", kind: "text", value }
}

function variableTag(path: string, type: "string" | "number" | "string[]", t: NodeTranslator, id = nextTemplatePartId()): TemplateTag {
  const expression = type === "string[]" ? `${path} | join: ', '` : path
  return variableTagFromExpression(expression, t, id)
}

function variableTagFromExpression(expression: string, t: NodeTranslator, id = nextTemplatePartId()): TemplateTag {
  return { id, text: templateVariableLabel(expression, t), className: "bg-primary/10 font-medium text-primary", kind: "variable", value: expression }
}

function defaultSeparator(scope: TemplateScope): string {
  return scope === "filenamePrefix" ? "-" : ", "
}

let templatePartSequence = 0

function nextTemplatePartId(): string {
  templatePartSequence += 1
  return `comfygure-template-part-${templatePartSequence}`
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
