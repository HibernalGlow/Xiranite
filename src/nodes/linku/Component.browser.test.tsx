import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { LinkuData, LinkuInput } from "@xiranite/node-linku/core"

import i18n from "@/i18n"
import { Component } from "./Component"
import type { LinkuCardState } from "./types"

const surface = vi.hoisted(() => ({ width: 1440, height: 860, mode: "workspace" }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, ...surface }),
}))

afterEach(async () => {
  cleanup()
  Object.assign(surface, { width: 1440, height: 860, mode: "workspace" })
  await i18n.changeLanguage("zh")
})

test("confirms and runs Linku restore without retaining the removed record", async () => {
  await i18n.changeLanguage("zh")
  const host = createHost({ path: "C:/original-link" })

  await render(<Component compId="linku-restore-browser" host={host} />)

  await page.getByRole("button", { name: "还原链接" }).click()
  expect(host.runCalls).toEqual([])
  await expect.element(page.getByRole("heading", { name: "确认执行「还原链接」？" })).toBeVisible()

  await page.getByRole("button", { name: "确认执行" }).click()

  await expect.poll(() => host.runCalls).toHaveLength(1)
  expect(host.runCalls[0]).toEqual({
    nodeId: "linku",
    input: {
      action: "restore",
      path: "C:/original-link",
      target: undefined,
      configPath: undefined,
    },
  })
  await expect.element(page.getByText("已还原", { exact: true })).toBeVisible()
  await expect.element(page.getByText("暂无关联记录")).toBeVisible()
})

type TestHost = NodeHostApi & {
  runCalls: Array<{ nodeId: string; input: LinkuInput }>
  state: LinkuCardState
}

function createHost(initial: LinkuCardState): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as LinkuInput })
        return {
          success: true,
          message: "已还原链接。",
          data: restoredData as TData,
        }
      },
    },
    env: { theme: "light", platform: "web" },
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/xiranite.config.toml" }),
  }
  return host
}

const restoredData: LinkuData = {
  links: [],
  created: false,
  recoveredCount: 0,
  restoredCount: 1,
  failedCount: 0,
  importedCount: 0,
  skippedCount: 0,
}
