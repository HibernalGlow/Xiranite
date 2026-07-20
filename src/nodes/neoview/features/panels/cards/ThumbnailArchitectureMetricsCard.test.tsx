import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ReaderHttpClient,
  ReaderStorageDiagnosticsDto,
} from "../../../adapters/reader-http-client";
import ThumbnailArchitectureMetricsCard from "./ThumbnailArchitectureMetricsCard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ThumbnailArchitectureMetricsCard", () => {
  it("[neoview.thumbnail-architecture-metrics.card] [neoview.thumbnail-architecture-metrics.accessibility] [neoview.thumbnail-architecture-metrics.lanes] preserves the legacy summary and exposes bounded real telemetry", async () => {
    const diagnostics = vi.fn(async () => diagnosticsDto());
    const client = { diagnostics } as unknown as ReaderHttpClient;
    const view = render(
      <ThumbnailArchitectureMetricsCard
        client={client}
        disabled={false}
        panelActive={false}
        onGoTo={() => {}}
      />,
    );
    expect(diagnostics).not.toHaveBeenCalled();

    view.rerender(
      <ThumbnailArchitectureMetricsCard
        client={client}
        disabled={false}
        panelActive
        onGoTo={() => {}}
      />,
    );
    await screen.findByText("已缓存");
    const summary = screen.getByText("已缓存").parentElement!;
    expect(within(summary).getByText("12")).toBeTruthy();
    expect(
      screen.getByText("加载中").parentElement?.textContent,
    ).toContain("2");
    expect(
      screen.getByText("总条目").parentElement?.textContent,
    ).toContain("14");
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "重置采样" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("当前阅读")).toBeTruthy();
    expect(screen.getAllByText("未采集，避免影响翻页热路径")).toHaveLength(2);
    expect(screen.getByText("50.0%")).toBeTruthy();
  });

  it("[neoview.thumbnail-architecture-metrics.lifecycle] [neoview.thumbnail-architecture-metrics.performance] polls after settlement without overlap and aborts when disabled", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: ReaderStorageDiagnosticsDto) => void;
    const first = new Promise<ReaderStorageDiagnosticsDto>((resolve) => {
      resolveFirst = resolve;
    });
    const signals: AbortSignal[] = [];
    const diagnostics = vi.fn((signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return diagnostics.mock.calls.length === 1
        ? first
        : new Promise<ReaderStorageDiagnosticsDto>(() => undefined);
    });
    const client = { diagnostics } as unknown as ReaderHttpClient;
    const view = render(
      <ThumbnailArchitectureMetricsCard
        client={client}
        disabled={false}
        panelActive
        onGoTo={() => {}}
      />,
    );
    expect(diagnostics).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(diagnostics).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst(diagnosticsDto());
      await first;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(diagnostics).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(diagnostics).toHaveBeenCalledTimes(2);

    view.rerender(
      <ThumbnailArchitectureMetricsCard
        client={client}
        disabled
        panelActive
        onGoTo={() => {}}
      />,
    );
    expect(signals[1]?.aborted).toBe(true);
    const calls = diagnostics.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(diagnostics).toHaveBeenCalledTimes(calls);
  });

  it("[neoview.thumbnail-architecture-metrics.reset] keeps cumulative backend telemetry intact and resets only the local baseline", async () => {
    const diagnostics = vi
      .fn()
      .mockResolvedValueOnce(diagnosticsDto())
      .mockResolvedValueOnce(diagnosticsDto(12));
    const client = { diagnostics } as unknown as ReaderHttpClient;
    render(
      <ThumbnailArchitectureMetricsCard
        client={client}
        disabled={false}
        panelActive
        onGoTo={() => {}}
      />,
    );
    await screen.findByText("请求与生成");
    expect(requestMetricValue()).toBe("20 (+0)");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(requestMetricValue()).toBe("22 (+2)"));
    fireEvent.click(screen.getByRole("button", { name: "重置采样" }));
    expect(requestMetricValue()).toBe("22 (+0)");
    expect(diagnostics).toHaveBeenCalledTimes(2);
  });

  it("[neoview.thumbnail-architecture-metrics.card] preserves the last snapshot on a recoverable refresh failure", async () => {
    const diagnostics = vi
      .fn()
      .mockResolvedValueOnce(diagnosticsDto())
      .mockRejectedValueOnce(new Error("diagnostics unavailable"))
      .mockResolvedValueOnce(diagnosticsDto(14));
    const client = { diagnostics } as unknown as ReaderHttpClient;
    render(
      <ThumbnailArchitectureMetricsCard
        client={client}
        disabled={false}
        panelActive
        onGoTo={() => {}}
      />,
    );
    await screen.findByText("已缓存");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("alert");
    expect(
      screen.getByText("已缓存").parentElement?.textContent,
    ).toContain("12");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(requestMetricValue()).toBe("24 (+4)");
  });

  it("[neoview.thumbnail-architecture-metrics.lifecycle] aborts an in-flight request on collapse", () => {
    let signal: AbortSignal | undefined;
    const diagnostics = vi.fn((nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return new Promise<ReaderStorageDiagnosticsDto>(() => undefined);
    });
    const client = { diagnostics } as unknown as ReaderHttpClient;
    const view = render(
      <ThumbnailArchitectureMetricsCard
        client={client}
        disabled={false}
        panelActive
        onGoTo={() => {}}
      />,
    );
    expect(signal?.aborted).toBe(false);
    view.rerender(
      <ThumbnailArchitectureMetricsCard
        client={client}
        disabled={false}
        panelActive={false}
        onGoTo={() => {}}
      />,
    );
    expect(signal?.aborted).toBe(true);
  });
});

function diagnosticsDto(cacheHits = 10): ReaderStorageDiagnosticsDto {
  return {
    schemaVersion: 1,
    sampledAtMs: 1_780_000_000_000,
    reader: { activeSessions: 1 },
    assets: {
      presentation: null,
      thumbnails: {
        demands: 3,
        activeFlights: 2,
        queuedFlights: 1,
        runningFlights: 1,
        cachedEntries: 12,
        cachedBytes: 1_536,
        telemetry: {
          cacheHits,
          cacheMisses: 10,
          completed: 8,
          failed: 1,
          cancelled: 2,
          evictions: 3,
          byLane: {
            "reader-visible": {
              demands: 8,
              cacheHits: 4,
              cacheMisses: 4,
              completed: 3,
              failed: 0,
              cancelled: 1,
            },
            "library-visible": {
              demands: 4,
              cacheHits: 2,
              cacheMisses: 2,
              completed: 2,
              failed: 0,
              cancelled: 0,
            },
            prefetch: {
              demands: 3,
              cacheHits: 1,
              cacheMisses: 2,
              completed: 1,
              failed: 1,
              cancelled: 0,
            },
            "folder-preview": {
              demands: 3,
              cacheHits: 2,
              cacheMisses: 1,
              completed: 1,
              failed: 0,
              cancelled: 0,
            },
            background: {
              demands: 2,
              cacheHits: 1,
              cacheMisses: 1,
              completed: 1,
              failed: 0,
              cancelled: 1,
            },
          },
        },
      },
    },
    presentationDiskCache: { enabled: false },
    solidArchiveCache: { retainedBytes: 0 },
  };
}

function requestMetricValue(): string | null {
  const region = screen.getByRole("region", { name: "请求与生成" });
  return within(region).getByText("请求").parentElement?.querySelector("dd")?.textContent ?? null;
}
