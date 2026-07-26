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

test("keeps selection history synchronized with the result table in the browser", async () => {
  const host = createHost({
    tool: "duplicate-files",
    includedDirectoriesText: "D:/media",
    result: selectionResult,
    analysisPanelTab: "selection",
  })

  await render(<Component compId="czkawka-selection-browser" host={host} />)

  const rowCheckbox = page.getByRole("checkbox", { name: "\u9009\u62e9 duplicate-files-result.dat" })
  await rowCheckbox.click()
  await expect.element(rowCheckbox).toHaveAttribute("data-state", "checked")

  await page.getByRole("button", { name: /\u9009\u62e9\u52a9\u624b/ }).click()
  await page.getByRole("button", { name: /\u6e05\u7a7a\u9009\u62e9/ }).click()
  await expect.element(rowCheckbox).toHaveAttribute("data-state", "unchecked")

  const undo = page.getByRole("button", { name: "\u64a4\u9500\u9009\u62e9" })
  await expect.element(undo).toBeVisible()
  await undo.click()
  await expect.element(rowCheckbox).toHaveAttribute("data-state", "checked")
})

test("hides Czkawka 12 image controls until the native binding advertises their capabilities", async () => {
  await i18n.changeLanguage("en")
  const host = createHost({ tool: "similar-images", includedDirectoriesText: "D:/media", sourceSettingsTab: "algorithm" }, [])

  await render(<Component compId="czkawka-image-invariance-unavailable-browser" host={host} />)

  await expect.element(page.getByText("Ignore same resolution")).not.toBeInTheDocument()
  await expect.element(page.getByText("Geometric invariance")).not.toBeInTheDocument()
})

test("persists Czkawka 12 similar-image invariance controls in the browser", async () => {
  await i18n.changeLanguage("en")
  const host = createHost({ tool: "similar-images", includedDirectoriesText: "D:/media", sourceSettingsTab: "algorithm" })

  await render(<Component compId="czkawka-image-invariance-browser" host={host} />)

  const sameResolution = page.getByRole("switch", { name: "Ignore same resolution" })
  await sameResolution.click()
  await expect.poll(() => host.stateValue.similarImagesIgnoreSameResolution).toBe(true)

  const invariance = page.getByRole("combobox", { name: "Geometric invariance" })
  await invariance.click()
  await page.getByRole("option", { name: "Mirror, flip and 90° rotation" }).click()
  await expect.poll(() => host.stateValue.similarImagesGeometricInvariance).toBe("mirror-flip-rotate-90")
})

type TestHost = NodeHostApi<CzkawkaCardState, Partial<CzkawkaCardState>> & {
  stateValue: CzkawkaCardState
}

function createHost(initial: CzkawkaCardState, nativeCapabilities = ["similar-images.geometric-invariance", "similar-images.same-resolution-exclusion"]): TestHost {
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
      getInfo: async <TInfo,>() => ({ apiVersion: 5, sourceVersion: "12.0.0", capabilities: nativeCapabilities }) as TInfo,
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

const selectionEntry = {
  id: "duplicate-files-result.dat",
  groupId: 0,
  path: "duplicate-files-result.dat",
  name: "duplicate-files-result.dat",
  size: 10,
  modifiedDate: 1,
}

const selectionResult: CzkawkaData = {
  ...sample,
  groups: [{ id: 0, entries: [selectionEntry], totalBytes: 10, reclaimableBytes: 0 }],
  entries: [selectionEntry],
  groupCount: 1,
  fileCount: 1,
  totalBytes: 10,
}
