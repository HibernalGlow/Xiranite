// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  NodeHostApi,
  NodeRunEvent,
  NodeRunResult,
} from "@xiranite/contract";
import {
  NODE_SURFACE_TEST_MODES,
  NODE_SURFACE_TEST_SPECS,
} from "@/nodes/shared/nodeSurfaceTestUtils";
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface";
import type { ScoolpData, ScoolpInput } from "@xiranite/node-scoolp/core";
import { Component } from "./Component";
import type { ScoolpCardState } from "./types";

const surfaceState = vi.hoisted(() => ({
  height: 420,
  width: 720,
}));

vi.mock("@/nodes/shared/useNodeSurface", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/nodes/shared/useNodeSurface")>();
  return {
    ...actual,
    useNodeSurface: () => {
      const mode = actual.resolveNodeSurfaceMode(surfaceState);
      return {
        ref: { current: null },
        width: surfaceState.width,
        height: surfaceState.height,
        mode,
        density: actual.resolveNodeSurfaceDensity(mode),
      };
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setSurface("regular");
});

describe("app-owned scoolp Component", () => {
  test.each(NODE_SURFACE_TEST_MODES)(
    "renders the %s surface with Scoolp-specific UI",
    (mode) => {
      setSurface(mode);
      render(
        <Component
          compId="comp-scoolp"
          host={createHost({ configText: '[scoop]\nroot = "D:/scoop"' })}
        />,
      );

      expect(screen.getByText("Scoolp")).toBeTruthy();
      if (mode === "collapsed") {
        expect(screen.getByTestId("scoolp-collapsed-view")).toBeTruthy();
        expect(screen.queryByTestId("scoolp-action-picker")).toBeNull();
        return;
      }

      expect(screen.getByTestId("scoolp-action-picker")).toBeTruthy();

      if (mode === "compact") {
        expect(screen.getByTestId("scoolp-compact-view")).toBeTruthy();
        expect(
          screen.getByRole("button", { name: "scoolp advanced options" }),
        ).toBeTruthy();
      } else if (mode === "portrait") {
        expect(screen.getByTestId("scoolp-portrait-view")).toBeTruthy();
        expect(screen.getByTestId("scoolp-key-switches")).toBeTruthy();
      } else {
        expect(screen.getByTestId("scoolp-full-view")).toBeTruthy();
        expect(screen.getByRole("tab", { name: "状态" })).toBeTruthy();
        expect(screen.getByText("Scoop 状态")).toBeTruthy();
        expect(screen.getByTestId("scoolp-header-toolbar")).toBeTruthy();
        expect(screen.getByTestId("scoolp-stats-panel")).toBeTruthy();
      }
    },
  );

  test("renders cache as the data-first workbench in full surfaces", () => {
    setSurface("workspace");
    render(
      <Component
        compId="comp-scoolp"
        host={createHost({
          action: "cache_list",
          result: scoolpData,
          cachePath: "D:/scoop/cache",
        })}
      />,
    );

    expect(screen.getByText("缓存分析")).toBeTruthy();
    expect(screen.getByText("可处理项目")).toBeTruthy();
    expect(screen.getByText("扫描范围")).toBeTruthy();
    expect(screen.getByText("7zip#23.0#x64")).toBeTruthy();
  });

  test("switches wide workspaces through the shared tab component", async () => {
    setSurface("workspace");
    render(
      <Component
        compId="comp-scoolp"
        host={createHost({ cachePath: "D:/scoop/cache" })}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "缓存" }));

    expect(screen.getByText("缓存分析")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "缓存" }).getAttribute("data-state"),
    ).toBe("active");
  });

  test("forces collapsed content when compact surface height is too short", () => {
    setSurfaceSize({ width: 420, height: 159 });

    render(
      <Component
        compId="comp-scoolp"
        host={createHost({ configText: '[scoop]\nroot = "D:/scoop"' })}
      />,
    );

    expect(screen.getByTestId("scoolp-collapsed-view")).toBeTruthy();
    expect(screen.queryByTestId("scoolp-action-picker")).toBeNull();
  });

  test("uses portrait compact layout for tall compact surfaces", () => {
    setSurfaceSize({ width: 559, height: 300 });

    render(
      <Component
        compId="comp-scoolp"
        host={createHost({ configText: '[scoop]\nroot = "D:/scoop"' })}
      />,
    );

    expect(screen.getByTestId("scoolp-portrait-view")).toBeTruthy();
    expect(screen.queryByTestId("scoolp-compact-view")).toBeNull();
  });

  test("switches action to cache delete and runs a scan through host.actions.run", async () => {
    setSurface("regular");
    const host = createHost({
      configText: "",
      cachePath: "D:/scoop/cache",
      logs: [],
    });
    render(<Component compId="comp-scoolp" host={host} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "扫描缓存" }));
    await user.click(screen.getByRole("button", { name: "执行扫描" }));

    await waitFor(() => expect(host.runCalls).toHaveLength(1));
    expect(host.runCalls[0]).toEqual({
      nodeId: "scoolp",
      input: {
        action: "cache_list",
        path: undefined,
        configText: "",
        packageName: undefined,
        packages: [],
        cachePath: "D:/scoop/cache",
        scoopRoot: undefined,
        dryRun: true,
      },
    });

    await waitFor(() => expect(host.state.phase).toBe("completed"));
    expect(host.state.result?.cache?.obsoleteCount).toBe(2);
    expect(host.state.logs?.at(-1)).toBe(
      "Found 2 obsolete cache file(s), 1.00 KB.",
    );
  });

  test("uses confirmation before deleting cache files when dry run is disabled", async () => {
    setSurface("regular");
    const host = createHost({
      cachePath: "D:/scoop/cache",
      dryRun: false,
      logs: [],
    });
    render(<Component compId="comp-scoolp" host={host} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "清理缓存" }));
    await user.click(screen.getByRole("button", { name: "真实清理" }));

    expect(host.runCalls).toHaveLength(0);
    expect(screen.getByText("确认删除过时缓存？")).toBeTruthy();

    await user.click(screen.getByText("确认执行"));
    await waitFor(() => expect(host.runCalls).toHaveLength(1));
    expect(host.runCalls[0]?.input.action).toBe("cache_delete");
    expect(host.runCalls[0]?.input.dryRun).toBe(false);
  });

  test("runs sync dry-run locally without invoking host.actions.run", async () => {
    setSurface("regular");
    const host = createHost({
      configText: '[scoop]\nroot = "D:/scoop"\n\n[[bucket]]\nname = "main"\n',
      logs: [],
    });
    render(<Component compId="comp-scoolp" host={host} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "同步 Bucket" }));
    await user.click(screen.getByRole("button", { name: "执行同步" }));

    await waitFor(() => expect(host.state.phase).toBe("completed"));
    expect(host.runCalls).toHaveLength(0);
    expect(host.state.result?.syncPlan.length).toBeGreaterThan(0);
    expect(host.state.progress).toBe(100);
  });

  test("catches thrown runner errors and appends the message to logs", async () => {
    setSurface("regular");
    const host = createHost(
      { cachePath: "D:/scoop/cache", logs: [] },
      { runError: new Error("backend offline") },
    );
    render(<Component compId="comp-scoolp" host={host} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "扫描缓存" }));
    await user.click(screen.getByRole("button", { name: "执行扫描" }));

    await waitFor(() => expect(host.state.phase).toBe("error"));
    expect(host.state.progressText).toBe("backend offline");
    expect(host.state.logs?.at(-1)).toBe("backend offline");
  });

  test("uses the shared configuration-management workflow", async () => {
    setSurface("regular");
    const host = createHost(
      { configText: '[scoop]\nroot = "D:/current"', dryRun: true },
      { config: { configText: '[scoop]\nroot = "D:/default"', dryRun: false } },
    );
    render(<Component compId="comp-scoolp" host={host} />);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "配置管理" })).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: "配置管理" }));
    await user.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(host.state.configText).toBe('[scoop]\nroot = "D:/default"');
    expect(host.state.dryRun).toBe(false);

    await user.click(screen.getByRole("button", { name: "保存为默认" }));
    expect(host.savedConfig).toBeDefined();

    await user.click(screen.getByRole("button", { name: "重新读取" }));

    await user.click(screen.getByRole("button", { name: "打开文件" }));
    expect(host.openConfigFileCalls).toBe(1);
  });
});

