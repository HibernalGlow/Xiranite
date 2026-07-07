import * as React from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { DataViewProvider } from "@hibernalglow/ocean-dataview/providers"
import { useInfiniteController } from "@hibernalglow/ocean-dataview/hooks"
import { NotionToolbar } from "@hibernalglow/ocean-dataview/toolbars/notion"
import "@hibernalglow/ocean-dataview/styles.css"
import type { TableViewProps } from "@hibernalglow/ocean-dataview/views/table-view"
import type { ListViewProps } from "@hibernalglow/ocean-dataview/views/list-view"
import type {
  BadgeColor,
  BasePaginatedResponse,
  DataViewProperty,
  SearchQuery,
  SortQuery,
  WhereNode,
} from "@hibernalglow/ocean-dataview/types"
import { ArrowRight, GripVertical } from "lucide-react"
import { MODULE_REGISTRY } from "@/components/modules/registry"
import { useWorkspaceActions, useWorkspaceSelector } from "@/store/workspaceContext"
import { setModuleDragData } from "@/lib/moduleDragDrop"
import { cn } from "@/lib/utils"
import type { ModuleDef, ViewMode } from "@/types/workspace"

type CatalogViewMode = "list" | "table"

interface ModuleRow {
  id: string
  name: string
  version: string
  category: string
  description: string
  keywords: string
  icon: string
  _module: ModuleDef
}

type ModuleQueryOptions = {
  queryKey: readonly unknown[]
  queryFn: (ctx: { pageParam: unknown }) => Promise<BasePaginatedResponse<ModuleRow>>
  getNextPageParam: (lastPage: BasePaginatedResponse<ModuleRow>) => string | undefined
  initialPageParam: string
}

const TableView = Object.assign(React.lazy(async () => {
  const mod = await import("@hibernalglow/ocean-dataview/views/table-view")
  return { default: mod.TableView as React.ComponentType<TableViewProps<ModuleRow>> }
}), { dataViewType: "table" as const, defaultLimit: 40 })

const ListView = Object.assign(React.lazy(async () => {
  const mod = await import("@hibernalglow/ocean-dataview/views/list-view")
  return { default: mod.ListView as React.ComponentType<ListViewProps<ModuleRow>> }
}), { dataViewType: "list" as const, defaultLimit: 40 })

function toModuleRow(module: ModuleDef, t: TFunction, i18n: ReturnType<typeof useTranslation>["i18n"]): ModuleRow {
  const nameKey = `module:${module.id}.name`
  const descKey = `module:${module.id}.description`
  return {
    id: module.id,
    name: i18n.exists(nameKey) ? t(nameKey) : module.name,
    version: module.version,
    category: module.category,
    description: i18n.exists(descKey) ? t(descKey) : module.description,
    keywords: `${module.id} ${module.name} ${module.category} ${module.description}`,
    icon: module.icon,
    _module: module,
  }
}

