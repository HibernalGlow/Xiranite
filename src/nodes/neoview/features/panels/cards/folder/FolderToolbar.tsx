import {
  ALargeSmall,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  CheckSquare,
  Calendar,
  FileType,
  FolderTree,
  Grid2X2,
  HardDrive,
  Heart,
  Layers3,
  ListTree,
  Lock,
  RefreshCw,
  Search,
  Shuffle,
  Star,
  Trash2,
  Unlock,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  type LucideIcon,
} from "lucide-react"
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type {
  ReaderDirectoryFilterDto,
  ReaderDirectorySortDto,
  ReaderDirectorySortFieldDto,
  ReaderDirectorySortPreferenceCommandDto,
  ReaderDirectorySortSourceDto,
  ReaderFolderEmptyAreaConfig,
  ReaderFolderConfirmationConfig,
  ReaderFolderPenetrationConfig,
  ReaderFolderTagDisplayConfig,
  ReaderFolderTitleWrapConfig,
  ReaderFolderTreeLayout,
  ReaderFolderViewMode,
} from "../../../../adapters/reader-http-client"
import { viewUsesThumbnails } from "./DirectoryCatalog"
import { FolderInlineBranchLimitFields } from "./FolderInlineBranchLimitFields"
import type { FolderDeleteStrategy } from "./FolderDeleteButton"
import FolderMegaMenu from "./FolderMegaMenu"

export type FolderToolbarViewModeOption = {
  value: ReaderFolderViewMode
  label: string
  icon: LucideIcon
}

export type FolderToolbarPreviewCount = 4 | 9 | 16

const SORT_FIELD_ICONS: Readonly<Record<ReaderDirectorySortFieldDto, LucideIcon>> = {
  name: ALargeSmall,
  date: Calendar,
  size: HardDrive,
  type: FileType,
  random: Shuffle,
  rating: Star,
  cmRating: BadgeCheck,
  path: FolderTree,
  collectTagCount: Heart,
}

