/**
 * @migrated-from src/lib/cards/properties/ThumbnailArchitectureMetricsCard.svelte
 * @source-hash sha256:7280c437093b9bf7b439da387b29b6107513735470ce96b0d93f2a1760890d07
 * @ast-prototype migration/neoview/frontend/tsx-scaffold/src/lib/cards/properties/ThumbnailArchitectureMetricsCard.tsx
 * @migration-status adapted
 */
import { RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { ReaderStorageDiagnosticsDto } from "../../../adapters/reader-http-client";
import type { ReaderPanelContext } from "../registry";
import { ReaderCardEmptyState } from "./ReaderCardEmptyState";

const REFRESH_INTERVAL_MS = 2_000;
const MAX_SAMPLES = 60;
const LANE_ORDER = [
  "reader-visible",
  "library-visible",
  "prefetch",
  "folder-preview",
  "background",
] as const;
const LANE_LABELS: Readonly<Record<(typeof LANE_ORDER)[number], string>> = {
  "reader-visible": "当前阅读",
  "library-visible": "可见资源库",
  prefetch: "预取",
  "folder-preview": "文件夹预览",
  background: "后台",
};

type ThumbnailDiagnostics = NonNullable<
  ReaderStorageDiagnosticsDto["assets"]["thumbnails"]
>;
type ThumbnailTelemetry = NonNullable<ThumbnailDiagnostics["telemetry"]>;

interface CounterSnapshot {
  demands: number;
  cacheHits: number;
  cacheMisses: number;
  completed: number;
  failed: number;
  cancelled: number;
  evictions: number;
}

interface CompactSample extends CounterSnapshot {
  sampledAtMs: number;
}

export default function ThumbnailArchitectureMetricsCard({
  panelActive = true,
  ...props
}: ReaderPanelContext) {
  if (!panelActive)
    return (
      <ReaderCardEmptyState>卡片暂停时停止缩略图指标采样</ReaderCardEmptyState>
    );
  return <ThumbnailArchitectureMetricsContent {...props} panelActive />;
}

function ThumbnailArchitectureMetricsContent({
  client,
  disabled,
}: ReaderPanelContext) {
  const [snapshot, setSnapshot] = useState<ReaderStorageDiagnosticsDto>();
  const [baseline, setBaseline] = useState<CounterSnapshot>();
  const [sampleCount, setSampleCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const samplesRef = useRef<CompactSample[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const requestRef = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  }>();

  const requestSnapshot = useCallback((): Promise<void> => {
    if (requestRef.current) return requestRef.current.promise;
    if (!client.diagnostics) {
      setError("当前 Reader 后端不支持缩略图诊断。");
      setLoading(false);
      return Promise.resolve();
    }
    const controller = new AbortController();
    setLoading(true);
    const promise = client
      .diagnostics(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        const telemetry = next.assets.thumbnails?.telemetry;
        const counters = telemetry ? counterSnapshot(telemetry) : undefined;
        if (counters) {
          const compact = {
            sampledAtMs: next.sampledAtMs ?? Date.now(),
            ...counters,
          };
          samplesRef.current = [...samplesRef.current, compact].slice(
            -MAX_SAMPLES,
          );
          setSampleCount(samplesRef.current.length);
          setBaseline((current) => current ?? counters);
        }
        setSnapshot(next);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      })
      .finally(() => {
        if (requestRef.current?.promise === promise)
          requestRef.current = undefined;
        if (!controller.signal.aborted) setLoading(false);
      });
    requestRef.current = { controller, promise };
    return promise;
  }, [client]);

  useEffect(() => {
    if (disabled) {
      setLoading(false);
      return;
    }
    let disposed = false;
    const tick = async () => {
      await requestSnapshot();
      if (!disposed) timerRef.current = setTimeout(tick, REFRESH_INTERVAL_MS);
    };
    void tick();
    return () => {
      disposed = true;
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      timerRef.current = undefined;
      requestRef.current?.controller.abort();
      requestRef.current = undefined;
    };
  }, [disabled, requestSnapshot]);

  const thumbnails = snapshot?.assets.thumbnails;
  const telemetry = thumbnails?.telemetry;
  const counters = telemetry ? counterSnapshot(telemetry) : undefined;
  const deltas =
    counters && baseline ? subtractCounters(counters, baseline) : undefined;
  const sampledAtMs = snapshot?.sampledAtMs;
  const totalEntries = addOptional(
    thumbnails?.cachedEntries,
    thumbnails?.activeFlights,
  );

  const resetBaseline = () => {
    if (!counters) return;
    setBaseline(counters);
    samplesRef.current = [
      { sampledAtMs: sampledAtMs ?? Date.now(), ...counters },
    ];
    setSampleCount(1);
  };

  return (
    <div
      className="min-w-0 space-y-3 text-xs"
      data-neoview-thumbnail-architecture-metrics="true"
      aria-busy={loading}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className="min-w-0 truncate text-[11px] text-muted-foreground"
          role="status"
        >
          {snapshot ? `更新于 ${formatTime(sampledAtMs)}` : "暂无数据"}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || loading}
          onClick={() => void requestSnapshot()}
        >
          <RefreshCw
            className={`size-3 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden="true"
          />
          刷新
        </Button>
      </div>

      {error ? (
        <div
          className="flex min-w-0 items-start justify-between gap-2 rounded bg-destructive/10 p-2 text-destructive"
          role="alert"
        >
          <span className="min-w-0 break-words">{error}</span>
          <button
            type="button"
            className="shrink-0 underline-offset-2 hover:underline"
            disabled={disabled || loading}
            onClick={() => void requestSnapshot()}
          >
            重试
          </button>
        </div>
      ) : null}

      {!snapshot ? (
        <div className="rounded border p-3 text-muted-foreground" role="status">
          {loading
            ? "正在获取缩略图架构指标…"
            : disabled
              ? "Reader 忙碌时暂停指标采样"
              : "未获取到缩略图架构指标"}
        </div>
      ) : !thumbnails ? (
        <div className="rounded border p-3 text-muted-foreground" role="status">
          当前后端未提供缩略图架构指标
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2" aria-label="缩略图架构摘要">
            <MetricTile
              label="已缓存"
              value={formatCount(thumbnails.cachedEntries)}
            />
            <MetricTile
              label="加载中"
              value={formatCount(thumbnails.activeFlights)}
            />
            <MetricTile label="总条目" value={formatCount(totalEntries)} />
          </dl>

          <section
            className="space-y-2 border-t pt-3"
            aria-labelledby="thumbnail-flow-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="thumbnail-flow-heading" className="font-medium">
                请求与生成
              </h3>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>
                  样本 {sampleCount}/{MAX_SAMPLES}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled || !counters}
                  onClick={resetBaseline}
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  重置采样
                </Button>
              </div>
            </div>
            {telemetry ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                <MetricRow
                  label="请求"
                  value={telemetryValue(
                    telemetry.cacheHits + telemetry.cacheMisses,
                    deltas?.demands,
                  )}
                />
                <MetricRow
                  label="命中"
                  value={telemetryValue(telemetry.cacheHits, deltas?.cacheHits)}
                />
                <MetricRow
                  label="未命中"
                  value={telemetryValue(
                    telemetry.cacheMisses,
                    deltas?.cacheMisses,
                  )}
                />
                <MetricRow
                  label="已生成"
                  value={telemetryValue(telemetry.completed, deltas?.completed)}
                />
                <MetricRow
                  label="失败"
                  value={telemetryValue(telemetry.failed, deltas?.failed)}
                />
                <MetricRow
                  label="取消"
                  value={telemetryValue(telemetry.cancelled, deltas?.cancelled)}
                />
                <MetricRow
                  label="淘汰"
                  value={telemetryValue(telemetry.evictions, deltas?.evictions)}
                />
                <MetricRow
                  label="热路径命中率"
                  value={formatHitRate(
                    telemetry.cacheHits,
                    telemetry.cacheMisses,
                  )}
                />
              </dl>
            ) : (
              <Unavailable>当前后端未提供累计缩略图遥测。</Unavailable>
            )}
          </section>

          <section
            className="space-y-2 border-t pt-3"
            aria-labelledby="thumbnail-queue-heading"
          >
            <h3 id="thumbnail-queue-heading" className="font-medium">
              队列与缓存
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              <MetricRow
                label="活动需求"
                value={formatCount(thumbnails.demands)}
              />
              <MetricRow
                label="活动任务"
                value={formatCount(thumbnails.activeFlights)}
              />
              <MetricRow
                label="排队"
                value={formatCount(thumbnails.queuedFlights)}
              />
              <MetricRow
                label="运行中"
                value={formatCount(thumbnails.runningFlights)}
              />
              <MetricRow
                label="缓存条目"
                value={formatCount(thumbnails.cachedEntries)}
              />
              <MetricRow
                label="缓存大小"
                value={formatBytes(thumbnails.cachedBytes)}
              />
            </dl>
          </section>

          <section
            className="space-y-2 border-t pt-3"
            aria-labelledby="thumbnail-lanes-heading"
          >
            <h3 id="thumbnail-lanes-heading" className="font-medium">
              来源与冷热路径
            </h3>
            {telemetry?.byLane ? (
              <div className="min-w-0 overflow-x-auto">
                <table className="w-full min-w-[300px] table-fixed text-left tabular-nums">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr>
                      <th className="w-[38%] pb-1 font-normal">来源</th>
                      <th className="pb-1 font-normal">请求</th>
                      <th className="pb-1 font-normal">命中</th>
                      <th className="pb-1 font-normal">生成</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LANE_ORDER.map((lane) => {
                      const value = telemetry.byLane[lane];
                      return (
                        <tr key={lane} className="border-t">
                          <th className="py-1 pr-2 font-normal">
                            {LANE_LABELS[lane]}
                          </th>
                          <td>{formatCount(value?.demands)}</td>
                          <td>{formatCount(value?.cacheHits)}</td>
                          <td>{formatCount(value?.completed)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Unavailable>当前后端未提供来源 lane 遥测。</Unavailable>
            )}
            <dl className="grid grid-cols-2 gap-2 text-[11px]">
              <DimensionUnavailable label="格式" />
              <DimensionUnavailable label="尺寸" />
            </dl>
          </section>
        </>
      )}
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border p-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function DimensionUnavailable({ label }: { label: string }) {
  return (
    <div className="min-w-0 rounded bg-muted/40 p-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">未采集，避免影响翻页热路径</dd>
    </div>
  );
}

function Unavailable({ children }: { children: string }) {
  return (
    <p className="rounded bg-muted/40 p-2 text-muted-foreground">{children}</p>
  );
}

function counterSnapshot(telemetry: ThumbnailTelemetry): CounterSnapshot {
  return {
    demands: telemetry.cacheHits + telemetry.cacheMisses,
    cacheHits: telemetry.cacheHits,
    cacheMisses: telemetry.cacheMisses,
    completed: telemetry.completed,
    failed: telemetry.failed,
    cancelled: telemetry.cancelled,
    evictions: telemetry.evictions,
  };
}

function subtractCounters(
  current: CounterSnapshot,
  baseline: CounterSnapshot,
): CounterSnapshot {
  return {
    demands: nonNegativeDelta(current.demands, baseline.demands),
    cacheHits: nonNegativeDelta(current.cacheHits, baseline.cacheHits),
    cacheMisses: nonNegativeDelta(current.cacheMisses, baseline.cacheMisses),
    completed: nonNegativeDelta(current.completed, baseline.completed),
    failed: nonNegativeDelta(current.failed, baseline.failed),
    cancelled: nonNegativeDelta(current.cancelled, baseline.cancelled),
    evictions: nonNegativeDelta(current.evictions, baseline.evictions),
  };
}

function nonNegativeDelta(current: number, baseline: number): number {
  return Math.max(0, current - baseline);
}

function addOptional(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  return left === undefined || right === undefined ? undefined : left + right;
}

function telemetryValue(total: number, delta: number | undefined): string {
  return delta === undefined
    ? formatCount(total)
    : `${formatCount(total)} (+${formatCount(delta)})`;
}

function formatCount(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? "不可用"
    : Math.max(0, Math.trunc(value)).toLocaleString("zh-CN");
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "不可用";
  const safe = Math.max(0, value);
  if (safe === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  const power = Math.min(
    units.length - 1,
    Math.floor(Math.log(safe) / Math.log(1_024)),
  );
  const normalized = safe / 1_024 ** power;
  return `${normalized >= 100 || power === 0 ? normalized.toFixed(0) : normalized.toFixed(1)} ${units[power]}`;
}

function formatHitRate(hits: number, misses: number): string {
  const total = hits + misses;
  return total > 0 ? `${((hits / total) * 100).toFixed(1)}%` : "—";
}

function formatTime(value: number | undefined): string {
  return new Date(value ?? Date.now()).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
