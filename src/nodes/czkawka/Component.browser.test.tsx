import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CzkawkaData } from "@xiranite/node-czkawka/core"
import { CZKAWKA_WORKSPACE_DEFAULTS } from "@xiranite/node-czkawka/workspace-layout"

import i18n from "@/i18n"
import { Component } from "./Component"
import type { CzkawkaCardState } from "./types"

const surface = vi.hoisted(() => ({ width: 1440, height: 860, mode: "workspace" }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, ...surface }),
}))

afterEach(async () => {
  Object.assign(surface, { width: 1440, height: 860, mode: "workspace" })
  await i18n.changeLanguage("zh")
})

test("resets a fixed navigator from the source lane menu in the browser", async () => {
  await i18n.changeLanguage("en")
  const host = createHost({
    tool: "duplicate-files",
    includedDirectoriesText: "D:/media",
    workspaceLayout: {
      ...CZKAWKA_WORKSPACE_DEFAULTS,
      navigatorDock: "top",
      navigatorLane: "analysis",
      navigatorFollowsFocus: false,
    },
  })

  await render(<Component compId="czkawka-browser" host={host} />)

  const sourceMenu = page.getByRole("button", { name: /Scan conditions.*\u66f4\u591a\u8bbe\u7f6e/i })
  await sourceMenu.click()
  const reset = page.getByRole("menuitem", { name: "\u91cd\u7f6e\u64cd\u4f5c\u680f\u4f4d\u7f6e" })
  await expect.element(reset).toBeVisible()
  await reset.click()

  await expect.poll(() => host.stateValue.workspaceLayout?.navigatorDock).toBe("floating")
  expect(host.stateValue.workspaceLayout).toMatchObject({
    navigatorLane: "source",
    navigatorPositionX: 96,
    navigatorPositionY: 94,
  })
})

type TestHost = NodeHostApi<CzkawkaCardState, Partial<CzkawkaCardState>> & {
  stateValue: CzkawkaCardState
}

function createHost(initial: CzkawkaCardState): TestHost {
  const host: TestHost = {
    stateValue: initial,
    contract: {
      name: "xiranite.node-host",
      version: "1.0.0",
      supportedCapabilities: ["contract", "state", "runner"],
      hasCapability: () => true,
    },
    env: { theme: "light", platform: "web" },
    localFiles: { getUrl: (path) => `local://${path}` },
    state: {
      getData: () => host.stateValue,
      patchData: (patch) => { host.stateValue = { ...host.stateValue, ...patch } },
    },
    runner: {
      run: async <TInput, TData>(_nodeId: string, _input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => {
        onEvent?.({ type: "progress", progress: 50, message: "Scanning" })
        return { success: true, message: "Completed", data: sample as TData }
      },
      cancelCurrent: async () => true,
    },
    getData: <T,>() => host.stateValue as T,
    patchData: (_id, patch) => { host.stateValue = { ...host.stateValue, ...patch } },
    listComponents: () => [],
    updateComponent: () => undefined,
  }
  return host
}

const sample: CzkawkaData = {
  action: "scan",
  tool: "duplicate-files",
  groups: [],
  entries: [],
  messages: "",
  stopped: false,
  groupCount: 0,
  fileCount: 0,
  totalBytes: 0,
  reclaimableBytes: 0,
  affectedCount: 0,
  errorCount: 0,
}
