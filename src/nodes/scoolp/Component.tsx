import { useEffect, useRef, useState } from "react";
import type { NodeComponentProps, NodeRunResult } from "@xiranite/contract";
import type {
  ScoolpAction,
  ScoolpData,
  ScoolpInput,
} from "@xiranite/node-scoolp/core";
import {
  formatSize,
  parseScoolpSyncConfig,
  planScoolpSyncCommands,
} from "@xiranite/node-scoolp/core";
import {
  Archive,
  Copy,
  FileClock,
  FolderSync,
  Gauge,
  Package,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NodeConfigPopover } from "@/nodes/shared/NodeConfigPopover";
import { useNodeSurface } from "@/nodes/shared/useNodeSurface";
import { useNodeI18n } from "@/nodes/shared/useNodeI18n";
import { RunningTint } from "@/nodes/shared/controls";
import { ACTIONS } from "./constants";
import {
  ActionIconButton,
  ActionPicker,
  AdvancedOptionsPopover,
  ConfigTextPanel,
  PathFields,
  PrimarySwitches,
  StatusStrip,
} from "./controls";
import { defaultConfigIfEmpty, getActionMeta } from "./utils";
import type { ScoolpCardState, ScoolpStatusMeta } from "./types";
import { CONFIG_FIELDS } from "./types";

