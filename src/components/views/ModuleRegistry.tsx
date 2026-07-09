import * as React from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { AnimatePresence, motion } from "motion/react"
import { localizeNodeHelp } from "@xiranite/contract"
import type { NodeHelp, NodeHelpCommand, NodeHelpField, NodeHelpWorkflow } from "@xiranite/contract"
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
  BookOpen,
  GalleryHorizontalEnd,
  GripVertical,
  KanbanSquare,
  LayoutList,
  Package,
  Table2,
  type LucideIcon,
} from "lucide-react"
import * as LucideIcons from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { nodeHelpLoaders } from "@/components/modules/packageModules.generated"
import { MODULE_REGISTRY } from "@/components/modules/registry"
import { useWorkspaceActions, useWorkspaceSelector } from "@/store/workspaceContext"
import { setModuleDragData } from "@/lib/moduleDragDrop"
import { cn } from "@/lib/utils"
import type { ModuleDef } from "@/types/workspace"

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
}), { dataViewType: "table" as const, defaultLimit: 25 })

const ListView = Object.assign(React.lazy(async () => {
  const mod = await import("@hibernalglow/ocean-dataview/views/list-view")
  return { default: mod.ListView as React.ComponentType<ListViewProps<ModuleRow>> }
}), { dataViewType: "list" as const, defaultLimit: 25 })

const GalleryView = Object.assign(React.lazy(async () => {
  const mod = await import("@hibernalglow/ocean-dataview/views/gallery-view")
  return { default: mod.GalleryView as React.ComponentType<GalleryViewProps<ModuleRow>> }
}), { dataViewType: "gallery" as const, defaultLimit: 25 })

const BoardView = Object.assign(React.lazy(async () => {
  const mod = await import("@hibernalglow/ocean-dataview/views/board-view")
  return { default: mod.BoardView as React.ComponentType<BoardViewProps<ModuleRow>> }
}), { dataViewType: "board" as const, defaultLimit: 25 })

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

function ModuleIdentityCell({
  item,
  hasHelp,
  onOpenHelp,
}: {
  item: ModuleRow
  hasHelp: boolean
  onOpenHelp: (item: ModuleRow) => void
}) {
  const { t } = useTranslation()
  const helpLabel = t("registry:help.open", { name: item.name })
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
      {hasHelp && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="ghost"
              size="icon-xs"
            >
              <span
                role="button"
                tabIndex={0}
                aria-label={helpLabel}
                title={helpLabel}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenHelp(item)
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  event.stopPropagation()
                  onOpenHelp(item)
                }}
              >
                <BookOpen data-icon="inline-start" />
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("registry:help.tooltip")}</TooltipContent>
        </Tooltip>
      )}
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

function buildProperties(
  t: TFunction,
  i18n: ReturnType<typeof useTranslation>["i18n"],
  onOpenHelp: (item: ModuleRow) => void,
): readonly DataViewProperty<ModuleRow>[] {
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
      value: (_property, item) => (
        <ModuleIdentityCell
          item={item}
          hasHelp={Boolean(nodeHelpLoaders[item.id])}
          onOpenHelp={onOpenHelp}
        />
      ),
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
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [helpModuleId, setHelpModuleId] = React.useState<string | null>(null)
  const modules = React.useMemo(
    () => MODULE_REGISTRY.map((module) => toModuleRow(module, t, i18n)),
    [t, i18n],
  )
  const modulesRef = React.useRef(modules)
  modulesRef.current = modules
  const openHelp = React.useCallback((item: ModuleRow) => {
    React.startTransition(() => {
      setHelpModuleId(item.id)
      setHelpOpen(true)
    })
  }, [])
  const properties = React.useMemo(() => buildProperties(t, i18n, openHelp), [t, i18n, openHelp])
  const activeHelpModule = React.useMemo(
    () => modules.find((module) => module.id === helpModuleId) ?? null,
    [helpModuleId, modules],
  )
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
    <TooltipProvider>
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
              limit: 25,
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
      <NodeHelpSheet
        open={helpOpen}
        module={activeHelpModule}
        onOpenChange={setHelpOpen}
      />
      </div>
    </TooltipProvider>
  )
}

