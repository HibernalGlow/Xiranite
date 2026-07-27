import { AlertTriangle, ArchiveX, AudioLines, Copy, Ellipsis, FileQuestion, FileText, FileX2, FolderOpen, FolderSearch2, FolderX, HardDrive, Image, Link2Off, Maximize2, Minimize2, PanelLeft, PanelLeftClose, PanelLeftOpen, PanelRight, PanelRightClose, PanelRightOpen, PanelTopOpen, Play, RotateCcw, Save, Search, Settings2, TableProperties, Trash2, Video, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CzkawkaAnalysisView } from "../analysis-panel"
import { CzkawkaCardTabs } from "../card-layout"
import { CzkawkaFilterPanel } from "../filter-panel"
import { CzkawkaResultTable } from "../result-table"
import { CzkawkaSimilarFoldersView } from "../similar-folders-view"
import { CzkawkaDirectoryEditor, CzkawkaTokenEditor } from "../source-inputs"
import type { CzkawkaCardState } from "../types"
import { getCzkawkaGuiToolOptions, type CzkawkaOptionDefinition } from "@xiranite/node-czkawka/tool-options"
import { updateCzkawkaWorkspaceLayout } from "@xiranite/node-czkawka/workspace-layout"
import { formatBytes, type CzkawkaView } from "./model"
import { CzkawkaCardContent, Field, Metric, SectionHeader, SwitchLine } from "./CzkawkaCardsView"

function SourcePanel(props: CzkawkaView) {
  return (
    <section className="flex min-h-0 flex-col rounded-md border bg-card">
      <SectionHeader
        icon={FolderSearch2}
        title={props.t("sections.conditions", "扫描条件")}
        action={
          props.canResizeWorkspace ? (
            <Button
              aria-label={props.t("workspace.minimizeConditions", "最小化扫描条件")}
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                props.setWorkspaceLayout(
                  updateCzkawkaWorkspaceLayout(props.workspaceLayout, {
                    sourcePanelMinimized: true
                  })
                )
              }
            >
              <PanelLeftClose />
            </Button>
          ) : null
        }
      />
      <CzkawkaCardTabs activeId={props.data.sourcePanelTab} layout={props.cardLayout} panel="source" onActiveChange={(sourcePanelTab) => props.patch({ sourcePanelTab })} renderCard={(id) => <CzkawkaCardContent id={id} props={props} />} />
    </section>
  )
}

function AlgorithmFields(props: CzkawkaView) {
  return (
    <div className="grid gap-2">
      {getCzkawkaGuiToolOptions(props.tool, props.nativeCapabilities).map((definition) => (
        <SchemaOptionField key={definition.id} definition={definition} {...props} />
      ))}
    </div>
  )
}

