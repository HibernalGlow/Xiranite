import * as React from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { DataViewProvider } from "@hibernalglow/ocean-dataview/providers"
import { useInfiniteController } from "@hibernalglow/ocean-dataview/hooks"
import { NotionToolbar } from "@hibernalglow/ocean-dataview/toolbars/notion"
import "@hibernalglow/ocean-dataview/styles.css"
import type { TableViewProps } from "@hibernalglow/ocean-dataview/views/table-view"
import type { ListViewProps } from "@hibernalglow/ocean-dataview/views/list-view"
import type { GalleryViewProps } from "@hibernalglow/ocean-dataview/views/gallery-view"
import type { BoardViewProps } from "@hibernalglow/ocean-dataview/views/board-view"
import type {
  BadgeColor,
  BasePaginatedResponse,
  DataViewProperty,
  SearchQuery,
  SortQuery,
  WhereNode,
} from "@hibernalglow/ocean-dataview/types"
import {
  ArrowRight,
  GalleryHorizontalEnd,
  GripVertical,
  KanbanSquare,
  LayoutList,
  Package,
  Table2,
  type LucideIcon,
} from "lucide-react"
import * as LucideIcons from "lucide-react"
import { MODULE_REGISTRY } from "@/components/modules/registry"
import { useWorkspaceActions, useWorkspaceSelector } from "@/store/workspaceContext"
import { setModuleDragData } from "@/lib/moduleDragDrop"
import { cn } from "@/lib/utils"
import type { ModuleDef, ViewMode } from "@/types/workspace"

type CatalogViewMode = "list" | "table" | "gallery" | "board"

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

const GalleryView = Object.assign(React.lazy(async () => {
  const mod = await import("@hibernalglow/ocean-dataview/views/gallery-view")
  return { default: mod.GalleryView as React.ComponentType<GalleryViewProps<ModuleRow>> }
}), { dataViewType: "gallery" as const, defaultLimit: 40 })

const BoardView = Object.assign(React.lazy(async () => {
  const mod = await import("@hibernalglow/ocean-dataview/views/board-view")
  return { default: mod.BoardView as React.ComponentType<BoardViewProps<ModuleRow>> }
}), { dataViewType: "board" as const, defaultLimit: 40 })

const iconRegistry = LucideIcons as unknown as Record<string, LucideIcon | undefined>

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

function ModuleIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = iconRegistry[icon] ?? Package
  return <Icon className={className} />
}

function ModuleIdentityCell({ item }: { item: ModuleRow }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-start gap-2 py-1">
      <div
        className="group/module-drag flex min-w-0 flex-1 cursor-grab items-start gap-2 active:cursor-grabbing"
        draggable
        data-module-id={item.id}
        onDragStart={(event) => setModuleDragData(event, item.id)}
        title={t("registry:dragHint")}
      >
        <span className="mt-0.5 grid h-6 w-4 shrink-0 place-items-center text-muted-foreground/60 group-hover/module-drag:text-primary">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-border/60 bg-muted/30 text-muted-foreground group-hover/module-drag:border-primary/40 group-hover/module-drag:text-primary">
          <ModuleIcon icon={item.icon} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{item.name}</span>
          <span className="block truncate text-[10px] font-mono text-muted-foreground">{item.id}</span>
        </span>
      </div>
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-primary/35 bg-primary/10 text-primary"
        title={t("registry:deployToCurrent")}
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </div>
  )
}

function buildProperties(t: TFunction, i18n: ReturnType<typeof useTranslation>["i18n"]): readonly DataViewProperty<ModuleRow>[] {
  const categories = Array.from(new Set(MODULE_REGISTRY.map((module) => module.category)))
  return [
    { id: "id", type: "text", key: "id", hidden: true, enableFilter: false, enableGroup: false },
    { id: "keywords", type: "text", key: "keywords", hidden: true, enableFilter: false, enableGroup: false, enableSearch: true },
    { id: "_module", type: "text", key: "_module", hidden: true, enableFilter: false, enableGroup: false, enableSearch: false },
    {
      id: "module",
      type: "formula",
      name: t("registry:module"),
      size: 210,
      sortBy: "name",
      enableFilter: false,
      enableGroup: false,
      value: (_property, item) => <ModuleIdentityCell item={item} />,
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
      size: 190,
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
      size: 88,
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
      size: 64,
      enableFilter: false,
      enableGroup: false,
      enableSearch: false,
    },
  ]
}

