import { afterEach, expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { SleeptData, SleeptInput } from "@xiranite/node-sleept/core"

import { Component } from "./Component"
import type { SleeptCardState } from "./types"

const surface = vi.hoisted(() => ({ height: 860, mode: "workspace", width: 1440 }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, ...surface }),
}))

afterEach(() => {
  cleanup()
  Object.assign(surface, { height: 860, mode: "workspace", width: 1440 })
})

test("selects hibernate in the GUI and sends it through the dry-run command", async () => {
  const host = createHost({ seconds: 5, timerMode: "countdown" })

  await render(<Component compId="sleept-hibernate-browser" host={host} />)

  await page.getByRole("tab", { name: "休眠" }).click()
  await expect.poll(() => host.state.powerMode).toBe("hibernate")

  await page.getByRole("button", { name: "开始演练" }).click()
  await expect.poll(() => host.runCalls).toHaveLength(1)
  expect(host.runCalls[0]).toMatchObject({
    nodeId: "sleept",
    input: { action: "countdown", dryrun: true, powerMode: "hibernate" },
  })
})

type TestHost = NodeHostApi & {
  runCalls: Array<{ nodeId: string; input: SleeptInput }>
  state: SleeptCardState
}

function createHost(initial: SleeptCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as SleeptInput })
        return {
          success: true,
          message: "Countdown completed; simulated hibernate.",
          data: completedData as TData,
        }
      },
    },
    clipboard: {
      readText: async () => "",
      writeText: async () => undefined,
    },
    env: { platform: "web", theme: "light" },
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/xiranite.config.toml" }),
  }
  return host
}

const completedData: SleeptData = {
  timerStatus: "completed",
  remainingSeconds: 0,
  currentUpload: 0,
  currentDownload: 0,
  currentCpu: 0,
}
