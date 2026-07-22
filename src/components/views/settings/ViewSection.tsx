import { Box, Grid, MousePointerClick } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ChoiceControlField } from "@/components/ui/choice-control"
import {
  CHOICE_CONTROL_STYLES,
  FIELD_TITLE_STYLES,
  type ChoiceControlStyle,
  type FieldTitleStyle,
} from "@/components/ui/choice-control-variants"
import { ModulePanel } from "@/components/ui/module-panel"
import {
  MODULE_CARD_EFFECTS,
  MODULE_PANEL_STYLES,
  MODULE_TITLE_STYLES,
  RESIZABLE_HANDLE_STYLES,
  type ModuleCardEffect,
  type ModulePanelStyle,
  type ModuleTitleStyle,
  type ResizableHandleStyle,
} from "@/components/ui/module-panel-variants"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TAB_DISPLAY_STYLES, type TabDisplayStyle } from "@/components/ui/tabs-variants"
import { SWITCH_DISPLAY_STYLES, type SwitchDisplayStyle } from "@/components/ui/switch-variants"
import { SCROLLBAR_DISPLAY_STYLES, type ScrollbarDisplayStyle } from "@/components/ui/scrollbar-variants"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SwimlaneInteractionSettings } from "@/components/workspace/swimlane/SwimlaneInteractionSettings"
import { normalizeSwimlanePreferences } from "@/components/workspace/swimlane/model"
import { useWorkspaceActions, useWorkspaceShallowSelector } from "@/store/workspaceStore"
import { PreferenceToggle, SettingsStepCard } from "./primitives"