export type FolderToolbarProps = {
  disabled: boolean
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  canGoUp: boolean
  homePath?: string
  currentPath?: string
  viewMode: ReaderFolderViewMode
  viewModeOptions: readonly FolderToolbarViewModeOption[]
  previewGridEnabled: boolean
  previewCount: FolderToolbarPreviewCount
  hoverPreviewEnabled: boolean
  hoverPreviewDelayMs: number
  contentWidthPercent: number
  thumbnailWidthPercent: number
  bannerWidthPercent: number
  searchOpen: boolean
  canFilter: boolean
  typeFilter?: ReaderDirectoryFilterDto
  filterOptions?: readonly ReaderDirectoryFilterDto[]
  showHiddenFolders: boolean
  hideMissingEfuEntries: boolean
  canHideMissingEfuEntries: boolean
  tagDisplay: ReaderFolderTagDisplayConfig
  titleWrap: ReaderFolderTitleWrapConfig
  penetration: ReaderFolderPenetrationConfig
  treeOpen: boolean
  treeLayout: ReaderFolderTreeLayout
  canTree: boolean
  inlineTreeOpen: boolean
  multiSelectMode: boolean
  deleteMode?: boolean
  deleteStrategy?: FolderDeleteStrategy
  confirmations?: ReaderFolderConfirmationConfig
  sort?: ReaderDirectorySortDto
  sortFields?: readonly ReaderDirectorySortFieldDto[]
  sortSource?: ReaderDirectorySortSourceDto
  sortTemporary?: boolean
  canSort: boolean
  canSortPreference: boolean
  emptyArea: ReaderFolderEmptyAreaConfig
  thumbnailRefreshPending: boolean
  canRefreshThumbnails: boolean
  canRefreshSelectedThumbnails: boolean
  canImportEfu?: boolean
  sortLabels: Readonly<Record<ReaderDirectorySortFieldDto, string>>
  sortSourceLabels: Readonly<Record<ReaderDirectorySortSourceDto, string>>
  onNavigateBack(): void
  onNavigateForward(): void
  onNavigateUp(): void
  onGoHome(): void
  onSetHome(): void
  onRefresh(): void
  onSwitchView(mode: ReaderFolderViewMode): void
  onTogglePreviewGrid(enabled: boolean): void
  onSwitchPreviewCount(count: FolderToolbarPreviewCount): void
  onCommitHoverPreviewEnabled(enabled: boolean): void
  onCommitHoverPreviewDelay(delayMs: number): void
  onContentWidthChange(value: number): void
  onCommitContentWidth(value: number): void
  onThumbnailWidthChange(value: number): void
  onCommitThumbnailWidth(value: number): void
  onBannerWidthChange(value: number): void
  onCommitBannerWidth(value: number): void
  onToggleSearch(): void
  onChangeTypeFilter?(filter: ReaderDirectoryFilterDto): void
  onChangeShowHiddenFolders?(showHiddenFolders: boolean): void
  onChangeHideMissingEfuEntries?(hideMissingEfuEntries: boolean): void
  onTagDisplayChange(patch: Partial<ReaderFolderTagDisplayConfig>): void
  onTitleWrapChange(patch: Partial<ReaderFolderTitleWrapConfig>): void
  onTogglePenetration(enabled: boolean): void
  onUpdatePenetration(patch: Partial<ReaderFolderPenetrationConfig>): void
  onToggleTree(): void
  onTreeLayoutChange(layout: ReaderFolderTreeLayout): void
  onToggleInlineTree(): void
  onToggleMultiSelect(): void
  onToggleDeleteMode?(): void
  onToggleDeleteStrategy?(): void
  onConfirmationChange?(patch: Partial<ReaderFolderConfirmationConfig>): void
  onUpdateSort(sort: ReaderDirectorySortDto): void
  onUpdateSortPreference(command: ReaderDirectorySortPreferenceCommandDto): void
  onEmptyAreaChange(patch: Partial<ReaderFolderEmptyAreaConfig>): void
  onRefreshVisibleThumbnails(): void
  onRefreshSelectedThumbnails(): void
  onCancelThumbnailRefresh(): void
  onImportEfu?(): void
  dislikedTrashMenuItem?: ReactNode
}

/**
 * Compact single-row folder chrome.
 * Navigation and More remain fixed while the primary tools scroll at narrow widths.
 * Type filtering is a structured panel under 更多 — not the old chip strip.
 */
