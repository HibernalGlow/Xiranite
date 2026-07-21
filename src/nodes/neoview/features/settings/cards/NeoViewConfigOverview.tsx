import { lazy, Suspense, useMemo, useState, type ComponentType } from "react"
import { Braces, Database, Image, Keyboard, LayoutDashboard, Palette, Settings2 } from "lucide-react"

import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const LazyNodeConfigSourceView = lazy(() => import("@/nodes/shared/NodeConfigSourceView"))

interface ConfigCategoryDefinition {
  id: string
  icon: ComponentType<{ className?: string }>
  matches: RegExp
}

const CATEGORIES: ConfigCategoryDefinition[] = [
  { id: "reading", icon: LayoutDashboard, matches: /^(reader|view|view_defaults|folder_view|slideshow|reading|navigation)/i },
  { id: "layout", icon: Palette, matches: /^(ui|shell|workspace|layout|panel|panel_layout|card|card_state|material|sidebar|board)/i },
  { id: "media", icon: Image, matches: /^(image|media|thumbnail|codec|super_resolution|upscale|color|page_transition)/i },
  { id: "input", icon: Keyboard, matches: /^(input|input_bindings|binding|radial|radial_menu|shortcut|gesture)/i },
  { id: "data", icon: Database, matches: /^(data|emm|ai|history|bookmark|storage|cache|database|migration|sync)/i },
]

export function NeoViewConfigOverview({ config, tomlSource }: { config: Record<string, unknown> | undefined; tomlSource?: string }) {
  const { t } = useNodeI18n("neoview")
  const [mode, setMode] = useState("visual")
  const overview = useMemo(() => buildOverview(config), [config])

  if (!overview.sections.length) {
    return <div className="grid min-h-64 place-items-center p-6 text-sm text-muted-foreground">{t("configData.overview.empty", "No NeoView project configuration has been saved yet.")}</div>
  }

  return <Tabs value={mode} onValueChange={setMode} className="min-w-0 gap-0">
    <div className="flex justify-end border-b px-3 py-2"><TabsList><TabsTrigger value="visual">{t("configData.overview.visual", "Visual")}</TabsTrigger><TabsTrigger value="source" disabled={!tomlSource}>TOML</TabsTrigger></TabsList></div>
    <TabsContent value="visual" className="min-w-0">
      <div className="grid grid-cols-3 border-b bg-muted/25">
      <Metric value={overview.sections.length} label={t("configData.overview.sections", "Sections")} />
      <Metric value={overview.leafCount} label={t("configData.overview.fields", "Fields")} />
      <Metric value={overview.collectionItems} label={t("configData.overview.items", "Collection items")} />
      </div>
      <div className="divide-y">
      {overview.categories.map((category) => {
        const definition = CATEGORIES.find((item) => item.id === category.id)
        const Icon = definition?.icon ?? Braces
        return <section className="p-4 [content-visibility:auto]" key={category.id}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" />{categoryLabel(category.id, t)}</h3>
            <span className="text-xs tabular-nums text-muted-foreground">{category.sections.length}</span>
          </div>
          <div className="divide-y border-y">
            {category.sections.map((section) => <ConfigSection key={section.key} section={section} t={t} />)}
          </div>
        </section>
      })}
      </div>
    </TabsContent>
    <TabsContent value="source" className="min-w-0">
      {mode === "source" && tomlSource && config ? <Suspense fallback={<div className="grid min-h-48 place-items-center text-sm text-muted-foreground">{t("configData.overview.loadingSource", "Loading TOML highlighting...")}</div>}><LazyNodeConfigSourceView config={config} source={tomlSource} labels={neoSourceLabels(t)} /></Suspense> : null}
    </TabsContent>
  </Tabs>
}

function ConfigSection({ section, t }: { section: ConfigSectionModel; t: ReturnType<typeof useNodeI18n>["t"] }) {
  return <details className="group py-2">
    <summary className="flex cursor-pointer list-none items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-muted/45">
      <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{humanizeKey(section.key)}</span><span className="block truncate font-mono text-[10px] text-muted-foreground">{section.key}</span></span>
      <span className="text-xs tabular-nums text-muted-foreground">{section.leafCount} {t("configData.overview.fieldsShort", "fields")}</span>
      <span className="text-xs text-muted-foreground transition-transform group-open:rotate-90">›</span>
    </summary>
    <div className="ml-5 mt-2 grid gap-x-4 gap-y-1.5 border-l pl-3 sm:grid-cols-2">
      {section.preview.map((field) => <FieldPreview field={field} key={field.path} />)}
      {section.hiddenCount > 0 ? <p className="text-[11px] text-muted-foreground">+{section.hiddenCount} {t("configData.overview.moreFields", "more fields")}</p> : null}
    </div>
  </details>
}

