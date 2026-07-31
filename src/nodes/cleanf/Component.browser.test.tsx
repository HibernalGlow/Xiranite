import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { CleanfData, CleanfInput } from "@xiranite/node-cleanf/core"
import i18n from "@/i18n"
import { Component } from "./Component"
import type { CleanfCardState } from "./types"

const surface = vi.hoisted(() => ({ height: 760, mode: "regular", width: 1200 }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, ...surface }),
}))

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("zh")
})

test("undo last cleanup sends the scoped undo action and renders the restored count", async () => {
  await i18n.changeLanguage("zh")
  const host = createHost()

  await render(<Component compId="cleanf-undo-browser" host={host} />)

  const undo = page.getByRole("button", { name: "撤销上次清理" })
  await expect.element(undo).toBeVisible()
  await undo.click()

  await expect.poll(() => host.runCalls).toEqual([{ nodeId: "cleanf", input: { action: "undo" } }])
  await expect.element(page.getByText("已恢复 2 项", { exact: true })).toBeVisible()
  await expect.element(page.getByText("恢复 2", { exact: true })).toBeVisible()
})

type TestHost = NodeHostApi & {
  runCalls: Array<{ nodeId: string; input: CleanfInput }>
  state: CleanfCardState
}

function createHost(): TestHost {
  const host: TestHost = {
    state: { pathText: "D:/workspace", previewMode: true },
    runCalls: [],
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as CleanfInput })
        return {
          success: true,
          message: "Undo completed, restored 2 item(s).",
          data: restoredData as TData,
        }
      },
    },
    clipboard: { readText: async () => "", writeText: async () => undefined },
    env: { theme: "light", platform: "web" },
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/xiranite.config.toml" }),
  }
  return host
}

const restoredData: CleanfData = {
  totalRemoved: 0,
  removedDetails: {},
  previewFiles: [],
  skipped: 0,
  restored: 2,
  undoAvailable: false,
  undoPersistent: true,
}