function ModuleIdentityCell({ item, viewMode }: { item: ModuleRow; viewMode: ViewMode }) {
  const { t } = useTranslation()
  const workspaceActions = useWorkspaceActions()
  return (
    <div className="flex min-w-0 items-start gap-2 py-1">
      <div
        className="group/module-drag flex min-w-0 flex-1 cursor-grab items-start gap-2 active:cursor-grabbing"
        draggable
        data-module-id={item.id}
        onDragStart={(event) => setModuleDragData(event, item.id)}
        title={t("registry:dragHint")}
      >
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-border/60 bg-muted/30 text-muted-foreground group-hover/module-drag:text-primary">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{item.name}</span>
          <span className="block truncate text-[10px] font-mono text-muted-foreground">{item.id}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={() => workspaceActions.deployComponent(item.id, viewMode)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-primary/35 bg-primary/10 text-primary hover:bg-primary/15"
        title={t("registry:deployToCurrent")}
        aria-label={t("registry:deployToCurrent")}
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function buildProperties(t: TFunction, i18n: ReturnType<typeof useTranslation>["i18n"], viewMode: ViewMode): readonly DataViewProperty<ModuleRow>[] {
  const categories = Array.from(new Set(MODULE_REGISTRY.map((module) => module.category)))
  return [
    { id: "id", type: "text", key: "id", hidden: true, enableFilter: false, enableGroup: false },
    { id: "keywords", type: "text", key: "keywords", hidden: true, enableFilter: false, enableGroup: false, enableSearch: true },
    { id: "_module", type: "text", key: "_module", hidden: true, enableFilter: false, enableGroup: false, enableSearch: false },
    {
      id: "module",
      type: "formula",
      name: t("registry:module"),
      size: 230,
      sortBy: "name",
      enableFilter: false,
      enableGroup: false,
      value: (_property, item) => <ModuleIdentityCell item={item} viewMode={viewMode} />,
    },
    {
      id: "name",
      type: "text",
      key: "name",
      hidden: true,
      enableFilter: false,
      enableGroup: false,
      enableSearch: true,
    },
    {
      id: "description",
      type: "text",
      key: "description",
      name: t("registry:description"),
      size: 260,
      enableFilter: false,
      enableGroup: false,
      enableSearch: true,
      wrap: true,
    },
    {
      id: "category",
      type: "select",
      key: "category",
      name: t("registry:category"),
      size: 110,
      enableSearch: true,
      config: {
        options: categories.map((category) => ({
          value: category,
          name: i18n.exists(`registry:categories.${category}`) ? t(`registry:categories.${category}`) : category,
          color: categoryTone(category),
        })),
      },
    },
    {
      id: "version",
      type: "text",
      key: "version",
      name: t("registry:version"),
      size: 80,
      enableFilter: false,
      enableGroup: false,
      enableSearch: false,
    },
  ]
}

export function ModuleRegistry() {
  const { t, i18n } = useTranslation()
  const viewMode = useWorkspaceSelector((state) => state.viewMode)
  const [catalogView, setCatalogView] = React.useState<CatalogViewMode>("list")
  const modules = React.useMemo(
    () => MODULE_REGISTRY.map((module) => toModuleRow(module, t, i18n)),
    [t, i18n],
  )
  const modulesRef = React.useRef(modules)
  modulesRef.current = modules
  const properties = React.useMemo(() => buildProperties(t, i18n, viewMode), [t, i18n, viewMode])

  const { controller } = useInfiniteController<ModuleQueryOptions>({
    dataQuery: (params) => ({
      queryKey: ["xiranite", "module-registry", modulesRef.current, params.search, params.sort, params.filter, params.limit] as const,
      initialPageParam: "0",
      getNextPageParam: (lastPage) =>
        typeof lastPage.hasNextPage === "boolean" && lastPage.hasNextPage && lastPage.endCursor != null
          ? String(lastPage.endCursor)
          : undefined,
      queryFn: async ({ pageParam }) => {
        let rows = [...modulesRef.current]
        rows = applySearch(rows, params.search)
        rows = applyFilter(rows, params.filter)
        rows = applySort(rows, params.sort)
        const start = Number(pageParam ?? 0)
        const limit = params.limit
        const page = rows.slice(start, start + limit)
        return {
          items: page,
          hasNextPage: start + limit < rows.length,
          endCursor: start + limit < rows.length ? String(start + limit) : null,
        }
      },
    }),
  })

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <div className="shrink-0 border-b border-border/60 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">{t("registry:title")}</h1>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("registry:subtitle")}</p>
          </div>
          <div className="rounded-sm border border-border/60 bg-muted/20 px-2 py-1 text-[10px] font-mono text-muted-foreground">
            {modules.length}
          </div>
        </div>
      </div>

      <React.Suspense fallback={<div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{t("common:loading")}</div>}>
        <DataViewProvider
          controller={controller}
          properties={properties}
          defaults={{ limit: 40, column: { propertyId: "category", propertyType: "select" } }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <NotionToolbar enableSearch enableFilter enableSort enableSettings>
            <CatalogTabs value={catalogView} onChange={setCatalogView} />
          </NotionToolbar>
          {catalogView === "list" ? (
            <ListView pagination="loadMore" />
          ) : (
            <TableView
              pagination="loadMore"
              showPropertyNames
              showVerticalLines
              stickyHeader={{ enabled: true, offset: 0 }}
            />
          )}
        </DataViewProvider>
      </React.Suspense>
    </div>
  )
}

function CatalogTabs({ value, onChange }: { value: CatalogViewMode; onChange: (value: CatalogViewMode) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-0.5">
      {([
        ["list", t("registry:tabs.list")],
        ["table", t("registry:tabs.table")],
      ] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "h-7 rounded-sm px-2 text-[11px] font-medium transition-colors",
            value === key ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function isWhereExpr(node: WhereNode): node is { and?: WhereNode[]; or?: WhereNode[] } {
  return "and" in node || "or" in node
}

function matchWhereRule(row: ModuleRow, rule: { property: string; condition: string; value?: unknown }): boolean {
  const value = (row as unknown as Record<string, unknown>)[rule.property]
  switch (rule.condition) {
    case "eq": return value === rule.value
    case "ne": return value !== rule.value
    case "inArray": return Array.isArray(rule.value) && rule.value.includes(value)
    case "notInArray": return Array.isArray(rule.value) && !rule.value.includes(value)
    case "iLike": return String(value ?? "").toLowerCase().includes(String(rule.value ?? "").toLowerCase())
    case "notILike": return !String(value ?? "").toLowerCase().includes(String(rule.value ?? "").toLowerCase())
    case "isEmpty": return value == null || value === ""
    case "isNotEmpty": return value != null && value !== ""
    case "startsWith": return String(value ?? "").startsWith(String(rule.value ?? ""))
    case "endsWith": return String(value ?? "").endsWith(String(rule.value ?? ""))
    default: return true
  }
}

function matchWhereNode(row: ModuleRow, node: WhereNode): boolean {
  if (isWhereExpr(node)) {
    if (node.and) return node.and.every((child) => matchWhereNode(row, child))
    if (node.or) return node.or.some((child) => matchWhereNode(row, child))
    return true
  }
  return matchWhereRule(row, node)
}

function applyFilter(rows: ModuleRow[], filter: WhereNode[] | null): ModuleRow[] {
  if (!filter?.length) return rows
  return rows.filter((row) => filter.every((node) => matchWhereNode(row, node)))
}

function applySearch(rows: ModuleRow[], search: SearchQuery | null): ModuleRow[] {
  const q = search?.search?.trim().toLowerCase()
  if (!q) return rows
  const fields = search?.searchFields?.length ? search.searchFields : ["name", "description", "category", "id", "keywords"]
  return rows.filter((row) =>
    fields.some((field) => String((row as unknown as Record<string, unknown>)[field] ?? "").toLowerCase().includes(q)),
  )
}

function applySort(rows: ModuleRow[], sort: SortQuery[] | undefined): ModuleRow[] {
  if (!sort?.length) return rows
  return [...rows].sort((a, b) => {
    for (const entry of sort) {
      const av = (a as unknown as Record<string, unknown>)[entry.property]
      const bv = (b as unknown as Record<string, unknown>)[entry.property]
      if (av === bv) continue
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""))
      return entry.direction === "desc" ? -cmp : cmp
    }
    return 0
  })
}

function categoryTone(category: string): BadgeColor {
  if (category === "SYSTEM") return "red"
  if (category === "MEDIA") return "purple"
  if (category === "FILES") return "blue"
  if (category === "ORGANIZE") return "green"
  if (category === "META") return "teal"
  return "gray"
}
