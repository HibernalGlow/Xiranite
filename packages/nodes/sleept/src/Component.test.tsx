// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { PowerMode, SleeptData, SleeptInput } from "./core.js"

afterEach(() => cleanup())

describe("sleept Component", () => {
  test("starts through host.actions.run without forcing dry-run", async () => {
    const host = createHost({ dryrun: false, powerMode: "shutdown", seconds: 1 })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Start"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "sleept",
      input: {
        action: "countdown",
        powerMode: "shutdown",
        hours: 0,
        minutes: 0,
        seconds: 1,
        targetDatetime: expect.any(String),
        uploadThreshold: 242,
        downloadThreshold: 242,
        netDuration: 2,
        netTriggerMode: "both",
        cpuThreshold: 10,
        cpuDuration: 2,
        dryrun: false,
      },
    })
    await waitFor(() => expect(screen.getByText("completed")).toBeTruthy())
    expect(screen.getByText("Countdown completed; executed shutdown.")).toBeTruthy()
  })

  test("refreshes stats through the host runner", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Stats"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({ nodeId: "sleept", input: { action: "get_stats" } })
    expect(screen.getByText("12.5%")).toBeTruthy()
    expect(screen.getByText("3.5")).toBeTruthy()
    expect(screen.getByText("7.5")).toBeTruthy()
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-sleept" host={host} />
    </I18nextProvider>,
  )
}

interface SleeptCardState {
  timerMode?: "countdown" | "specific_time" | "netspeed" | "cpu"
  powerMode?: PowerMode
  hours?: number
  minutes?: number
  seconds?: number
  targetDatetime?: string
  uploadThreshold?: number
  downloadThreshold?: number
  netDuration?: number
  netTriggerMode?: "both" | "any"
  cpuThreshold?: number
  cpuDuration?: number
  dryrun?: boolean
}

type TestHost = NodeHostApi & {
  state: SleeptCardState
  runCalls: Array<{ nodeId: string; input: SleeptInput }>
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
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: { type: "progress" | "log"; progress?: number; message: string }) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as SleeptInput })
        if ((input as SleeptInput).action === "get_stats") {
          return {
            success: true,
            message: "CPU: 12.5%, upload: 3.5KB/s, download: 7.5KB/s",
            data: { ...idleData, currentCpu: 12.5, currentUpload: 3.5, currentDownload: 7.5 },
          } as NodeRunResult<TData>
        }
        onEvent?.({ type: "progress", progress: 100, message: "time reached" })
        return {
          success: true,
          message: "Countdown completed; executed shutdown.",
          data: { ...idleData, timerStatus: "completed" },
        } as NodeRunResult<TData>
      },
    },
    env: {
      theme: "light",
      platform: "node",
    },
  }
  return host
}

const idleData: SleeptData = {
  timerStatus: "idle",
  remainingSeconds: 0,
  currentUpload: 0,
  currentDownload: 0,
  currentCpu: 0,
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
        sleept: {
          title: "sleept",
          meta: "{{timerMode}} / {{powerMode}} / {{mode}}",
          starting: "starting",
          start: "Start",
          stats: "Stats",
          reset: "Reset",
          timerCountdown: "Countdown",
          timerAt: "At",
          timerNet: "Net",
          timerCpu: "CPU",
          powerSleep: "Sleep",
          powerOff: "Off",
          powerReboot: "Reboot",
          dry: "Dry",
          dryRun: "dry-run",
          live: "live",
          statDuration: "duration",
          statCpu: "cpu",
          statUp: "up",
          statDown: "down",
          waiting: "waiting",
          targetDatetime: "target datetime",
          upload: "upload",
          download: "download",
          minutes: "minutes",
          thresholdPct: "threshold %",
          hours: "hours",
          seconds: "seconds",
          phaseIdle: "idle",
          phaseRunning: "running",
          phaseCompleted: "completed",
          phaseError: "error",
          phaseCancelled: "cancelled",
        },
      },
    },
  },
})
