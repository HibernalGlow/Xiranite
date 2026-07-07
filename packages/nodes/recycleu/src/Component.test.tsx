// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { RecycleuData, RecycleuInput } from "./core.js"

afterEach(() => cleanup())

describe("recycleu Component", () => {
  test("streams countdown progress and logs from host.actions.run", async () => {
    const host = createHost({ interval: 5, maxCycles: 1, driveLetter: "C" })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Start"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "recycleu",
      input: {
        action: "start",
        interval: 5,
        maxCycles: 1,
        driveLetter: "C",
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.cleanCount).toBe(1)
    expect(host.state.lastCleanTime).toBe("01:02:03")
    expect(host.state.logs).toEqual([
      "Recycle bin emptied.",
      "cleaned 1 time(s), next clean in 5s",
      "cleaned 1 time(s), next clean in 4s",
      "Auto-clean completed, cleaned 1 time(s).",
    ])
    expect(host.state.progressText).toBe("Auto-clean completed, cleaned 1 time(s).")
  })

  test("shows host execution failures instead of leaving the card stuck", async () => {
    const host = createHost({ interval: 5 })
    host.failNextRun = true
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Clean"))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.progressText).toBe("backend unavailable")
    expect(host.state.logs).toEqual(["backend unavailable"])
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-recycleu" host={host} />
    </I18nextProvider>,
  )
}

interface RecycleuCardState {
  interval?: number
  maxCycles?: number
  driveLetter?: string
  cleanCount?: number
  lastCleanTime?: string | null
  phase?: string
  logs?: string[]
  progress?: number
  progressText?: string
  remainingSeconds?: number
}

type TestHost = NodeHostApi & {
  state: RecycleuCardState
  runCalls: Array<{ nodeId: string; input: RecycleuInput }>
  copiedText: string
  failNextRun: boolean
}

function createHost(initial: RecycleuCardState): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    failNextRun: false,
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: { type: "progress" | "log"; progress?: number; message: string }) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as RecycleuInput })
        if (host.failNextRun) throw new Error("backend unavailable")
        onEvent?.({ type: "log", message: "Recycle bin emptied." })
        onEvent?.({ type: "progress", progress: 0, message: "cleaned 1 time(s), next clean in 5s" })
        onEvent?.({ type: "progress", progress: 20, message: "cleaned 1 time(s), next clean in 4s" })
        return {
          success: true,
          message: "Auto-clean completed, cleaned 1 time(s).",
          data: recycleuData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    env: {
      theme: "light",
      platform: "node",
    },
  }
  return host
}

const recycleuData: RecycleuData = {
  timerStatus: "completed",
  cleanCount: 1,
  lastCleanTime: "01:02:03",
  remainingSeconds: 0,
}

const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: ["module"],
  defaultNS: "module",
  interpolation: { escapeValue: false },
  resources: {
    en: {
      module: {
        recycleu: {
          title: "recycleu",
          meta: "{{phase}} / {{interval}}s",
          starting: "Starting...",
          start: "Start",
          clean: "Clean",
          copyLogs: "Copy logs",
          reset: "Reset",
          intervalSeconds: "interval seconds",
          cycles: "cycles",
          driveLetter: "drive",
          runs: "{{count}} run(s)",
          phase: "phase",
          last: "last",
          progress: "progress",
          waiting: "Waiting",
        },
      },
    },
  },
})