export function ModuleRegistry() {
  const { t, i18n } = useTranslation()
  const viewMode = useWorkspaceSelector((state) => state.viewMode)
  const workspaceActions = useWorkspaceActions()
  const [catalogView, setCatalogView] = React.useState<CatalogViewMode>("list")
  const modules = React.useMemo(
    () => MODULE_REGISTRY.map((module) => toModuleRow(module, t, i18n)),
    [t, i18n],
  )
  const modulesRef = React.useRef(modules)
  modulesRef.current = modules
  const properties = React.useMemo(() => buildProperties(t, i18n), [t, i18n])
  const deployToCurrentView = React.useCallback(
    (item: ModuleRow) => workspaceActions.deployComponent(item.id, viewMode),
    [viewMode, workspaceActions],
  )

  const { controller } = useInfiniteController<ModuleQueryOptions>({
    columnQuery: (params) => ({
      queryKey: ["xiranite", "module-registry", "columns", modulesRef.current, params.search, params.filter, params.hideEmpty] as const,
      queryFn: async () => buildCategoryCounts(modulesRef.current, params.search, params.filter, params.hideEmpty),
    }),
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

  const catalogViewNode = (() => {
    switch (catalogView) {
      case "table":
        return (
          <TableView
            onRowClick={deployToCurrentView}
            pagination="loadMore"
            showPropertyNames
            showVerticalLines
            stickyHeader={{ enabled: true, offset: 0 }}
          />
        )
      case "gallery":
        return (
          <GalleryView
            cardLayout="compact"
            cardSize="small"
            onCardClick={deployToCurrentView}
            pagination="loadMore"
            showPropertyNames
            wrapAllProperties
          />
        )
      case "board":
        return (
          <BoardView
            cardLayout="compact"
            cardSize="small"
            colorColumns
            onCardClick={deployToCurrentView}
            pagination="loadMore"
            showPropertyNames
            stickyHeader={{ enabled: true, offset: 0 }}
            wrapAllProperties
          />
        )
      case "list":
      default:
        return <ListView onItemClick={deployToCurrentView} pagination="loadMore" />
    }
  })()

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

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 [scrollbar-gutter:stable]">
        <React.Suspense fallback={<div className="flex min-h-48 items-center justify-center text-xs text-muted-foreground">{t("common:loading")}</div>}>
          <DataViewProvider
            key={catalogView}
            controller={controller}
            properties={properties}
            defaults={{
              limit: 40,
              column: {
                propertyId: "category",
                propertyType: "select",
                hideEmpty: true,
                showCount: true,
              },
            }}
            className="min-h-full [&>*:first-child]:sticky [&>*:first-child]:top-0 [&>*:first-child]:z-20 [&>*:first-child]:border-b [&>*:first-child]:border-border/60 [&>*:first-child]:bg-card/95 [&>*:first-child]:py-2 [&>*:first-child]:backdrop-blur"
          >
            <NotionToolbar enableSearch enableFilter enableSort enableSettings>
              <CatalogTabs value={catalogView} onChange={setCatalogView} />
            </NotionToolbar>
            {catalogViewNode}
          </DataViewProvider>
        </React.Suspense>
      </div>
    </div>
  )
}

function CatalogTabs({ value, onChange }: { value: CatalogViewMode; onChange: (value: CatalogViewMode) => void }) {
  const { t } = useTranslation()
  const options: { key: CatalogViewMode; icon: LucideIcon }[] = [
    { key: "list", icon: LayoutList },
    { key: "table", icon: Table2 },
    { key: "gallery", icon: GalleryHorizontalEnd },
    { key: "board", icon: KanbanSquare },
  ]

  return (
    <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-sm border border-border/60 bg-muted/20 p-0.5">
      {options.map(({ key, icon: Icon }) => {
        const label = t(`registry:tabs.${key}`)
        return (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={label}
          aria-label={label}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-[11px] font-medium transition-colors",
            value === key ? "bg-secondary text-secondary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
        )
      })}
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

function buildCategoryCounts(rows: ModuleRow[], search: SearchQuery | null, filter: WhereNode[] | null, hideEmpty: boolean) {
  const filteredRows = applyFilter(applySearch(rows, search), filter)
  const visibleCategories = new Set(filteredRows.map((row) => row.category))
  const categories = Array.from(new Set(rows.map((row) => row.category))).sort((a, b) => a.localeCompare(b))

  const counts: Record<string, { count: number; hasMore: boolean }> = {}
  const sortValues: Record<string, number> = {}

  categories.forEach((category, index) => {
    const count = filteredRows.filter((row) => row.category === category).length
    if (hideEmpty && count === 0 && !visibleCategories.has(category)) return
    counts[category] = { count, hasMore: false }
    sortValues[category] = index
  })

  return {
    counts,
    hasNextPage: false,
    nextCursor: null,
    sortValues,
  }
}

function categoryTone(category: string): BadgeColor {
  const normalized = category.toUpperCase()
  if (normalized === "SYSTEM") return "red"
  if (normalized === "MEDIA" || normalized === "IMAGE" || normalized === "VIDEO") return "purple"
  if (normalized === "FILES" || normalized === "FILE") return "blue"
  if (normalized === "ORGANIZE") return "green"
  if (normalized === "META" || normalized === "DEV") return "teal"
  if (normalized === "TEXT") return "yellow"
  return "gray"
}