export function ViewSection() {
  const { t } = useTranslation()
  const workspaceActions = useWorkspaceActions()
  const state = useWorkspaceShallowSelector((workspace) => ({
    activeWorkspaceId: workspace.activeWorkspaceId,
    laneWorkspacePreferences: workspace.laneWorkspacePreferences,
    cardClickAction: workspace.cardClickAction,
    cardDoubleClickAction: workspace.cardDoubleClickAction,
    tabDisplayStyle: workspace.tabDisplayStyle,
    switchDisplayStyle: workspace.switchDisplayStyle,
    scrollbarDisplayStyle: workspace.scrollbarDisplayStyle,
    choiceControlStyle: workspace.choiceControlStyle,
    fieldTitleStyle: workspace.fieldTitleStyle,
    moduleTitleStyle: workspace.moduleTitleStyle,
    modulePanelStyle: workspace.modulePanelStyle,
    moduleCardEffect: workspace.moduleCardEffect,
    resizableHandleStyle: workspace.resizableHandleStyle,
  }))
  const lanePreferences = normalizeSwimlanePreferences(state.laneWorkspacePreferences[state.activeWorkspaceId])

  return (
    <div className="space-y-3">
      <SettingsStepCard
        id="swimlane"
        title={t("settings:timeline.steps.swimlane")}
        description={t("settings:timeline.stepDesc.swimlane")}
        icon={Grid}
        delay={0.02}
      >
        <div className="space-y-3">
          <SwimlaneInteractionSettings
            value={{
              soloOnFocus: lanePreferences.soloOnFocus,
              showNavigatorInSolo: lanePreferences.showNavigatorInSolo,
              edgeRevealDelayMs: lanePreferences.edgeRevealDelayMs,
              focusOnHover: lanePreferences.focusOnHover,
              focusDelayMs: lanePreferences.focusDelayMs,
            }}
            labels={{
              soloOnFocus: "主泳道聚焦时自动独占",
              showNavigatorInSolo: "独占时显示泳道切换栏",
              focusOnHover: "启用主泳道悬停重新聚焦",
              focusDelay: "主泳道悬停重新聚焦延迟",
            }}
            onChange={(patch) => workspaceActions.patchLaneWorkspacePreferences(state.activeWorkspaceId, patch)}
          />
          <label className="mt-1 flex min-h-11 items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-2 text-sm">
            <span>固定栏跟随聚焦泳道</span>
            <Switch
              checked={lanePreferences.navigatorFollowsFocus}
              onCheckedChange={(navigatorFollowsFocus) =>
                workspaceActions.patchLaneWorkspacePreferences(state.activeWorkspaceId, {
                  navigatorFollowsFocus,
                  ...(navigatorFollowsFocus ? { navigatorLaneId: lanePreferences.activeLaneId } : {}),
                })
              }
            />
          </label>
        </div>
      </SettingsStepCard>

      <SettingsStepCard
        id="components"
        title={t("settings:view.componentDisplay.title", "Component display")}
        description={t(
          "settings:view.componentDisplay.description",
          "Choose a shared visual treatment for tab navigation. It changes appearance only; tab semantics and keyboard behavior remain Radix Tabs.",
        )}
        icon={Box}
        delay={0.06}
      >
        <div className="space-y-4">
          <ToggleGroup
            type="single"
            value={state.tabDisplayStyle}
            onValueChange={(value) => value && workspaceActions.setTabDisplayStyle(value as TabDisplayStyle)}
            variant="outline"
            size="sm"
            className="grid w-full grid-cols-2 gap-1.5 @sm:grid-cols-5"
            spacing={2}
          >
            {TAB_DISPLAY_STYLES.map((style) => (
              <ToggleGroupItem key={style} value={style} className="min-w-0 px-2 text-[11px]">
                {t(`settings:view.componentDisplay.styles.${style}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Tabs defaultValue="preview" className="gap-2 rounded-md border bg-muted/15 p-2">
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="preview">{t("settings:view.componentDisplay.preview", "Preview")}</TabsTrigger>
              <TabsTrigger value="history">{t("settings:view.componentDisplay.history", "History")}</TabsTrigger>
              <TabsTrigger value="details">{t("settings:view.componentDisplay.details", "Details")}</TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="px-1 text-xs text-muted-foreground">
              {t("settings:view.componentDisplay.previewHint", "This is the same shared component used by node result tabs.")}
            </TabsContent>
            <TabsContent value="history" className="px-1 text-xs text-muted-foreground">
              {t("settings:view.componentDisplay.historyHint", "Changing the display type never changes tab content or actions.")}
            </TabsContent>
            <TabsContent value="details" className="px-1 text-xs text-muted-foreground">
              {t("settings:view.componentDisplay.detailsHint", "Other component preferences can be added here without changing node implementations.")}
            </TabsContent>
          </Tabs>

          <div className="space-y-2 pt-1">
            <div>
              <p className="text-xs font-medium">{t("settings:view.componentDisplay.switches.title", "Switches")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t(
                  "settings:view.componentDisplay.switches.description",
                  "The outlined default keeps an unchecked switch visible on every theme.",
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                value={state.switchDisplayStyle}
                onValueChange={(value) => value && workspaceActions.setSwitchDisplayStyle(value as SwitchDisplayStyle)}
                variant="outline"
                size="sm"
                spacing={2}
              >
                {SWITCH_DISPLAY_STYLES.map((style) => (
                  <ToggleGroupItem key={style} value={style} className="px-2 text-[11px]">
                    {t(`settings:view.componentDisplay.switches.styles.${style}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{t("settings:view.componentDisplay.switches.preview", "Off")}</span>
                <Switch
                  checked={false}
                  aria-label={t("settings:view.componentDisplay.switches.preview", "Off")}
                  onCheckedChange={() => undefined}
                />
                <Switch
                  checked
                  aria-label={t("settings:view.componentDisplay.switches.previewOn", "On")}
                  onCheckedChange={() => undefined}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <div>
              <p className="text-xs font-medium">{t("settings:view.componentDisplay.scrollbars.title", "Scrollbars")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t(
                  "settings:view.componentDisplay.scrollbars.description",
                  "One shared treatment for native overflow regions and ScrollArea across every node surface.",
                )}
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={state.scrollbarDisplayStyle}
              onValueChange={(value) => value && workspaceActions.setScrollbarDisplayStyle(value as ScrollbarDisplayStyle)}
              variant="outline"
              size="sm"
              className="grid w-full grid-cols-2 gap-1.5 @sm:grid-cols-5"
              spacing={2}
            >
              {SCROLLBAR_DISPLAY_STYLES.map((style) => (
                <ToggleGroupItem key={style} value={style} className="min-w-0 px-2 text-[11px]">
                  {t(`settings:view.componentDisplay.scrollbars.styles.${style}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div
              className="h-24 overflow-auto rounded-md border bg-muted/15 p-2"
              data-testid="scrollbar-style-preview"
            >
              <div className="space-y-1.5 text-[11px] leading-5 text-muted-foreground">
                <p>{t("settings:view.componentDisplay.scrollbars.previewHint", "Scroll this preview to inspect the active scrollbar treatment.")}</p>
                {Array.from({ length: 12 }, (_, index) => (
                  <p key={index}>
                    {t("settings:view.componentDisplay.scrollbars.previewLine", "Shared scrollbar line {{n}}", {
                      n: index + 1,
                    })}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium">{t("settings:timeline.fieldsTitle")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("settings:timeline.fieldsDesc")}</p>
            </div>
            <PreferenceToggle
              label={t("settings:timeline.controlStyle")}
              value={state.choiceControlStyle}
              values={CHOICE_CONTROL_STYLES}
              labels={{
                segmented: t("settings:timeline.choice.segmented"),
                pills: t("settings:timeline.choice.pills"),
                tabs: t("settings:timeline.choice.tabs"),
                tiles: t("settings:timeline.choice.tiles"),
              }}
              onChange={(value) => workspaceActions.setChoiceControlStyle(value as ChoiceControlStyle)}
            />
            <PreferenceToggle
              label={t("settings:timeline.fieldTitleStyle")}
              value={state.fieldTitleStyle}
              values={FIELD_TITLE_STYLES}
              labels={{
                stacked: t("settings:timeline.fieldTitle.stacked"),
                legend: t("settings:timeline.fieldTitle.legend"),
                inline: t("settings:timeline.fieldTitle.inline"),
                hidden: t("settings:timeline.fieldTitle.hidden"),
              }}
              onChange={(value) => workspaceActions.setFieldTitleStyle(value as FieldTitleStyle)}
            />
            <ChoiceControlField label={t("settings:timeline.compressionPreview")}>
              <ToggleGroup
                aria-label={t("settings:timeline.compressionPreview")}
                className="grid w-full grid-cols-2"
                type="single"
                value="lossless"
                onValueChange={() => undefined}
                size="sm"
              >
                <ToggleGroupItem value="lossless">{t("settings:timeline.lossless")}</ToggleGroupItem>
                <ToggleGroupItem value="lossy">{t("settings:timeline.lossy")}</ToggleGroupItem>
              </ToggleGroup>
            </ChoiceControlField>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium">{t("settings:timeline.modulePanelTitle")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t("settings:timeline.modulePanelDesc")}</p>
            </div>
            <PreferenceToggle
              label={t("settings:timeline.moduleTitleStyle")}
              value={state.moduleTitleStyle}
              values={MODULE_TITLE_STYLES}
              labels={{
                legend: t("settings:timeline.moduleTitle.legend"),
                inline: t("settings:timeline.moduleTitle.inline"),
                bar: t("settings:timeline.moduleTitle.bar"),
                minimal: t("settings:timeline.moduleTitle.minimal"),
              }}
              onChange={(value) => workspaceActions.setModuleTitleStyle(value as ModuleTitleStyle)}
            />
            <PreferenceToggle
              label={t("settings:timeline.modulePanelStyle")}
              value={state.modulePanelStyle}
              values={MODULE_PANEL_STYLES}
              labels={{
                soft: t("settings:timeline.modulePanel.soft"),
                solid: t("settings:timeline.modulePanel.solid"),
                outline: t("settings:timeline.modulePanel.outline"),
                flat: t("settings:timeline.modulePanel.flat"),
              }}
              onChange={(value) => workspaceActions.setModulePanelStyle(value as ModulePanelStyle)}
            />
            <PreferenceToggle
              label={t("settings:timeline.moduleCardEffect")}
              value={state.moduleCardEffect}
              values={MODULE_CARD_EFFECTS}
              labels={{
                magic: t("settings:timeline.moduleCard.magic"),
                plain: t("settings:timeline.moduleCard.plain"),
              }}
              onChange={(value) => workspaceActions.setModuleCardEffect(value as ModuleCardEffect)}
            />
            <PreferenceToggle
              label={t("settings:timeline.resizableHandle")}
              value={state.resizableHandleStyle}
              values={RESIZABLE_HANDLE_STYLES}
              labels={{
                grip: t("settings:timeline.handle.grip"),
                dots: t("settings:timeline.handle.dots"),
                line: t("settings:timeline.handle.line"),
                minimal: t("settings:timeline.handle.minimal"),
              }}
              onChange={(value) => workspaceActions.setResizableHandleStyle(value as ResizableHandleStyle)}
            />
            <ModulePanel title={t("settings:timeline.previewModule")} badge={t("settings:timeline.previewBadge")} icon={Box}>
              <p className="text-xs text-muted-foreground">{t("settings:timeline.previewModuleDesc")}</p>
            </ModulePanel>
          </div>
        </div>
      </SettingsStepCard>

      <SettingsStepCard
        id="card-interaction"
        title={t("settings:view.cardInteraction")}
        description={t("settings:view.cardInteractionDesc")}
        icon={MousePointerClick}
        delay={0.1}
      >
        <div className="space-y-3">
          <div>
            <div className="mb-2 text-xs font-medium">{t("settings:view.clickAction")}</div>
            <ToggleGroup
              type="single"
              value={state.cardClickAction}
              onValueChange={(v) => v && workspaceActions.setCardClickAction(v as "none" | "focus" | "fullscreen")}
              variant="outline"
              size="sm"
              className="grid w-full grid-cols-3 gap-1"
            >
              <ToggleGroupItem value="none" className="text-xs">{t("settings:view.action.none")}</ToggleGroupItem>
              <ToggleGroupItem value="focus" className="text-xs">{t("settings:view.action.focus")}</ToggleGroupItem>
              <ToggleGroupItem value="fullscreen" className="text-xs">{t("settings:view.action.fullscreen")}</ToggleGroupItem>
            </ToggleGroup>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{t("settings:view.clickActionDesc")}</p>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium">{t("settings:view.doubleClickAction")}</div>
            <ToggleGroup
              type="single"
              value={state.cardDoubleClickAction}
              onValueChange={(v) => v && workspaceActions.setCardDoubleClickAction(v as "none" | "focus" | "fullscreen")}
              variant="outline"
              size="sm"
              className="grid w-full grid-cols-3 gap-1"
            >
              <ToggleGroupItem value="none" className="text-xs">{t("settings:view.action.none")}</ToggleGroupItem>
              <ToggleGroupItem value="focus" className="text-xs">{t("settings:view.action.focus")}</ToggleGroupItem>
              <ToggleGroupItem value="fullscreen" className="text-xs">{t("settings:view.action.fullscreen")}</ToggleGroupItem>
            </ToggleGroup>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{t("settings:view.doubleClickActionDesc")}</p>
          </div>
        </div>
      </SettingsStepCard>
    </div>
  )
}