function SchemaOptionField({ data, definition, patch, language }: CzkawkaView & { definition: CzkawkaOptionDefinition }) {
  const value = data[definition.id as keyof CzkawkaCardState] ?? definition.defaultValue
  const label = definition.label[language]
  if (definition.kind === "boolean") return <SwitchLine label={label} checked={Boolean(value)} onChange={(checked) => patch({ [definition.id]: checked } as Partial<CzkawkaCardState>)} />
  if (definition.kind === "number")
    return (
      <Field label={label}>
        <Input
          type="number"
          min={definition.min}
          max={definition.max}
          step={definition.step}
          value={String(value)}
          onChange={(event) =>
            patch({
              [definition.id]: event.currentTarget.value
            } as Partial<CzkawkaCardState>)
          }
        />
      </Field>
    )
  if (definition.kind === "text")
    return (
      <Field label={label}>
        <Input
          aria-label={label}
          value={String(value)}
          onChange={(event) => patch({ [definition.id]: event.currentTarget.value } as Partial<CzkawkaCardState>)}
        />
      </Field>
    )
  return (
    <Field label={label}>
      <Select value={String(value)} onValueChange={(next) => patch({ [definition.id]: next } as Partial<CzkawkaCardState>)}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {definition.choices?.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label ?? choice.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function ResultTable(props: CzkawkaView) {
  const imageComparison = props.tool === "similar-images" ? {
    groups: props.result?.groups ?? [],
    state: props.imageComparison,
    open: props.openImageComparison,
    close: props.closeImageComparison,
    setMode: props.setImageComparisonMode,
    setColorCoding: props.setImageComparisonColorCoding,
    setTarget: props.setImageComparisonTarget,
    setSwipe: props.setImageComparisonSwipe,
    setOpacity: props.setImageComparisonOpacity,
  } : undefined
  const table = <CzkawkaResultTable tool={props.tool} groups={props.filterResult.groups} running={props.running} phase={props.data.phase} statusMessage={props.data.progressText} filterText={props.filterText} externalFiltering selectedPaths={props.selectedPaths} musicCheckType={props.data.musicCheckType} musicMaximumDifference={props.data.musicMaximumDifference} musicMinimumFragmentDuration={props.data.musicMinimumFragmentDuration} musicCompareFingerprintsOnlyWithSimilarTitles={props.data.musicCompareFingerprintsOnlyWithSimilarTitles} previewPanelEnabled={props.previewPanelEnabled} thumbnailEnabled={props.thumbnailEnabled} reversePathDisplay={props.data.reversePathDisplay} wrapText={props.data.tableWrapText} getFileUrl={props.getFileUrl} imageComparison={imageComparison} onCopyText={props.copyText} onCopyFiles={props.copyFiles} onOpenPath={props.openPath} onRevealPath={props.revealPath} onFilterTextChange={props.setFilterText} onPreviewPanelEnabledChange={props.setPreviewPanelEnabled} onRetry={props.executeScan} onSelectionChange={props.setSelectedPaths} />
  if (props.tool !== "similar-images") return table
  return <div className="flex min-h-0 min-w-0 flex-col gap-1"><Tabs value={props.similarImagesViewMode} onValueChange={(value) => props.setSimilarImagesViewMode(value as CzkawkaSimilarImagesViewMode)}><TabsList className="grid w-52 grid-cols-2"><TabsTrigger value="images">{props.t("views.images", "图片")}</TabsTrigger><TabsTrigger value="folders">{props.t("views.folders", "文件夹")} <Badge variant="outline">{props.result?.similarFolders?.length ?? 0}</Badge></TabsTrigger></TabsList></Tabs><div className="min-h-0 min-w-0 flex-1 overflow-hidden">{props.similarImagesViewMode === "folders" ? <CzkawkaSimilarFoldersView folders={props.result?.similarFolders ?? []} filterText={props.filterText} getFileUrl={props.getFileUrl} onCopyText={props.copyText} onOpenPath={props.openPath} onRevealPath={props.revealPath} /> : table}</div></div>
}

function AnalysisPanel(props: CzkawkaView) {
  const stats = props.result
  return (
    <section className="flex min-h-0 flex-col rounded-md border bg-card">
      <SectionHeader
        icon={Search}
        title={props.t("sections.analysisOperations", "分析与操作")}
        action={
          props.canResizeWorkspace ? (
            <Button
              aria-label={props.t("workspace.minimizeAnalysis", "最小化分析与操作")}
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                props.setWorkspaceLayout(
                  updateCzkawkaWorkspaceLayout(props.workspaceLayout, {
                    analysisPanelMinimized: true
                  })
                )
              }
            >
              <PanelRightClose />
            </Button>
          ) : null
        }
      />
      <div className="grid grid-cols-2 gap-px border-b bg-border">
        <Metric label={props.t("metrics.files", "文件")} value={String(stats?.fileCount ?? 0)} />
        <Metric label={props.t("metrics.groups", "分组")} value={String(stats?.groupCount ?? 0)} />
        <Metric label={props.t("metrics.totalSize", "总大小")} value={formatBytes(stats?.totalBytes ?? 0)} />
        <Metric label={props.t("metrics.reclaimable", "可回收")} value={formatBytes(stats?.reclaimableBytes ?? 0)} accent />
      </div>
      <CzkawkaCardTabs activeId={props.data.analysisPanelTab} layout={props.cardLayout} panel="analysis" onActiveChange={(analysisPanelTab) => props.patch({ analysisPanelTab })} renderCard={(id) => <CzkawkaCardContent id={id} props={props} />} />
    </section>
  )
}

export { AlgorithmFields, AnalysisPanel, ResultTable, SourcePanel }