export default function FolderToolbar(props: FolderToolbarProps) {
  const [penetrationSettingsOpen, setPenetrationSettingsOpen] = useState(false)
  const {
    disabled,
    loading,
    canGoBack,
    canGoForward,
    canGoUp,
    homePath,
    currentPath,
    viewMode,
    viewModeOptions,
    previewGridEnabled,
    previewCount,
    hoverPreviewEnabled,
    hoverPreviewDelayMs,
    contentWidthPercent,
    thumbnailWidthPercent,
    bannerWidthPercent,
    searchOpen,
    canFilter,
    typeFilter = "library",
    filterOptions,
    showHiddenFolders,
    hideMissingEfuEntries,
    canHideMissingEfuEntries,
    tagDisplay,
    titleWrap,
    penetration,
    treeOpen,
    treeLayout,
    canTree,
    inlineTreeOpen,
    multiSelectMode,
    deleteMode = false,
    deleteStrategy = "trash",
    confirmations = { trash: false, permanentDelete: true, batchTrash: false, batchPermanentDelete: true },
    sort,
    sortFields,
    sortSource,
    sortTemporary,
    canSort,
    canSortPreference,
    emptyArea,
    thumbnailRefreshPending,
    canRefreshThumbnails,
    canRefreshSelectedThumbnails,
    canImportEfu = false,
    sortLabels,
    sortSourceLabels,
    onNavigateBack,
    onNavigateForward,
    onNavigateUp,
    onGoHome,
    onSetHome,
    onRefresh,
    onSwitchView,
    onTogglePreviewGrid,
    onSwitchPreviewCount,
    onCommitHoverPreviewEnabled,
    onCommitHoverPreviewDelay,
    onContentWidthChange,
    onCommitContentWidth,
    onThumbnailWidthChange,
    onCommitThumbnailWidth,
    onBannerWidthChange,
    onCommitBannerWidth,
    onToggleSearch,
    onChangeTypeFilter,
    onChangeShowHiddenFolders,
    onChangeHideMissingEfuEntries,
    onTagDisplayChange,
    onTitleWrapChange,
    onTogglePenetration,
    onUpdatePenetration,
    onToggleTree,
    onTreeLayoutChange,
    onToggleInlineTree,
    onToggleMultiSelect,
    onToggleDeleteMode = () => undefined,
    onToggleDeleteStrategy = () => undefined,
    onConfirmationChange = () => undefined,
    onUpdateSort,
    onUpdateSortPreference,
    onEmptyAreaChange,
    onRefreshVisibleThumbnails,
    onRefreshSelectedThumbnails,
    onCancelThumbnailRefresh,
    onImportEfu,
    dislikedTrashMenuItem,
  } = props

  const busy = disabled || loading
  const currentView = viewModeOptions.find((option) => option.value === viewMode) ?? viewModeOptions[0]!
  const CurrentViewIcon = currentView.icon
  const thumbsEnabled = viewUsesThumbnails(viewMode)
  const sortFieldLabel = sort ? sortLabels[sort.field] : "排序"
  const sortOrderLabel = sort?.order === "asc" ? "升序" : "降序"
  const SortFieldIcon = sort ? SORT_FIELD_ICONS[sort.field] : ALargeSmall
  return (
    <div
      className="@container/folder-toolbar flex min-w-0 flex-nowrap items-center gap-0.5 overflow-hidden"
      data-folder-toolbar-row="operations"
      data-folder-toolbar-layout="single-row-scroll"
    >
      <div className="flex shrink-0 items-center gap-0.5" data-folder-toolbar-group="navigation">
        <FolderNavigationPad
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          canGoUp={canGoUp}
          busy={busy}
          loading={loading}
          homePath={homePath}
          currentPath={currentPath}
          onNavigateBack={onNavigateBack}
          onNavigateForward={onNavigateForward}
          onNavigateUp={onNavigateUp}
          onGoHome={onGoHome}
          onSetHome={onSetHome}
          onRefresh={onRefresh}
        />
        <ToolbarDivider />
      </div>

      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-hidden" data-folder-toolbar-group="tools">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-folder-toolbar-group="primary" data-scrollbar="hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="视图"
                title={`视图：${currentView.label}`}
                disabled={!currentPath || busy}
                data-folder-toolbar-control="view"
              >
                <CurrentViewIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52" data-folder-toolbar-menu="view">
              <DropdownMenuLabel>视图模式</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={viewMode} onValueChange={(value) => onSwitchView(value as ReaderFolderViewMode)}>
                {viewModeOptions.map((option) => {
                  const Icon = option.icon
                  return (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <Icon className="size-4" />
                      {option.label}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
              {thumbsEnabled ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={previewGridEnabled}
                    onCheckedChange={(checked) => onTogglePreviewGrid(checked === true)}
                  >
                    <Grid2X2 className="size-4" />
                    多图预览
                  </DropdownMenuCheckboxItem>
                  {previewGridEnabled ? (
                    <>
                      <DropdownMenuLabel>多图数量</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={String(previewCount)}
                        onValueChange={(value) => onSwitchPreviewCount(Number(value) as FolderToolbarPreviewCount)}
                      >
                        <DropdownMenuRadioItem value="4">4 图</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="9">9 图</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="16">16 图</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </>
                  ) : null}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          {sort && sortFields ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={sortTemporary ? "default" : "ghost"}
                  aria-label="排序"
                  title={`排序：${sortFieldLabel} · ${sortOrderLabel}`}
                  disabled={!currentPath || busy || !canSort}
                  data-folder-toolbar-control="sort"
                  aria-pressed={sortTemporary || undefined}
                >
                  <span className="relative grid size-4 place-items-center" aria-hidden="true">
                    <SortFieldIcon className="size-4" data-folder-sort-field-icon={sort.field} />
                    {sort.order === "asc"
                      ? <ArrowUp className="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-background p-px" data-folder-sort-order-icon="asc" />
                      : <ArrowDown className="absolute -bottom-1 -right-1 size-2.5 rounded-full bg-background p-px" data-folder-sort-order-icon="desc" />}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52" data-folder-toolbar-menu="sort">
                <DropdownMenuLabel>排序字段</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort.field}
                  onValueChange={(value) => {
                    const field = value as ReaderDirectorySortFieldDto
                    onUpdateSort({
                      ...sort,
                      field,
                      order: field === "cmRating" ? "desc" : sort.order,
                      directoriesFirst: field === "cmRating" || sort.field === "cmRating" ? true : sort.directoriesFirst,
                    })
                  }}
                >
                  {sortFields.map((field) => (
                    <DropdownMenuRadioItem key={field} value={field}>{sortLabels[field]}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onUpdateSort({ ...sort, order: sort.order === "asc" ? "desc" : "asc" })}
                >
                  {sort.order === "asc" ? <ArrowDown /> : <ArrowUp />}
                  {sort.order === "asc" ? "切换为降序" : "切换为升序"}
                </DropdownMenuItem>
                {canSortPreference ? (
                  <DropdownMenuItem
                    onSelect={() => onUpdateSortPreference({ action: "temporary", enabled: !sortTemporary })}
                  >
                    {sortTemporary ? <Unlock /> : <Lock />}
                    {sortTemporary ? "取消临时排序" : "锁定当前目录排序"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <ToolbarIconButton
            label="搜索文件"
            disabled={!currentPath || busy}
            active={searchOpen}
            onClick={onToggleSearch}
          >
            <Search />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="文件树"
            disabled={!currentPath || busy || !canTree}
            active={treeOpen}
            onClick={onToggleTree}
          >
            <ListTree />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={penetration.enabled ? "关闭穿透模式" : "开启穿透模式"}
            disabled={!currentPath || busy}
            active={penetration.enabled}
            onClick={() => onTogglePenetration(!penetration.enabled)}
          >
            <Layers3 />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={multiSelectMode ? "退出多选" : "多选模式"}
            disabled={!currentPath || busy}
            active={multiSelectMode}
            onClick={onToggleMultiSelect}
          >
            <CheckSquare />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={`删除模式（${deleteStrategy === "trash" ? "回收站" : "永久删除"}，右键切换策略）`}
            disabled={!currentPath || busy}
            active={deleteMode}
            onClick={onToggleDeleteMode}
            onContextMenu={(event) => {
              event.preventDefault()
              if (!busy) onToggleDeleteStrategy()
            }}
          >
            <Trash2 />
          </ToolbarIconButton>
          {thumbnailRefreshPending ? (
            <ToolbarIconButton
              label="取消缩略图重载"
              disabled={busy}
              active
              onClick={onCancelThumbnailRefresh}
            >
              <RefreshCw className="animate-spin" />
            </ToolbarIconButton>
          ) : null}
        </div>

      <div className="flex shrink-0 items-center gap-0.5 border-l pl-0.5" data-folder-toolbar-group="more">
        <FolderMegaMenu
          disabled={disabled}
          busy={busy}
          currentPath={currentPath}
          viewMode={viewMode}
          contentWidthPercent={contentWidthPercent}
          thumbnailWidthPercent={thumbnailWidthPercent}
          bannerWidthPercent={bannerWidthPercent}
          hoverPreviewEnabled={hoverPreviewEnabled}
          hoverPreviewDelayMs={hoverPreviewDelayMs}
          canFilter={canFilter}
          typeFilter={typeFilter}
          filterOptions={filterOptions}
          showHiddenFolders={showHiddenFolders}
          hideMissingEfuEntries={hideMissingEfuEntries}
          canHideMissingEfuEntries={canHideMissingEfuEntries}
          tagDisplay={tagDisplay}
          titleWrap={titleWrap}
          penetration={penetration}
          treeLayout={treeLayout}
          canTree={canTree}
          inlineTreeOpen={inlineTreeOpen}
          confirmations={confirmations}
          emptyArea={emptyArea}
          thumbnailRefreshPending={thumbnailRefreshPending}
          canRefreshThumbnails={canRefreshThumbnails}
          canRefreshSelectedThumbnails={canRefreshSelectedThumbnails}
          thumbsEnabled={thumbsEnabled}
          canImportEfu={canImportEfu}
          sort={sort}
          sortSource={sortSource}
          canSortPreference={canSortPreference}
          sortSourceLabels={sortSourceLabels}
          onChangeTypeFilter={onChangeTypeFilter}
          onChangeShowHiddenFolders={onChangeShowHiddenFolders}
          onChangeHideMissingEfuEntries={onChangeHideMissingEfuEntries}
          onTagDisplayChange={onTagDisplayChange}
          onTitleWrapChange={onTitleWrapChange}
          onOpenPenetrationSettings={() => setPenetrationSettingsOpen(true)}
          onTreeLayoutChange={onTreeLayoutChange}
          onToggleInlineTree={onToggleInlineTree}
          onCommitHoverPreviewEnabled={onCommitHoverPreviewEnabled}
          onCommitHoverPreviewDelay={onCommitHoverPreviewDelay}
          onContentWidthChange={onContentWidthChange}
          onCommitContentWidth={onCommitContentWidth}
          onThumbnailWidthChange={onThumbnailWidthChange}
          onCommitThumbnailWidth={onCommitThumbnailWidth}
          onBannerWidthChange={onBannerWidthChange}
          onCommitBannerWidth={onCommitBannerWidth}
          onConfirmationChange={onConfirmationChange}
          onEmptyAreaChange={onEmptyAreaChange}
          onUpdateSortPreference={onUpdateSortPreference}
          onRefreshVisibleThumbnails={onRefreshVisibleThumbnails}
          onRefreshSelectedThumbnails={onRefreshSelectedThumbnails}
          onCancelThumbnailRefresh={onCancelThumbnailRefresh}
          onImportEfu={onImportEfu}
          dislikedTrashMenuItem={dislikedTrashMenuItem}
        />
      </div>
      </div>
      <Dialog open={penetrationSettingsOpen} onOpenChange={setPenetrationSettingsOpen}>
        <DialogContent className="max-w-sm" data-folder-penetration-settings="true">
          <DialogHeader>
            <DialogTitle>穿透设置</DialogTitle>
          </DialogHeader>
          <FieldGroup className="gap-5">
            <Field orientation="horizontal">
              <FieldLabel htmlFor="folder-penetration-enabled">启用穿透模式</FieldLabel>
              <Switch
                id="folder-penetration-enabled"
                aria-label="启用穿透模式"
                checked={penetration.enabled}
                disabled={busy}
                onCheckedChange={onTogglePenetration}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="folder-penetration-expand-branches-inline">分支文件夹就地展开</FieldLabel>
              <Switch
                id="folder-penetration-expand-branches-inline"
                aria-label="分支文件夹就地展开"
                checked={penetration.expandBranchesInline}
                disabled={busy || !penetration.enabled}
                onCheckedChange={(expandBranchesInline) => onUpdatePenetration({ expandBranchesInline })}
              />
            </Field>
            <FolderInlineBranchLimitFields busy={busy} penetration={penetration} onUpdate={onUpdatePenetration} />
            <Field orientation="horizontal">
              <FieldLabel htmlFor="folder-penetration-show-internal-files">显示内部条目</FieldLabel>
              <Switch
                id="folder-penetration-show-internal-files"
                aria-label="显示内部条目"
                checked={penetration.showInternalFiles}
                disabled={busy}
                onCheckedChange={(showInternalFiles) => onUpdatePenetration({ showInternalFiles })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="folder-penetration-internal-items-mode">内部条目显示</FieldLabel>
              <Select value={penetration.internalItemsMode} disabled={busy} onValueChange={(internalItemsMode: "single" | "all") => onUpdatePenetration({ internalItemsMode })}>
                <SelectTrigger id="folder-penetration-internal-items-mode" className="w-full" aria-label="内部条目显示"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="single">单个</SelectItem><SelectItem value="all">全部</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="folder-penetration-depth">最大穿透层数</FieldLabel>
              <Select
                value={String(penetration.maxDepth)}
                disabled={busy}
                onValueChange={(value) => onUpdatePenetration({ maxDepth: Number(value) })}
              >
                <SelectTrigger id="folder-penetration-depth" className="w-full" aria-label="最大穿透层数">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PENETRATION_DEPTH_OPTIONS.map((depth) => (
                      <SelectItem key={depth} value={String(depth)}>{depth === 32 ? "32 层（安全上限）" : `${depth} 层`}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <FieldSet className="gap-2">
              <FieldLegend variant="label">可直接作为书籍打开</FieldLegend>
              {PENETRATION_TARGET_OPTIONS.map(({ value, label }) => {
                const checked = penetration.terminalTargets.includes(value)
                return (
                  <Field key={value} orientation="horizontal" className="h-9 rounded-md border px-3">
                    <FieldLabel htmlFor={`folder-penetration-target-${value}`}>{label}</FieldLabel>
                    <Switch
                      id={`folder-penetration-target-${value}`}
                      aria-label={label}
                      checked={checked}
                      disabled={busy || (checked && penetration.terminalTargets.length === 1)}
                      onCheckedChange={(nextChecked) => {
                        const next = nextChecked
                          ? [...penetration.terminalTargets, value]
                          : penetration.terminalTargets.filter((target) => target !== value)
                        if (next.length) onUpdatePenetration({ terminalTargets: next })
                      }}
                    />
                  </Field>
                )
              })}
            </FieldSet>
          </FieldGroup>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const PENETRATION_DEPTH_OPTIONS = [1, 2, 3, 5, 10, 32] as const

const PENETRATION_TARGET_OPTIONS: readonly { value: ReaderFolderPenetrationConfig["terminalTargets"][number]; label: string }[] = [
  { value: "archive", label: "压缩包" },
  { value: "document", label: "文档" },
  { value: "media-directory", label: "图片与媒体目录" },
  { value: "file", label: "其他可读文件" },
]

/** 5-way navigation pad (back / forward / up / home / refresh). */
function FolderNavigationPad({
  canGoBack,
  canGoForward,
  canGoUp,
  busy,
  loading,
  homePath,
  currentPath,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
  onGoHome,
  onSetHome,
  onRefresh,
}: Pick<FolderToolbarProps,
  | "canGoBack"
  | "canGoForward"
  | "canGoUp"
  | "loading"
  | "homePath"
  | "currentPath"
  | "onNavigateBack"
  | "onNavigateForward"
  | "onNavigateUp"
  | "onGoHome"
  | "onSetHome"
  | "onRefresh"
> & { busy: boolean }) {
  return (
    <div
      className="relative size-8 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted/30 shadow-xs focus-within:ring-2 focus-within:ring-ring/50"
      role="group"
      aria-label="文件夹导航"
      data-folder-navigation-pad="true"
      data-folder-navigation-pad-mode="five-way"
    >
      <NavigationPadButton position="left" label="后退" disabled={!canGoBack || busy} onClick={onNavigateBack} />
      <NavigationPadButton position="right" label="前进" disabled={!canGoForward || busy} onClick={onNavigateForward} />
      <NavigationPadButton position="up" label="上级" disabled={!canGoUp || busy} onClick={onNavigateUp} />
      <NavigationPadButton
        position="down"
        label="主页（单击返回主页，右键设置当前路径为主页）"
        disabled={!currentPath || busy}
        clickDisabled={!homePath}
        active={Boolean(currentPath && homePath && currentPath === homePath)}
        onClick={onGoHome}
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (currentPath && !busy && currentPath !== homePath) onSetHome()
        }}
      />
      <NavigationPadButton position="center" label="刷新" disabled={!currentPath || busy} onClick={onRefresh} />
      <div className="pointer-events-none absolute inset-0 z-[3] text-foreground" aria-hidden="true">
        <ChevronLeft className={`absolute left-0.5 top-1/2 size-2 -translate-y-1/2 ${!canGoBack || busy ? "opacity-25" : ""}`} />
        <ChevronRight className={`absolute right-0.5 top-1/2 size-2 -translate-y-1/2 ${!canGoForward || busy ? "opacity-25" : ""}`} />
        <ChevronUp className={`absolute left-1/2 top-0.5 size-2 -translate-x-1/2 ${!canGoUp || busy ? "opacity-25" : ""}`} />
        <span
          className={`absolute bottom-1 left-1/2 h-0.5 w-2 -translate-x-1/2 rounded-full ${currentPath && homePath && currentPath === homePath ? "bg-primary-foreground" : "bg-current"} ${!currentPath || busy || !homePath ? "opacity-25" : ""}`}
        />
        <span
          className={`absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ${loading ? "animate-pulse" : ""} ${!currentPath || busy ? "opacity-25" : ""}`}
        />
      </div>
    </div>
  )
}

const NAVIGATION_PAD_POSITION_CLASSES = {
  left: "z-[1] [clip-path:polygon(0_0,40%_30%,40%_70%,0_100%)]",
  right: "z-[1] [clip-path:polygon(100%_0,60%_30%,60%_70%,100%_100%)]",
  up: "z-[1] [clip-path:polygon(0_0,100%_0,70%_40%,30%_40%)]",
  down: "z-[1] [clip-path:polygon(30%_60%,70%_60%,100%_100%,0_100%)]",
  center: "z-[2] m-auto size-3.5 rounded-full border border-border/70 bg-background p-0 shadow-sm hover:bg-accent",
} as const

function NavigationPadButton({
  position,
  label,
  disabled = false,
  clickDisabled = false,
  active = false,
  onClick,
  onContextMenu,
}: {
  position: keyof typeof NAVIGATION_PAD_POSITION_CLASSES
  label: string
  disabled?: boolean
  clickDisabled?: boolean
  active?: boolean
  onClick(): void
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant={active ? "default" : "ghost"}
      className={`absolute inset-0 size-full min-w-0 rounded-none p-0 [&_svg]:size-2.5 ${NAVIGATION_PAD_POSITION_CLASSES[position]}`}
      aria-label={label}
      title={label}
      aria-disabled={disabled || clickDisabled}
      aria-pressed={active || undefined}
      disabled={disabled}
      data-navigation-pad-position={position}
      onClick={() => {
        if (!clickDisabled) onClick()
      }}
      onContextMenu={onContextMenu}
    />
  )
}

function ToolbarDivider() {
  return <div className="mx-0.5 h-4 w-px shrink-0 bg-border/70" aria-hidden="true" />
}

function ToolbarIconButton({
  label,
  disabled = false,
  clickDisabled = false,
  active = false,
  onClick,
  onContextMenu,
  children,
}: {
  label: string
  disabled?: boolean
  clickDisabled?: boolean
  active?: boolean
  onClick(): void
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant={active ? "default" : "ghost"}
      aria-label={label}
      title={label}
      aria-disabled={disabled || clickDisabled}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={() => {
        if (!clickDisabled) onClick()
      }}
      onContextMenu={onContextMenu}
    >
      {children}
    </Button>
  )
}