export function Component({ compId, host }: NodeComponentProps) {
  const surface = useNodeSurface();
  const { t } = useNodeI18n("scoolp");
  const data = host.getData<ScoolpCardState>(compId) ?? {};
  const dataRef = useRef<ScoolpCardState>(data);
  dataRef.current = data;

  const [, setRevision] = useState(0);
  const [running, setRunning] = useState(false);
  const [defaults, setDefaults] = useState<
    Partial<ScoolpCardState> | undefined
  >(undefined);
  const [configFilePath, setConfigFilePath] = useState<string | undefined>(
    undefined,
  );
  const [configDirty, setConfigDirty] = useState(false);

  const logs = data.logs ?? [];
  const result = data.result ?? null;
  const progress = data.progress ?? 0;
  const action = data.action ?? "status";
  const actionMeta = getActionMeta(action);
  const dryRun = data.dryRun ?? true;
  const packagesArray = splitPackages(data.packages);
  const status = statusFromState(data, running);
  const compactSurface =
    surface.mode === "compact" || surface.mode === "portrait";
  const forceCollapsedSurface =
    compactSurface && surface.height > 0 && surface.height < 160;
  const portraitCompact =
    surface.mode === "portrait" ||
    (surface.mode === "compact" &&
      surface.width < 560 &&
      surface.height >= 300);

  async function loadDefaults() {
    try {
      const response = await host.getNodeConfig?.<Partial<ScoolpCardState>>();
      setDefaults(response?.config);
      setConfigFilePath(response?.path);
    } catch {
      // A node remains usable without a host-managed config file.
    }
  }

  useEffect(() => {
    void loadDefaults();
  }, [host]);

  useEffect(() => {
    if (!defaults) return;
    setConfigDirty(
      CONFIG_FIELDS.some(
        (field) => String(data[field] ?? "") !== String(defaults[field] ?? ""),
      ),
    );
  }, [
    data.configText,
    data.packageName,
    data.packages,
    data.cachePath,
    data.scoopRoot,
    data.dryRun,
    defaults,
  ]);

  function patch(patchData: Partial<ScoolpCardState>) {
    dataRef.current = { ...dataRef.current, ...patchData };
    host.patchData(compId, patchData);
    setRevision((value) => value + 1);
  }

  function pushLog(message: string) {
    const nextLogs = [...(dataRef.current.logs ?? []), message].slice(-120);
    patch({ logs: nextLogs });
  }

  async function pasteConfig() {
    const text = await host.clipboard?.readText?.();
    if (text) patch({ configText: text });
  }

  async function pastePackages() {
    const text = await host.clipboard?.readText?.();
    if (text) patch({ packages: text });
  }

  async function copyResults() {
    const text = resultText(result);
    if (text) await host.clipboard?.writeText?.(text);
  }

  async function copyLogs() {
    if (logs.length) await host.clipboard?.writeText?.(logs.join("\n"));
  }

  async function execute(nextAction: ScoolpAction) {
    if (running) return;
    const nextActionMeta = getActionMeta(nextAction);

    if (
      (nextAction === "sync" || nextAction === "show_config") &&
      dataRef.current.configText?.trim()
    ) {
      try {
        const syncConfig = parseScoolpSyncConfig(dataRef.current.configText);
        const syncPlan = planScoolpSyncCommands(syncConfig, true);
        patch({
          action: nextAction,
          phase: "completed",
          progress: 100,
          progressText: `预演：${syncPlan.length} 条命令`,
          result: emptyResult({ syncConfig, syncPlan }),
        });
        pushLog(`sync dry-run: ${syncPlan.length} command(s)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        patch({ phase: "error", progress: 0, progressText: message });
        pushLog(message);
      }
      return;
    }

    const run = host.actions?.run;
    if (!run) {
      const message = "Local Backend 暂不可用，无法执行 scoolp。";
      patch({ phase: "error", progress: 0, progressText: message });
      pushLog("Native action is unavailable in this host.");
      return;
    }

    const input: ScoolpInput = {
      action: nextAction,
      path: dataRef.current.path,
      configText: dataRef.current.configText,
      packageName: dataRef.current.packageName,
      packages: splitPackages(dataRef.current.packages),
      cachePath: dataRef.current.cachePath,
      scoopRoot: dataRef.current.scoopRoot,
      dryRun,
    };

    setRunning(true);
    try {
      patch({
        action: nextAction,
        phase: "running",
        progress: 0,
        progressText: `${nextActionMeta.shortLabel}开始`,
        result: null,
      });
      const response = (await run<ScoolpInput, ScoolpData>(
        "scoolp",
        input,
        (event) => {
          if (event.type === "progress") {
            patch({
              progress: event.progress ?? 0,
              progressText: event.message,
            });
            pushLog(`[${event.progress ?? 0}%] ${event.message}`);
          } else {
            pushLog(event.message);
          }
        },
      )) as NodeRunResult<ScoolpData>;

      patch({
        phase: response.success ? "completed" : "error",
        progress: response.success ? 100 : 0,
        progressText: response.message,
        result: response.data ?? null,
      });
      pushLog(response.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      patch({ phase: "error", progress: 0, progressText: message });
      pushLog(message);
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    patch({
      phase: "idle",
      progress: 0,
      progressText: "",
      result: null,
      logs: [],
    });
  }

  async function saveAsDefault() {
    const config: Partial<ScoolpCardState> = {};
    for (const field of CONFIG_FIELDS) {
      const value = dataRef.current[field];
      if (value !== undefined && value !== "")
        (config as Record<string, unknown>)[field] = value;
    }
    await host.saveNodeConfig?.(config);
    setDefaults(config);
    setConfigDirty(false);
  }

  function restoreDefault() {
    if (defaults) patch(defaults);
  }

  const commonProps = createViewProps({
    action,
    actionMeta,
    configDirty,
    configFilePath,
    data,
    defaults,
    dryRun,
    host,
    logs,
    packagesArray,
    progress,
    result,
    running,
    status,
    t,
    onCopyLogs: copyLogs,
    onCopyResults: copyResults,
    onExecute: execute,
    onOpenConfigFile: host.openConfigFile,
    onPasteConfig: pasteConfig,
    onPastePackages: pastePackages,
    onPatch: patch,
    onReset: reset,
    onReloadDefaults: loadDefaults,
    onRestoreDefault: restoreDefault,
    onSaveDefault: saveAsDefault,
  });

  return (
    <TooltipProvider>
      <div
        ref={surface.ref}
        className="@container/scoolp relative flex h-full min-h-0 w-full overflow-hidden"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_14%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent_36%),radial-gradient(circle_at_88%_8%,color-mix(in_oklch,var(--chart-4)_16%,transparent),transparent_34%)]" />
        <div className="relative flex min-h-0 w-full flex-col">
          {surface.mode === "collapsed" || forceCollapsedSurface ? (
            <CollapsedView {...commonProps} />
          ) : compactSurface ? (
            portraitCompact ? (
              <PortraitCompactView {...commonProps} />
            ) : (
              <CompactView {...commonProps} />
            )
          ) : (
            <FullView {...commonProps} />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

type ViewProps = ReturnType<typeof createViewProps>;

function createViewProps(props: {
  action: ScoolpAction;
  actionMeta: (typeof ACTIONS)[number];
  configDirty: boolean;
  configFilePath?: string;
  data: ScoolpCardState;
  defaults?: Partial<ScoolpCardState>;
  dryRun: boolean;
  host: NodeComponentProps["host"];
  logs: string[];
  packagesArray: string[];
  progress: number;
  result: ScoolpData | null;
  running: boolean;
  status: ScoolpStatusMeta;
  t: ReturnType<typeof useNodeI18n>["t"];
  onCopyLogs: () => void;
  onCopyResults: () => void;
  onExecute: (action: ScoolpAction) => void;
  onOpenConfigFile?: () => Promise<void> | void;
  onPasteConfig: () => void;
  onPastePackages: () => void;
  onPatch: (patch: Partial<ScoolpCardState>) => void;
  onReset: () => void;
  onReloadDefaults: () => Promise<void>;
  onRestoreDefault: () => void;
  onSaveDefault: () => void;
}) {
  return props;
}

function CollapsedView(props: ViewProps) {
  const ActionIcon = props.actionMeta.icon;
  return (
    <div
      data-testid="scoolp-collapsed-view"
      className="relative flex h-full min-h-0 items-center gap-2 overflow-hidden rounded-xl border bg-background/85 px-3 py-2 shadow-sm"
    >
      <RunningTint tone={props.status.tone} />
      <div
        className={cn(
          "relative grid size-8 shrink-0 place-items-center rounded-lg",
          props.status.iconClass,
        )}
      >
        <Package />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-1 text-xs font-semibold leading-none">
          <span>Scoolp</span>
          <Badge variant={props.status.badgeVariant}>
            {props.status.label}
          </Badge>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {summaryText(props)}
        </div>
      </div>
      <Button
        aria-label={props.actionMeta.label}
        disabled={props.running}
        size="icon-sm"
        onClick={() => props.onExecute(props.action)}
      >
        <ActionIcon />
        <span className="sr-only">{props.actionMeta.label}</span>
      </Button>
      {props.status.tone === "running" && (
        <div className="relative text-xs tabular-nums text-muted-foreground">
          {props.progress}%
        </div>
      )}
    </div>
  );
}

function CompactView(props: ViewProps) {
  return (
    <div
      data-testid="scoolp-compact-view"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 p-3 pb-2">
        <HeaderLine
          status={props.status}
          subtitle={props.data.progressText || summaryText(props)}
        />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover
            data={props.data}
            disabled={props.running}
            onPatch={props.onPatch}
          />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
        <ActionPicker
          action={props.action}
          disabled={props.running}
          dryRun={props.dryRun}
          result={props.result}
          onExecute={props.onExecute}
          onPatch={props.onPatch}
        />
        <ActiveFieldPanel compact {...props} />
        <ToolbarActions compact {...props} />
        {(props.status.tone === "running" || props.status.tone === "error") && (
          <StatusStrip
            compact
            progress={props.progress}
            status={props.status}
            text={props.data.progressText}
          />
        )}
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
          <ResultBody compact result={props.result} />
        </div>
      </div>
    </div>
  );
}

function PortraitCompactView(props: ViewProps) {
  return (
    <div
      data-testid="scoolp-portrait-view"
      className="flex h-full min-h-0 flex-col gap-2 p-2"
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <HeaderLine
          status={props.status}
          subtitle={props.data.progressText || summaryText(props)}
        />
        <div className="flex shrink-0 items-center gap-1">
          <AdvancedOptionsPopover
            data={props.data}
            disabled={props.running}
            onPatch={props.onPatch}
          />
          <PrimaryActionButton compact props={props} />
        </div>
      </div>
      <div className="grid shrink-0 gap-2">
        <ActionPicker
          action={props.action}
          disabled={props.running}
          dryRun={props.dryRun}
          result={props.result}
          onExecute={props.onExecute}
          onPatch={props.onPatch}
        />
        <ActiveFieldPanel compact {...props} />
        <PrimarySwitches
          compact
          data={props.data}
          disabled={props.running}
          onPatch={props.onPatch}
        />
        <ToolbarActions compact {...props} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-2 font-mono text-xs">
        <ResultBody result={props.result} />
      </div>
    </div>
  );
}

function LegacyFullView(props: ViewProps) {
  return (
    <div
      data-testid="scoolp-full-view"
      className="flex min-h-0 flex-1 flex-col gap-3 p-3"
    >
      <div className="flex shrink-0 flex-col gap-3 @4xl/scoolp:flex-row @4xl/scoolp:items-center @4xl/scoolp:justify-between">
        <div className="flex min-w-0 flex-col gap-2 @4xl/scoolp:flex-row @4xl/scoolp:items-center">
          <HeaderLine
            status={props.status}
            subtitle={
              props.data.progressText ||
              `${actionGroupLabel(props.action)} · ${props.dryRun ? "预演" : "真实"}`
            }
          />
          <div
            data-testid="scoolp-header-toolbar"
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <ToolbarActions {...props} />
          </div>
        </div>
        <StatsPanel progress={props.progress} result={props.result} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 @5xl/scoolp:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <div className="grid gap-3 border-b pb-3">
            <div>
              <div className="text-sm font-semibold">操作类型</div>
              <div className="text-xs text-muted-foreground">
                选择要执行的 Scoop 管理动作。
              </div>
            </div>
            <ActionPicker
              action={props.action}
              disabled={props.running}
              dryRun={props.dryRun}
              result={props.result}
              onExecute={props.onExecute}
              onPatch={props.onPatch}
            />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">路径与包名</div>
            <PathFields
              data={props.data}
              disabled={props.running}
              onPatch={props.onPatch}
            />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">同步配置 / 包列表</div>
            <ActiveFieldPanel {...props} />
          </div>
          <div className="grid gap-3 border-b pb-3">
            <div className="text-sm font-semibold">关键开关</div>
            <PrimarySwitches
              data={props.data}
              disabled={props.running}
              onPatch={props.onPatch}
            />
          </div>
          <StatusStrip
            progress={props.progress}
            status={props.status}
            text={props.data.progressText}
          />
        </section>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex shrink-0 items-center justify-between gap-2">
            <div className="text-sm font-semibold">执行结果</div>
            <ActionIconButton
              disabled={!props.result}
              icon={Copy}
              label="复制结果"
              onClick={props.onCopyResults}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-3 font-mono text-xs leading-5">
            <ResultBody result={props.result} />
          </div>
          <div className="h-32 shrink-0 overflow-auto rounded-md border bg-muted/15 p-2 font-mono text-xs text-muted-foreground">
            {props.logs.length ? (
              props.logs.map((line, index) => (
                <div key={index} className="truncate">
                  {line}
                </div>
              ))
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                暂无日志
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FullView(props: ViewProps) {
  // `init` is retained for backwards-compatible saved cards. All supported
  // workspaces use the reference-driven workbench below.
  if (props.action === "init") return <LegacyFullView {...props} />;
  return <WorkspaceFullView {...props} />;
}

function WorkspaceFullView(props: ViewProps) {
  const group = actionGroup(props.action);
  return (
    <div
      data-testid="scoolp-full-view"
      className="flex min-h-0 flex-1 flex-col p-3 @4xl/scoolp:p-4"
    >
      <div className="flex shrink-0 flex-col gap-3 border-b pb-3 @5xl/scoolp:flex-row @5xl/scoolp:items-center @5xl/scoolp:justify-between">
        <HeaderLine
          status={props.status}
          subtitle={
            props.data.progressText ||
            props.t(
              "workspace.subtitle",
              "管理 Bucket、分析缓存并安全回收过期安装包",
            )
          }
        />
        <div
          data-testid="scoolp-header-toolbar"
          className="flex shrink-0 items-center gap-1"
        >
          <ActionIconButton
            disabled={!props.result}
            icon={Copy}
            label={props.t("action.copyResult", "复制结果")}
            onClick={props.onCopyResults}
          />
          <ActionIconButton
            disabled={props.running}
            icon={RotateCcw}
            label={props.t("action.reset", "清空状态")}
            onClick={props.onReset}
          />
          <NodeConfigPopover
            configPath={props.configFilePath}
            defaults={props.defaults as Record<string, unknown> | undefined}
            dirty={props.configDirty}
            disabled={props.running}
            t={props.t}
            onOpenFile={props.onOpenConfigFile}
            onReload={props.onReloadDefaults}
            onRestore={props.onRestoreDefault}
            onSave={props.onSaveDefault}
          />
        </div>
      </div>
      <Tabs
        value={group}
        onValueChange={(next) =>
          props.onPatch({ action: defaultActionForGroup(next) })
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b">
          <TabsList
            aria-label={props.t("workspace.views", "Scoolp 工作区视图")}
            className="bg-transparent p-0"
          >
            <TabsTrigger value="cache">
              <Archive data-icon="inline-start" />
              {props.t("workspace.cache", "缓存")}
            </TabsTrigger>
            <TabsTrigger value="sync">
              <FolderSync data-icon="inline-start" />
              {props.t("workspace.sync", "同步")}
            </TabsTrigger>
            <TabsTrigger value="status">
              <Gauge data-icon="inline-start" />
              {props.t("workspace.status", "状态")}
            </TabsTrigger>
          </TabsList>
          <StatsPanel progress={props.progress} result={props.result} />
        </div>
        {group === "cache" ? (
          <CacheWorkbench {...props} />
        ) : (
          <ManagementWorkbench {...props} group={group} />
        )}
      </Tabs>
    </div>
  );
}

function CacheWorkbench(props: ViewProps) {
  const cache = props.result?.cache;
  const cacheActions = ACTIONS.filter((item) => item.group === "cache");
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 @5xl/scoolp:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="flex min-h-0 flex-col gap-4 py-4 pr-0 @5xl/scoolp:pr-5">
        <div className="flex shrink-0 items-end justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold tracking-tight">
              {props.t("cache.analysis", "缓存分析")}
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {cache?.path ||
                props.data.cachePath ||
                props.t("cache.pathHint", "设定缓存目录后扫描过期安装包")}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums text-primary">
              {cache ? formatSize(cache.obsoleteSize) : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {props.t("cache.reclaimable", "可回收空间")}
            </div>
          </div>
        </div>
        <CacheVolumeMap cache={cache} />
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div>
              <h5 className="text-sm font-semibold">
                {props.t("cache.targets", "可处理项目")}
              </h5>
              <p className="text-xs text-muted-foreground">
                {cache
                  ? props.t("cache.autoDetected", "由当前扫描自动识别")
                  : props.t("cache.scanFirst", "扫描后显示真实文件")}
              </p>
            </div>
            {cache && (
              <Badge variant="outline">
                {cache.obsoleteCount} {props.t("cache.files", "个文件")}
              </Badge>
            )}
          </div>
          <CacheTargets cache={cache} />
        </div>
      </section>
      <aside className="flex min-h-0 flex-col gap-4 border-t py-4 @5xl/scoolp:border-t-0 @5xl/scoolp:border-l @5xl/scoolp:pl-5">
        <div className="rounded-lg border border-destructive/35 bg-destructive/[0.035] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <Trash2 className="size-4" />
            {props.t("cache.destructive", "清理操作")}
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {props.t(
              "cache.destructiveNote",
              "关闭预演后，清理会永久删除本次扫描到的过期缓存。",
            )}
          </p>
          <div className="mt-3 grid gap-1.5">
            {cacheActions.map((item) => (
              <CacheActionRow key={item.value} item={item} props={props} />
            ))}
          </div>
          <div className="mt-2">
            <PrimaryActionButton props={props} />
          </div>
        </div>
        <div className="grid gap-3">
          <div>
            <div className="mb-2 text-xs font-semibold text-muted-foreground">
              {props.t("cache.scope", "扫描范围")}
            </div>
            <CacheScopeFields
              data={props.data}
              disabled={props.running}
              onPatch={props.onPatch}
              t={props.t}
            />
          </div>
          <PrimarySwitches
            data={props.data}
            disabled={props.running}
            onPatch={props.onPatch}
          />
        </div>
        <StatusStrip
          progress={props.progress}
          status={props.status}
          text={props.data.progressText}
        />
        <RunLog logs={props.logs} />
      </aside>
    </div>
  );
}

function CacheActionRow({
  item,
  props,
}: {
  item: (typeof ACTIONS)[number];
  props: ViewProps;
}) {
  const active = item.value === props.action;
  const Icon = item.icon;
  return (
    <Button
      aria-pressed={active}
      disabled={props.running}
      size="sm"
      variant={
        active
          ? item.destructive && !props.dryRun
            ? "destructive"
            : "secondary"
          : "outline"
      }
      className="justify-start"
      onClick={() => props.onPatch({ action: item.value })}
    >
      <Icon data-icon="inline-start" />
      {item.shortLabel}
    </Button>
  );
}

function CacheScopeFields(
  props: Pick<ViewProps, "data" | "onPatch" | "t"> & { disabled?: boolean },
) {
  return (
    <div className="grid gap-2">
      <Field className="gap-1.5">
        <FieldLabel htmlFor="scoolp-cache-root" className="text-xs">
          {props.t("cache.scoopRoot", "Scoop 根目录")}
        </FieldLabel>
        <Input
          id="scoolp-cache-root"
          aria-label="scoop root"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="D:/scoop"
          value={props.data.scoopRoot ?? ""}
          onChange={(event) =>
            props.onPatch({ scoopRoot: event.currentTarget.value })
          }
        />
      </Field>
      <Field className="gap-1.5">
        <FieldLabel htmlFor="scoolp-cache-path" className="text-xs">
          {props.t("cache.path", "缓存目录")}
        </FieldLabel>
        <Input
          id="scoolp-cache-path"
          aria-label="scoolp cache path"
          className="font-mono text-xs"
          disabled={props.disabled}
          placeholder="D:/scoop/cache"
          value={props.data.cachePath ?? ""}
          onChange={(event) =>
            props.onPatch({ cachePath: event.currentTarget.value })
          }
        />
      </Field>
    </div>
  );
}

function CacheVolumeMap({ cache }: { cache: ScoolpData["cache"] | undefined }) {
  const packages = cache?.obsoletePackages ?? [];
  if (!packages.length)
    return (
      <div className="grid min-h-44 place-items-center rounded-lg border border-dashed bg-muted/15 p-5 text-center text-sm text-muted-foreground">
        运行“扫描缓存”后将在这里按真实包体积展示分布。
      </div>
    );
  const maximum = Math.max(...packages.map((item) => item.size), 1);
  return (
    <div className="grid min-h-44 grid-cols-2 gap-1 rounded-lg border bg-muted/15 p-1 @3xl/scoolp:grid-cols-4">
      {packages.slice(0, 8).map((item, index) => (
        <div
          key={item.path}
          className={cn(
            "flex min-h-20 flex-col justify-end rounded-md border border-primary/20 bg-primary/[0.04] p-3",
            index === 0 && "@3xl/scoolp:col-span-2 @3xl/scoolp:row-span-2",
          )}
          style={{ opacity: 0.58 + (item.size / maximum) * 0.42 }}
        >
          <div className="truncate text-sm font-semibold text-primary">
            {item.name}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatSize(item.size)} · {item.version}
          </div>
        </div>
      ))}
    </div>
  );
}

function CacheTargets({ cache }: { cache: ScoolpData["cache"] | undefined }) {
  if (!cache?.obsoletePackages.length)
    return (
      <div className="grid min-h-0 flex-1 place-items-center rounded-lg border border-dashed bg-muted/10 p-5 text-center text-sm text-muted-foreground">
        尚无扫描结果。
      </div>
    );
  return (
    <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pr-1">
      {cache.obsoletePackages.map((item, index) => {
        const Icon = index % 2 ? FileClock : Archive;
        return (
          <div
            key={item.path}
            className="flex items-center gap-3 rounded-lg border bg-background/45 p-3"
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {item.filename}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {item.path}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums text-primary">
                {formatSize(item.size)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {item.version}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ManagementWorkbench(props: ViewProps & { group: "status" | "sync" }) {
  const title =
    props.group === "sync"
      ? props.t("sync.title", "Bucket 同步")
      : props.t("status.title", "Scoop 状态");
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 py-4 @5xl/scoolp:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="flex min-h-0 flex-col gap-4">
        <div>
          <h4 className="text-base font-semibold">{title}</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {props.actionMeta.description}
          </p>
        </div>
        {props.group === "sync" && <ActiveFieldPanel {...props} />}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/15 p-3 font-mono text-xs leading-5">
          <ResultBody result={props.result} />
        </div>
      </section>
      <aside className="flex min-h-0 flex-col gap-4 border-t pt-4 @5xl/scoolp:border-t-0 @5xl/scoolp:border-l @5xl/scoolp:pl-5 @5xl/scoolp:pt-0">
        <ActionPicker
          action={props.action}
          disabled={props.running}
          dryRun={props.dryRun}
          result={props.result}
          onExecute={props.onExecute}
          onPatch={props.onPatch}
        />
        <PathFields
          data={props.data}
          disabled={props.running}
          onPatch={props.onPatch}
        />
        <PrimarySwitches
          data={props.data}
          disabled={props.running}
          onPatch={props.onPatch}
        />
        <PrimaryActionButton props={props} />
        <StatusStrip
          progress={props.progress}
          status={props.status}
          text={props.data.progressText}
        />
        <RunLog logs={props.logs} />
      </aside>
    </div>
  );
}

function RunLog({ logs }: { logs: string[] }) {
  return (
    <div className="min-h-24 flex-1 overflow-auto rounded-lg border bg-muted/10 p-2 font-mono text-xs text-muted-foreground">
      {logs.length ? (
        logs.map((line, index) => (
          <div key={index} className="truncate">
            {line}
          </div>
        ))
      ) : (
        <div className="grid h-full place-items-center">暂无日志</div>
      )}
    </div>
  );
}

function ActiveFieldPanel(props: ViewProps & { compact?: boolean }) {
  if (props.action === "install") {
    return (
      <ConfigTextPanel
        ariaLabel="scoolp packages"
        compact={props.compact}
        count={props.packagesArray.length}
        disabled={props.running}
        inputId="scoolp-packages"
        label="包列表"
        placeholder={"7zip\ngit\ngrep"}
        value={props.data.packages ?? ""}
        onChange={(packages) => props.onPatch({ packages })}
        onClear={() => props.onPatch({ packages: "" })}
        onPaste={props.onPastePackages}
      />
    );
  }
  return (
    <ConfigTextPanel
      ariaLabel="scoolp sync config"
      compact={props.compact}
      count={configLineCount(props.data.configText)}
      disabled={props.running}
      inputId="scoolp-config-text"
      label="同步配置"
      placeholder={'[scoop]\nroot = "D:/scoop"\n\n[[bucket]]\nname = "main"'}
      value={defaultConfigIfEmpty(props.data.configText)}
      onChange={(configText) => props.onPatch({ configText })}
      onClear={() => props.onPatch({ configText: "" })}
      onPaste={props.onPasteConfig}
    />
  );
}

function ToolbarActions(props: ViewProps & { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1",
        props.compact && "justify-between",
      )}
    >
      <PrimaryActionButton compact={props.compact} props={props} />
      <ActionIconButton
        disabled={!props.result}
        icon={Copy}
        label="复制结果"
        onClick={props.onCopyResults}
      />
      <ActionIconButton
        disabled={!props.logs.length}
        icon={Copy}
        label="复制日志"
        onClick={props.onCopyLogs}
      />
      <ActionIconButton
        disabled={props.running}
        icon={RotateCcw}
        label="清空状态"
        onClick={props.onReset}
      />
      {!props.compact && (
        <NodeConfigPopover
          configPath={props.configFilePath}
          defaults={props.defaults as Record<string, unknown> | undefined}
          dirty={props.configDirty}
          disabled={props.running}
          t={props.t}
          onOpenFile={props.onOpenConfigFile}
          onReload={props.onReloadDefaults}
          onRestore={props.onRestoreDefault}
          onSave={props.onSaveDefault}
        />
      )}
    </div>
  );
}

function PrimaryActionButton({
  compact,
  props,
}: {
  compact?: boolean;
  props: ViewProps;
}) {
  if (props.running) {
    return (
      <Button
        aria-label="scoolp running"
        disabled
        size={compact ? "icon-sm" : "sm"}
        variant="secondary"
      >
        <Square />
        {!compact && <span>运行中</span>}
      </Button>
    );
  }

  const actionMeta = props.actionMeta;
  const dangerous = isDangerousAction(props.action, props.dryRun);
  const label = dangerous
    ? dangerLabel(props.action)
    : `执行${actionMeta.shortLabel}`;
  const Icon = actionMeta.icon;

  if (dangerous) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            aria-label={label}
            size={compact ? "icon-sm" : "sm"}
            variant="destructive"
          >
            <Icon />
            {!compact && <span>{label}</span>}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dangerTitle(props.action)}</AlertDialogTitle>
            <AlertDialogDescription>
              {dangerDescription(props)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => props.onExecute(props.action)}
            >
              确认执行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Button
      aria-label={label}
      size={compact ? "icon-sm" : "sm"}
      onClick={() => props.onExecute(props.action)}
    >
      <Icon />
      {!compact && <span>{label}</span>}
    </Button>
  );
}

function HeaderLine({
  status,
  subtitle,
}: {
  status: ScoolpStatusMeta;
  subtitle: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <div
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            status.iconClass,
          )}
        >
          <Package />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold leading-none">
              Scoolp
            </h3>
            <Badge variant={status.badgeVariant}>{status.label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatsPanel(props: { progress: number; result: ScoolpData | null }) {
  const stats = [
    [
      "包",
      props.result?.installedPackages.length ??
        props.result?.availablePackages.length ??
        0,
    ],
    [
      "Bucket",
      props.result?.buckets.length ??
        props.result?.syncConfig?.buckets.length ??
        0,
    ],
    ["缓存", props.result?.cache?.obsoleteCount ?? 0],
    ["失败", props.result?.failedCount ?? 0],
    ["清理", props.result?.cleanedCount ?? 0],
    ["进度", `${props.progress}%`],
  ] as const;

  return (
    <div
      data-testid="scoolp-stats-panel"
      className="grid shrink-0 grid-cols-3 gap-1 @4xl/scoolp:grid-cols-6"
    >
      {stats.map(([label, value]) => (
        <div
          key={label}
          className="min-w-0 rounded-md bg-muted/35 px-2 py-1.5 text-center"
        >
          <div className="truncate text-[11px] text-muted-foreground">
            {label}
          </div>
          <div
            className={cn(
              "text-sm font-semibold tabular-nums",
              label === "失败" && Number(value) > 0 && "text-destructive",
            )}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultBody({
  compact,
  result,
}: {
  compact?: boolean;
  result: ScoolpData | null;
}) {
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        选择动作并执行后将在此显示结果
      </div>
    );
  }
  const limit = compact ? 30 : 80;
  if (result.syncPlan.length) {
    return (
      <div className="grid gap-1">
        {result.syncPlan.slice(0, limit).map((item) => (
          <div key={`${item.label}:${item.args.join(" ")}`}>
            <div className="truncate text-primary">{item.label}</div>
            <div className="truncate text-muted-foreground">
              {item.command} {item.args.join(" ")}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (result.availablePackages.length) {
    return (
      <div className="grid gap-1">
        {result.availablePackages.slice(0, limit).map((item) => (
          <div key={item.name}>
            <div className="truncate text-primary">
              {item.name} {item.version ?? ""}
            </div>
            <div className="truncate text-muted-foreground">
              {item.description ?? item.homepage ?? ""}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (result.cache) {
    return (
      <div>
        <div className="mb-2 text-primary">
          {result.cache.obsoleteCount} 个过时 /{" "}
          {formatSize(result.cache.obsoleteSize)}
        </div>
        {result.cache.obsoletePackages.slice(0, limit).map((item) => (
          <div key={item.path} className="truncate">
            {item.name} {item.version} / {formatSize(item.size)}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      scoop 已安装：{String(result.scoopInstalled)}
    </div>
  );
}

function statusFromState(
  data: ScoolpCardState,
  running: boolean,
): ScoolpStatusMeta {
  if (running || data.phase === "running") {
    return {
      label: "运行中",
      description: data.progressText || "Scoolp 正在执行当前任务。",
      tone: "running",
      badgeVariant: "secondary",
      iconClass: "bg-primary text-primary-foreground",
    };
  }
  if (data.phase === "error" || (data.result?.errors.length ?? 0) > 0) {
    return {
      label: "失败",
      description:
        data.progressText ||
        data.result?.errors[0] ||
        "上次任务失败，请查看日志。",
      tone: "error",
      badgeVariant: "destructive",
      iconClass: "bg-destructive text-destructive-foreground",
    };
  }
  if (data.phase === "completed") {
    return {
      label: "完成",
      description: data.progressText || "上次任务已完成。",
      tone: "success",
      badgeVariant: "default",
      iconClass: "bg-primary text-primary-foreground",
    };
  }
  return {
    label: "就绪",
    description: "选择动作后执行 Scoop 管理任务。",
    tone: "idle",
    badgeVariant: "outline",
    iconClass: "bg-secondary text-secondary-foreground",
  };
}

function isDangerousAction(action: ScoolpAction, dryRun: boolean): boolean {
  if (action === "cache_delete" || action === "cache_backup") return true;
  if (action === "sync" && !dryRun) return true;
  return false;
}

function dangerLabel(action: ScoolpAction): string {
  if (action === "cache_delete") return "真实清理";
  if (action === "cache_backup") return "真实备份";
  if (action === "sync") return "真实同步";
  return "真实执行";
}

function dangerTitle(action: ScoolpAction): string {
  if (action === "cache_delete") return "确认删除过时缓存？";
  if (action === "cache_backup") return "确认备份过时缓存？";
  if (action === "sync") return "确认真实同步 Bucket？";
  return "确认真实执行 Scoolp？";
}

function dangerDescription(props: ViewProps): string {
  if (props.action === "cache_delete") {
    return `当前关闭了预演，清理时会永久删除过时缓存文件。${props.result?.cache?.obsoleteCount ?? 0} 个文件将被删除，请确认无误后继续。`;
  }
  if (props.action === "cache_backup") {
    return `当前关闭了预演，备份时会移动过时缓存到备份目录。${props.result?.cache?.obsoleteCount ?? 0} 个文件将被移动，请确认无误后继续。`;
  }
  if (props.action === "sync") {
    return "当前关闭了预演，同步时会真实执行 git 和 scoop 命令，可能重置 bucket 和更新包。请确认配置无误后继续。";
  }
  return "当前操作会修改文件系统，请确认无误后继续。";
}

function actionGroupLabel(action: ScoolpAction): string {
  const meta = ACTIONS.find((item) => item.value === action);
  return meta?.shortLabel ?? "状态";
}

function actionGroup(action: ScoolpAction): "cache" | "sync" | "status" {
  return ACTIONS.find((item) => item.value === action)?.group ?? "status";
}

function defaultActionForGroup(group: string): ScoolpAction {
  if (group === "cache") return "cache_list";
  if (group === "sync") return "sync";
  return "status";
}

function summaryText(props: ViewProps): string {
  if (props.data.progressText) return props.data.progressText;
  if (props.result?.failedCount) return `${props.result.failedCount} 个失败`;
  if (props.result?.syncPlan.length)
    return `${props.result.syncPlan.length} 条命令`;
  if (props.result?.availablePackages.length)
    return `${props.result.availablePackages.length} 个包`;
  if (props.result?.installedPackages.length)
    return `${props.result.installedPackages.length} 个已装`;
  if (props.result?.cache?.obsoleteCount)
    return `${props.result.cache.obsoleteCount} 个过时缓存`;
  return `${props.actionMeta.shortLabel} · ${props.dryRun ? "预演" : "真实"}`;
}

function resultText(result: ScoolpData | null): string {
  if (!result) return "";
  if (result.syncPlan.length) {
    return result.syncPlan
      .map((item) => `${item.label}\n${item.command} ${item.args.join(" ")}`)
      .join("\n");
  }
  if (result.availablePackages.length) {
    return result.availablePackages
      .map((item) => `${item.name} ${item.version ?? ""}`)
      .join("\n");
  }
  if (result.cache) {
    return result.cache.obsoletePackages
      .map((item) => `${item.name} ${item.version} ${formatSize(item.size)}`)
      .join("\n");
  }
  return "";
}

function configLineCount(value?: string): number {
  if (!value || !value.trim()) return 0;
  return value.split(/\r?\n/).length;
}

function emptyResult(override: Partial<ScoolpData>): ScoolpData {
  return {
    scoopInstalled: false,
    installedPackages: [],
    buckets: [],
    availablePackages: [],
    syncPlan: [],
    commandResults: [],
    installedCount: 0,
    failedCount: 0,
    cleanedCount: 0,
    cleanedSizeBytes: 0,
    errors: [],
    ...override,
  };
}

function splitPackages(value?: string): string[] {
  return (value ?? "")
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
