// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { SeriexData, SeriexInput } from "./core.js"

afterEach(() => cleanup())

describe("seriex Component", () => {
  test("pastes the directory path from the clipboard", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste directory"))

    expect(host.state.directoryPath).toBe("D:/series")
  })

  test("runs plan through host.actions.run and copies progress logs", async () => {
    const host = createHost({
      directoryPath: "D:/series",
      configPath: "D:/seriex.toml",
      knownSeriesText: "Alpha\nBeta",
      prefix: "#",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Plan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "seriex",
      input: {
        action: "plan",
        directoryPath: "D:/series",
        configPath: "D:/seriex.toml",
        knownSeriesNames: ["Alpha", "Beta"],
        prefix: "#",
        dryRun: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[15%] Planning D:/series", "Plan generated: 1 series, 2 file(s)."])
    expect(host.state.result?.planItems[0]?.folder).toBe("#Alpha")
    expect(screen.getByText("#Alpha")).toBeTruthy()

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[15%] Planning D:/series\nPlan generated: 1 series, 2 file(s).")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-seriex" host={host} />
    </I18nextProvider>,
  )
}

interface SeriexCardState {
  directoryPath?: string
  configPath?: string
  knownSeriesText?: string
  prefix?: string
  result?: SeriexData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: SeriexCardState
  runCalls: Array<{ nodeId: string; input: SeriexInput }>
  copiedText: string
}

function createHost(initial: SeriexCardState): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: { type: "progress" | "log"; progress?: number; message: string }) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as SeriexInput })
        onEvent?.({ type: "progress", progress: 15, message: "Planning D:/series" })
        return {
          success: true,
          message: "Plan generated: 1 series, 2 file(s).",
          data: seriexData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/series",
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

const seriexData: SeriexData = {
  plan: {
    "D:/series": {
      "#Alpha": ["D:/series/Alpha 01.mp4", "D:/series/Alpha 02.mp4"],
    },
  },
  summary: {},
  planItems: [{
    directory: "D:/series",
    folder: "#Alpha",
    files: ["D:/series/Alpha 01.mp4", "D:/series/Alpha 02.mp4"],
  }],
  moveItems: [],
  totalSeries: 1,
  totalFiles: 2,
  movedCount: 0,
  failedCount: 0,
  errors: [],
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
        seriex: {
          title: "seriex",
          meta: "{{phase}} / {{count}} group(s)",
          idle: "idle",
          plan: "Plan",
          apply: "Apply",
          copyLogs: "Copy logs",
          reset: "Reset",
          directory: "directory",
          config: "config",
          prefix: "prefix",
          pasteDirectory: "Paste directory",
          pasteConfig: "Paste config",
          statSeries: "series",
          statFiles: "files",
          statMoved: "moved",
          statFailed: "failed",
          planFiles: "{{count}} file(s) / {{directory}}",
          ok: "OK",
          fail: "FAIL",
          moveResult: "{{status}} {{filename}} -> {{folder}}",
          noResult: "No result",
          knownSeries: "known series",
        },
      },
    },
  },
})