type TestHost = NodeHostApi & {
  copiedText: string;
  openConfigFileCalls: number;
  runCalls: Array<{ nodeId: string; input: ScoolpInput }>;
  savedConfig: Partial<ScoolpCardState> | undefined;
  state: ScoolpCardState;
};

type HostOptions = {
  config?: Partial<ScoolpCardState>;
  runError?: Error;
  runResult?: NodeRunResult<ScoolpData>;
};

function createHost(
  initial: ScoolpCardState,
  options: HostOptions = {},
): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    savedConfig: undefined,
    openConfigFileCalls: 0,
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch };
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(
        nodeId: string,
        input: TInput,
        onEvent?: (event: NodeRunEvent) => void,
      ): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as ScoolpInput });
        if (options.runError) throw options.runError;
        onEvent?.({
          type: "progress",
          progress: 30,
          message: "Scanning cache.",
        });
        onEvent?.({ type: "log", message: "Reading cache files." });
        onEvent?.({
          type: "progress",
          progress: 100,
          message: "Scan complete.",
        });
        return (options.runResult ?? {
          success: true,
          message: "Found 2 obsolete cache file(s), 1.00 KB.",
          data: scoolpData,
        }) as NodeRunResult<TData>;
      },
    },
    clipboard: {
      readText: async () => '[scoop]\nroot = "D:/scoop"',
      writeText: async (text) => {
        host.copiedText = text;
      },
    },
    env: {
      theme: "light",
      platform: "web",
    },
    getNodeConfig: async <T,>() => ({
      config: options.config as T | undefined,
      path: "D:/config/xiranite.config.toml",
    }),
    saveNodeConfig: async (config) => {
      host.savedConfig = config as Partial<ScoolpCardState>;
    },
    openConfigFile: () => {
      host.openConfigFileCalls += 1;
    },
  };
  return host;
}

function setSurface(mode: NodeSurfaceMode) {
  setSurfaceSize(NODE_SURFACE_TEST_SPECS[mode]);
}

function setSurfaceSize(size: { height: number; width: number }) {
  surfaceState.width = size.width;
  surfaceState.height = size.height;
}

const scoolpData: ScoolpData = {
  scoopInstalled: true,
  installedPackages: ["7zip", "git"],
  buckets: ["main", "extras"],
  availablePackages: [],
  syncPlan: [],
  commandResults: [],
  installedCount: 0,
  failedCount: 0,
  cleanedCount: 0,
  cleanedSizeBytes: 0,
  errors: [],
  cache: {
    path: "D:/scoop/cache",
    fileCount: 8,
    softwareCount: 4,
    obsoleteCount: 2,
    obsoleteSize: 1024,
    obsoletePackages: [
      {
        name: "7zip",
        version: "23.0",
        size: 512,
        filename: "7zip#23.0#x64",
        path: "D:/scoop/cache/7zip#23.0#x64",
      },
      {
        name: "git",
        version: "2.40.0",
        size: 512,
        filename: "git#2.40.0#x64",
        path: "D:/scoop/cache/git#2.40.0#x64",
      },
    ],
  },
};