function FieldPreview({ field }: { field: ConfigFieldPreview }) {
  return <div className="flex min-w-0 items-center justify-between gap-2 py-0.5 text-xs">
    <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground" title={field.path}>{field.path}</span>
    <ValuePreview value={field.value} />
  </div>
}

function ValuePreview({ value }: { value: unknown }) {
  if (typeof value === "boolean") return <span className="inline-flex shrink-0 items-center gap-1"><span className={`size-2 rounded-full ${value ? "bg-emerald-500" : "bg-muted-foreground/35"}`} />{value ? "ON" : "OFF"}</span>
  if (typeof value === "string" && /^#[\da-f]{3,8}$/i.test(value)) return <span className="inline-flex shrink-0 items-center gap-1 font-mono"><span className="size-3 border" style={{ backgroundColor: value }} />{value}</span>
  if (typeof value === "string") return <span className="max-w-40 truncate" title={value}>{value || "—"}</span>
  if (typeof value === "number") return <span className="shrink-0 font-mono tabular-nums">{value}</span>
  if (value === null) return <span className="text-muted-foreground">null</span>
  return <span className="max-w-40 truncate font-mono text-[10px]">{JSON.stringify(value)}</span>
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="min-w-0 border-r px-3 py-3 text-center last:border-r-0"><div className="text-lg font-semibold tabular-nums">{value}</div><div className="truncate text-[10px] text-muted-foreground">{label}</div></div>
}

interface ConfigOverviewModel {
  sections: ConfigSectionModel[]
  categories: Array<{ id: string; sections: ConfigSectionModel[] }>
  leafCount: number
  collectionItems: number
}

interface ConfigSectionModel {
  key: string
  leafCount: number
  collectionItems: number
  preview: ConfigFieldPreview[]
  hiddenCount: number
}

interface ConfigFieldPreview {
  path: string
  value: unknown
}

export function buildOverview(config: Record<string, unknown> | undefined): ConfigOverviewModel {
  const effective = isRecord(config?.config) ? config.config : config
  const sections = Object.entries(effective ?? {}).map(([key, value]) => {
    const fields: ConfigFieldPreview[] = []
    const stats = collectFields(value, "", fields)
    return {
      key,
      leafCount: stats.leafCount,
      collectionItems: stats.collectionItems,
      preview: fields.slice(0, 12),
      hiddenCount: Math.max(0, fields.length - 12),
    }
  })
  const grouped = new Map<string, ConfigSectionModel[]>()
  for (const section of sections) {
    const category = CATEGORIES.find((item) => item.matches.test(section.key))?.id ?? "other"
    const items = grouped.get(category) ?? []
    items.push(section)
    grouped.set(category, items)
  }
  const order = [...CATEGORIES.map((item) => item.id), "other"]
  return {
    sections,
    categories: order.flatMap((id) => grouped.has(id) ? [{ id, sections: grouped.get(id)! }] : []),
    leafCount: sections.reduce((sum, section) => sum + section.leafCount, 0),
    collectionItems: sections.reduce((sum, section) => sum + section.collectionItems, 0),
  }
}

function collectFields(value: unknown, path: string, output: ConfigFieldPreview[]): { leafCount: number; collectionItems: number } {
  if (Array.isArray(value)) {
    output.push({ path: path || "items", value: `${value.length} items` })
    return { leafCount: value.length || 1, collectionItems: value.length }
  }
  if (isRecord(value)) {
    let leafCount = 0
    let collectionItems = 0
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key
      const stats = collectFields(child, childPath, output)
      leafCount += stats.leafCount
      collectionItems += stats.collectionItems
    }
    if (!Object.keys(value).length) output.push({ path: path || "value", value: {} })
    return { leafCount: leafCount || 1, collectionItems }
  }
  output.push({ path: path || "value", value })
  return { leafCount: 1, collectionItems: 0 }
}

function categoryLabel(id: string, t: ReturnType<typeof useNodeI18n>["t"]): string {
  const fallbacks: Record<string, string> = { reading: "Reading and views", layout: "Interface and layout", media: "Images and media", input: "Input and interaction", data: "Data and services", other: "Other" }
  return t(`configData.overview.categories.${id}`, fallbacks[id] ?? id)
}

function humanizeKey(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function neoSourceLabels(t: ReturnType<typeof useNodeI18n>["t"]) {
  return {
    sections: t("config.source.sections", "Sections"),
    fields: t("config.source.fields", "Fields"),
    booleans: t("config.source.booleans", "Enabled switches"),
    collectionItems: t("config.source.items", "Collection items"),
    colors: t("config.source.colors", "Colors"),
    source: t("config.source.title", "TOML source"),
    copy: t("config.source.copy", "Copy"),
    copied: t("config.source.copied", "Copied"),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