type HelpLoadState =
  | { status: "idle" | "loading" | "missing" }
  | { status: "loaded"; help: NodeHelp }
  | { status: "error"; error: string }

function NodeHelpSheet({
  open,
  module,
  onOpenChange,
}: {
  open: boolean
  module: ModuleRow | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const [state, setState] = React.useState<HelpLoadState>({ status: "idle" })

  React.useEffect(() => {
    if (!open || !module) return

    const loader = nodeHelpLoaders[module.id]
    if (!loader) {
      setState({ status: "missing" })
      return
    }

    let cancelled = false
    setState({ status: "loading" })
    void loader()
      .then((result) => {
        if (!cancelled) setState({ status: "loaded", help: result.help })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: "error", error: error instanceof Error ? error.message : String(error) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [module, open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(560px,calc(100vw-1rem))] gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b border-border/60 px-4 py-3 pr-12">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="truncate text-sm">{module?.name ?? t("registry:help.title")}</SheetTitle>
              <SheetDescription className="mt-1 text-xs">
                {t("registry:help.description")}
              </SheetDescription>
            </div>
            {module && (
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline">{module.category}</Badge>
                <Badge variant="secondary">{module.id}</Badge>
              </div>
            )}
          </div>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${module?.id ?? "none"}-${state.status}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="p-4"
            >
              {state.status === "loading" && <NodeHelpLoading />}
              {state.status === "missing" && <NodeHelpEmpty title={t("registry:help.missingTitle")} description={t("registry:help.missingDescription")} />}
              {state.status === "error" && <NodeHelpEmpty title={t("registry:help.errorTitle")} description={state.error} />}
              {state.status === "loaded" && module && <NodeHelpContent module={module} help={localizeNodeHelp(state.help, i18n.language)} />}
            </motion.div>
          </AnimatePresence>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function NodeHelpLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

function NodeHelpEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="min-h-80 border border-border/60">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BookOpen />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function NodeHelpContent({ module, help }: { module: ModuleRow; help: NodeHelp }) {
  const { t } = useTranslation()
  const hasFields = Boolean(help.fields?.length)
  const hasSafety = Boolean(help.safety)

  return (
    <Tabs defaultValue="overview" className="gap-4">
      <TabsList variant="line" className="max-w-full overflow-x-auto">
        <TabsTrigger value="overview">{t("registry:help.tabs.overview")}</TabsTrigger>
        <TabsTrigger value="cli">CLI</TabsTrigger>
        {(hasFields || hasSafety) && <TabsTrigger value="fields">{t("registry:help.tabs.fields")}</TabsTrigger>}
      </TabsList>
      <TabsContent value="overview" className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{module.version}</Badge>
            <Badge variant="outline">{module.category}</Badge>
            {help.safety?.defaultMode && <Badge variant="outline">{help.safety.defaultMode}</Badge>}
          </div>
          <p className="text-sm font-medium leading-relaxed text-foreground">{help.short}</p>
          {help.description && help.description !== help.short && (
            <p className="text-xs leading-relaxed text-muted-foreground">{help.description}</p>
          )}
        </div>
        {help.whenToUse?.length && (
          <>
            <Separator />
            <HelpSection title={t("registry:help.sections.whenToUse")}>
              <HelpList items={help.whenToUse} />
            </HelpSection>
          </>
        )}
        <Separator />
        <HelpSection title={t("registry:help.sections.workflows")}>
          <div className="flex flex-col gap-3">
            {help.workflows.map((workflow) => (
              <WorkflowBlock key={workflow.title} workflow={workflow} />
            ))}
          </div>
        </HelpSection>
      </TabsContent>
      <TabsContent value="cli" className="flex flex-col gap-4">
        {help.commands.map((command) => (
          <CommandBlock key={command.title} command={command} />
        ))}
      </TabsContent>
      {(hasFields || hasSafety) && (
        <TabsContent value="fields" className="flex flex-col gap-5">
          {hasFields && (
            <HelpSection title={t("registry:help.sections.fields")}>
              <div className="flex flex-col gap-3">
                {help.fields?.map((field) => (
                  <FieldBlock key={field.name} field={field} />
                ))}
              </div>
            </HelpSection>
          )}
          {hasFields && hasSafety && <Separator />}
          {hasSafety && (
            <HelpSection title={t("registry:help.sections.safety")}>
              <SafetyBlock help={help} />
            </HelpSection>
          )}
        </TabsContent>
      )}
    </Tabs>
  )
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function HelpList({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm leading-relaxed text-foreground">
      {items.map((item) => (
        <li key={item} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          {item}
        </li>
      ))}
    </ul>
  )
}

function WorkflowBlock({ workflow }: { workflow: NodeHelpWorkflow }) {
  const { t } = useTranslation()
  const uiSteps = workflow.ui ?? []
  const cliSteps = workflow.cli ?? []
  const tips = workflow.tips ?? []

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-background px-3 py-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold text-foreground">{workflow.title}</div>
        {workflow.summary && <div className="text-xs leading-relaxed text-muted-foreground">{workflow.summary}</div>}
      </div>
      {uiSteps.length > 0 && <StepList label="UI" steps={uiSteps} />}
      {cliSteps.length > 0 && <StepList label="CLI" steps={cliSteps} />}
      {tips.length > 0 && <StepList label={t("registry:help.labels.tip")} steps={tips} />}
    </div>
  )
}

function StepList({ label, steps }: { label: string; steps: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Badge variant="outline" className="w-fit">{label}</Badge>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

function CommandBlock({ command }: { command: NodeHelpCommand }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-background px-3 py-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{command.title}</span>
          {command.command && <Badge variant="secondary">{command.command}</Badge>}
        </div>
        {command.description && <p className="text-xs leading-relaxed text-muted-foreground">{command.description}</p>}
      </div>
      <div className="flex flex-col gap-2">
        {command.examples.map((example) => (
          <div key={example.command} className="flex flex-col gap-1.5">
            {example.label && <div className="text-xs font-medium text-foreground">{example.label}</div>}
            <CodeLine value={example.command} />
            {example.description && <p className="text-xs leading-relaxed text-muted-foreground">{example.description}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

function CodeLine({ value }: { value: string }) {
  return (
    <code className="block overflow-x-auto rounded-md border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
      {value}
    </code>
  )
}

function FieldBlock({ field }: { field: NodeHelpField }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-background px-3 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-foreground">{field.name}</span>
        {field.type && <Badge variant="secondary">{field.type}</Badge>}
        {field.required && <Badge variant="outline">{t("registry:help.labels.required")}</Badge>}
        {field.defaultValue && <Badge variant="outline">{t("registry:help.labels.defaultValue", { value: field.defaultValue })}</Badge>}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{field.description}</p>
    </div>
  )
}

function SafetyBlock({ help }: { help: NodeHelp }) {
  const { t } = useTranslation()
  const items = [
    ...(help.safety?.destructive ?? []).map((item) => `${t("registry:help.labels.destructive")}: ${item}`),
    ...(help.safety?.notes ?? []).map((item) => `${t("registry:help.labels.note")}: ${item}`),
  ]

  return (
    <div className="flex flex-col gap-3">
      {help.safety?.defaultMode && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("registry:help.labels.defaultMode")}</span>
          <Badge variant="secondary">{help.safety.defaultMode}</Badge>
        </div>
      )}
      {items.length > 0 && <HelpList items={items} />}
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
