import {
  Circle,
  CircleDot,
  Grid,
  Image,
  PanelBottom,
  PanelRight,
  ToggleLeft,
  RotateCcw,
  Upload,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { useWorkspaceActions, useWorkspaceShallowSelector } from "@/store/workspaceStore"
import { AlphabetIndexSlider, SettingsStepCard } from "./primitives"

export function WorkspaceSection() {
  const { t } = useTranslation()
  const workspaceActions = useWorkspaceActions()
  const state = useWorkspaceShallowSelector((workspace) => ({
    bgMode: workspace.bgMode,
    bgImageUrl: workspace.bgImageUrl,
    bgOpacity: workspace.bgOpacity,
    bgBlur: workspace.bgBlur,
    bgCoverTopBar: workspace.bgCoverTopBar,
    grainEnabled: workspace.grainEnabled,
    chromeVisible: workspace.chromeVisible,
    chromePosition: workspace.chromePosition,
    chromeStyle: workspace.chromeStyle,
    chromeIslandScale: workspace.chromeIslandScale,
    chromeIslandMotion: workspace.chromeIslandMotion,
    chromeIslandDelay: workspace.chromeIslandDelay,
    chromeIslandIdleOffset: workspace.chromeIslandIdleOffset,
    alphabetIndexVisible: workspace.alphabetIndexVisible,
    alphabetIndexOpacity: workspace.alphabetIndexOpacity,
    alphabetIndexStyle: workspace.alphabetIndexStyle,
    alphabetIndexWaveIntensity: workspace.alphabetIndexWaveIntensity,
    restoreWorkspaceComponents: workspace.restoreWorkspaceComponents,
  }))

  return (
    <div className="space-y-3">
      <SettingsStepCard
        id="startup-restore"
        title="启动时恢复节点"
        description="控制应用启动时是否恢复上次工作区中的节点实例。"
        icon={RotateCcw}
        delay={0.01}
      >
        <div className="flex items-center justify-between gap-4 rounded-sm border border-border/40 bg-muted/15 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">自动恢复节点</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              下次启动生效。关闭不会删除已保存节点，也不会关闭当前节点。
            </p>
          </div>
          <Switch
            aria-label="自动恢复节点"
            checked={state.restoreWorkspaceComponents}
            onCheckedChange={workspaceActions.setRestoreWorkspaceComponents}
          />
        </div>
      </SettingsStepCard>

      <SettingsStepCard
        id="background"
        title={t("settings:background.title")}
        description={t("settings:timeline.stepDesc.background")}
        icon={Image}
        delay={0.02}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-mono tracking-widest text-muted-foreground">{t("settings:background.mode")}</p>
            <ToggleGroup
              type="single"
              value={state.bgMode}
              onValueChange={(value) => {
                if (value) workspaceActions.setBgMode(value as typeof state.bgMode)
              }}
              variant="outline"
              size="sm"
              className="grid w-full grid-cols-4 gap-2"
              spacing={2}
            >
              {[
                { key: "grid", label: t("settings:background.modes.grid"), icon: Grid },
                { key: "dot-grid", label: t("settings:background.modes.dot-grid"), icon: CircleDot },
                { key: "image", label: t("settings:background.modes.image"), icon: Image },
                { key: "none", label: t("settings:background.modes.none"), icon: Circle },
              ].map(({ key, label, icon: Icon }) => (
                <ToggleGroupItem
                  key={key}
                  value={key}
                  className="h-16 min-w-0 flex-col gap-1.5 px-2 font-mono text-[10px] text-muted-foreground data-[state=on]:border-primary/50 data-[state=on]:bg-primary/8 data-[state=on]:text-primary"
                >
                  <Icon className="size-4" />
                  <span className="text-center leading-tight">{label}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {state.bgMode === "image" && (
            <div className="space-y-4 border-t border-border/40 pt-2">
              <div className="space-y-2">
                <p className="text-xs font-mono tracking-widest text-muted-foreground">{t("settings:background.uploadImage")}</p>
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    id="bg-file-upload"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = (event) => {
                        const dataUrl = event.target?.result
                        if (typeof dataUrl === "string") workspaceActions.setBgImageUrl(dataUrl)
                      }
                      reader.readAsDataURL(file)
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer font-mono text-xs"
                    onClick={() => document.getElementById("bg-file-upload")?.click()}
                  >
                    <Upload className="mr-1.5 size-3.5" />
                    {t("settings:background.chooseFile")}
                  </Button>
                  {state.bgImageUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer font-mono text-xs hover:text-destructive"
                      onClick={() => workspaceActions.setBgImageUrl("")}
                    >
                      <X className="mr-1.5 size-3.5" />
                      {t("common:clear")}
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-mono tracking-widest text-muted-foreground">{t("settings:background.imageUrl")}</p>
                <input
                  type="text"
                  value={state.bgImageUrl}
                  onChange={(e) => workspaceActions.setBgImageUrl(e.target.value)}
                  placeholder="https://example.com/bg.jpg"
                  className="w-full rounded border border-border bg-muted/20 px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-foreground">{t("settings:background.opacity")}</span>
                  <span className="font-mono text-xs text-muted-foreground">{state.bgOpacity}%</span>
                </div>
                <Slider
                  value={[state.bgOpacity]}
                  onValueChange={([v]) => workspaceActions.setBgOpacity(v)}
                  min={0}
                  max={100}
                  step={5}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-foreground">{t("settings:background.blur")}</span>
                  <span className="font-mono text-xs text-muted-foreground">{state.bgBlur}px</span>
                </div>
                <Slider
                  value={[state.bgBlur]}
                  onValueChange={([v]) => workspaceActions.setBgBlur(v)}
                  min={0}
                  max={30}
                  step={1}
                />
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-mono text-xs text-foreground">{t("settings:background.coverTopBar")}</p>
                    <p className="text-[10px] text-muted-foreground">{t("settings:background.coverTopBarHint")}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 rounded-sm border border-border/50 bg-muted/20 p-0.5">
                    <button
                      type="button"
                      onClick={() => workspaceActions.setBgCoverTopBar(false)}
                      className={cn(
                        "cursor-pointer rounded-sm px-3 py-1 font-mono text-[10px] transition-colors",
                        !state.bgCoverTopBar ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      OFF
                    </button>
                    <button
                      type="button"
                      onClick={() => workspaceActions.setBgCoverTopBar(true)}
                      className={cn(
                        "cursor-pointer rounded-sm px-3 py-1 font-mono text-[10px] transition-colors",
                        state.bgCoverTopBar ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      ON
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-sm border border-border/50 bg-muted/10 p-3">
            <p className="mb-3 text-xs font-semibold text-foreground">{t("settings:texture.title")}</p>
            <div className="ws-canvas-bg flex h-28 items-center justify-center rounded border border-border/40">
              <div className="rounded-sm border border-border bg-card p-3">
                <div className="grid grid-cols-3 gap-1">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="size-3 rounded-sm bg-primary/20" />
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] font-mono tracking-widest text-muted-foreground">
                {t("settings:atmospheric.silkFinish")}
              </span>
              <Badge
                variant={state.grainEnabled ? "default" : "outline"}
                className="cursor-pointer font-mono text-[9px]"
                onClick={() => workspaceActions.setGrain(!state.grainEnabled)}
              >
                {t(state.grainEnabled ? "settings:atmospheric.enabled" : "settings:atmospheric.disabled")}
              </Badge>
            </div>
          </div>
        </div>
      </SettingsStepCard>

      <SettingsStepCard
        id="chrome"
        title={t("settings:chrome.title")}
        description={t("settings:chrome.description")}
        icon={PanelRight}
        delay={0.06}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-sm border border-border/40 bg-muted/15 px-3 py-2">
            <ToggleLeft className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t("settings:chrome.visible")}</p>
              <p className="text-[11px] text-muted-foreground">{t("settings:chrome.visibleDesc")}</p>
            </div>
            <Switch checked={state.chromeVisible} onCheckedChange={(v) => workspaceActions.setChromeVisible(v)} />
          </div>

          <div className={cn("space-y-2 transition-opacity", !state.chromeVisible && "pointer-events-none opacity-40")}>
            <p className="text-xs font-mono tracking-widest text-muted-foreground">{t("settings:chrome.position")}</p>
            <p className="-mt-1 text-[11px] text-muted-foreground">{t("settings:chrome.positionDesc")}</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "left", label: t("settings:chrome.positionLeft"), icon: PanelRight },
                { key: "island", label: t("settings:chrome.positionIsland"), icon: CircleDot },
                { key: "right", label: t("settings:chrome.positionRight"), icon: PanelRight },
              ] as const).map(({ key, label, icon: Icon }) => {
                const isActive = state.chromePosition === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => workspaceActions.setChromePosition(key)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-sm border p-2.5 transition-all",
                      isActive
                        ? "border-primary/50 bg-primary/8 text-primary"
                        : "border-border/40 text-muted-foreground hover:border-border hover:bg-muted/30 hover:text-foreground",
                      key === "left" && "[&>svg]:scale-x-[-1]",
                    )}
                  >
                    <Icon className="size-4" />
                    <span className="text-[11px] font-medium">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <Separator className="opacity-50" />

          <div className={cn("space-y-2 transition-opacity", !state.chromeVisible && "pointer-events-none opacity-40")}>
            <p className="text-xs font-mono tracking-widest text-muted-foreground">{t("settings:chrome.style")}</p>
            <p className="-mt-1 text-[11px] text-muted-foreground">{t("settings:chrome.styleDesc")}</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "default", label: t("settings:chrome.styleDefault"), desc: t("settings:chrome.styleDefaultDesc"), icon: PanelRight },
                { key: "traffic-light", label: t("settings:chrome.styleTrafficLight"), desc: t("settings:chrome.styleTrafficLightDesc"), icon: Circle },
              ] as const).map(({ key, label, desc, icon: Icon }) => {
                const isActive = state.chromeStyle === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => workspaceActions.setChromeStyle(key)}
                    className={cn(
                      "flex min-w-0 items-start gap-2.5 rounded-sm border p-3 text-left transition-all",
                      isActive ? "border-primary/50 bg-primary/8" : "border-border/40 hover:border-border hover:bg-muted/30",
                    )}
                  >
                    <div className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-sm border",
                      isActive ? "border-primary/40 bg-primary/15 text-primary" : "border-border/40 bg-muted/40 text-muted-foreground",
                    )}>
                      {key === "traffic-light" ? (
                        <span className="flex items-center gap-0.5">
                          <span className="size-1.5 rounded-full bg-red-500/80" />
                          <span className="size-1.5 rounded-full bg-yellow-500/80" />
                          <span className="size-1.5 rounded-full bg-emerald-500/80" />
                        </span>
                      ) : (
                        <Icon className="size-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-xs font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>{label}</p>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/75">{desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {state.chromePosition === "island" && (
            <>
              <Separator className="opacity-50" />
              <div className={cn("space-y-4 transition-opacity", !state.chromeVisible && "pointer-events-none opacity-40")}>
                <div>
                  <p className="text-xs font-mono tracking-widest text-muted-foreground">{t("settings:chrome.islandCustom")}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{t("settings:chrome.islandCustomDesc")}</p>
                </div>
                {([
                  { label: t("settings:chrome.islandScale"), value: state.chromeIslandScale, unit: "%", min: 70, max: 120, step: 1, onChange: workspaceActions.setChromeIslandScale },
                  { label: t("settings:chrome.islandMotion"), value: state.chromeIslandMotion, unit: "%", min: 70, max: 150, step: 1, onChange: workspaceActions.setChromeIslandMotion },
                  { label: t("settings:chrome.islandDelay"), value: state.chromeIslandDelay, unit: "ms", min: 0, max: 120, step: 5, onChange: workspaceActions.setChromeIslandDelay },
                  { label: t("settings:chrome.islandIdleOffset"), value: state.chromeIslandIdleOffset, unit: "px", min: -10, max: 4, step: 1, onChange: workspaceActions.setChromeIslandIdleOffset },
                ] as const).map((item) => (
                  <div key={item.label} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-foreground">{item.label}</span>
                      <span className="font-mono text-xs text-muted-foreground">{item.value}{item.unit}</span>
                    </div>
                    <Slider
                      value={[item.value]}
                      onValueChange={([v]) => item.onChange(v)}
                      min={item.min}
                      max={item.max}
                      step={item.step}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </SettingsStepCard>

      <SettingsStepCard
        id="alphabet"
        title={t("settings:alphabetIndex.title")}
        description={t("settings:alphabetIndex.description")}
        icon={PanelBottom}
        delay={0.1}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-sm border border-border/40 bg-muted/15 px-3 py-2">
            <PanelBottom className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t("settings:alphabetIndex.visible")}</p>
              <p className="text-[11px] text-muted-foreground">{t("settings:alphabetIndex.visibleDesc")}</p>
            </div>
            <Switch checked={state.alphabetIndexVisible} onCheckedChange={workspaceActions.setAlphabetIndexVisible} />
          </div>

          <div className={cn("flex flex-col gap-4 transition-opacity", !state.alphabetIndexVisible && "opacity-60")}>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-xs text-foreground">{t("settings:alphabetIndex.style")}</span>
              <ToggleGroup
                type="single"
                value={state.alphabetIndexStyle}
                onValueChange={(value) => value && workspaceActions.setAlphabetIndexStyle(value as typeof state.alphabetIndexStyle)}
                variant="outline"
                size="sm"
                className="grid w-full grid-cols-3 gap-2"
                spacing={2}
              >
                <ToggleGroupItem value="glass" className="text-[11px]">{t("settings:alphabetIndex.styles.glass")}</ToggleGroupItem>
                <ToggleGroupItem value="solid" className="text-[11px]">{t("settings:alphabetIndex.styles.solid")}</ToggleGroupItem>
                <ToggleGroupItem value="minimal" className="text-[11px]">{t("settings:alphabetIndex.styles.minimal")}</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <AlphabetIndexSlider
              label={t("settings:alphabetIndex.opacity")}
              value={`${state.alphabetIndexOpacity}%`}
              min={35}
              max={100}
              current={state.alphabetIndexOpacity}
              onValueChange={workspaceActions.setAlphabetIndexOpacity}
            />
            <AlphabetIndexSlider
              label={t("settings:alphabetIndex.wave")}
              value={`${state.alphabetIndexWaveIntensity}%`}
              min={0}
              max={100}
              current={state.alphabetIndexWaveIntensity}
              onValueChange={workspaceActions.setAlphabetIndexWaveIntensity}
            />
          </div>
        </div>
      </SettingsStepCard>
    </div>
  )
}
