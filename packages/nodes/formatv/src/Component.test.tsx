// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { FormatvAction, FormatvData, FormatvInput } from "./core.js"

afterEach(() => cleanup())

describe("formatv Component", () => {
  test("pastes clipboard paths into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste paths"))

    expect(host.state.pathText).toBe("D:/videos")
  })

  test("runs scan through host.actions.run and copies scan results", async () => {
    const host = createHost({
      pathText: "D:/videos",
      prefixName: "hb",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Scan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "formatv",
      input: {
        action: "scan",
        paths: ["D:/videos"],
        recursive: false,
        prefixName: "hb",
        dryRun: false,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.normalCount).toBe(1)
    expect(host.state.result?.novCount).toBe(1)
    expect(host.state.logs).toEqual(["[100%] formatv complete.", "Scan completed: 1 normal, 1 .nov."])
    expect(screen.getByText(/normal D:\/videos\/a\.mp4/)).toBeTruthy()
    expect(screen.getByText(/\.nov D:\/videos\/b\.mkv\.nov/)).toBeTruthy()
    expect(screen.getByText(/hb D:\/videos\/\[#hb\]c\.mp4/)).toBeTruthy()

    await user.click(screen.getByTitle("Copy results"))
    expect(host.copiedText).toBe("D:/videos/a.mp4\nD:/videos/b.mkv.nov")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-formatv" host={host} />
    </I18nextProvider>,
  )
}

interface FormatvCardState {
  pathText?: string
  prefixName?: string
  recursive?: boolean
  dryRun?: boolean
  result?: FormatvData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: FormatvCardState
  runCalls: Array<{ nodeId: string; input: FormatvInput }>
  copiedText: string
}

function createHost(initial: FormatvCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as FormatvInput })
        onEvent?.({ type: "progress", progress: 100, message: "formatv complete." })
        return {
          success: true,
          message: "Scan completed: 1 normal, 1 .nov.",
          data: formatvData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/videos",
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

const formatvData: FormatvData = {
  normalCount: 1,
  novCount: 1,
  prefixedCounts: { hb: 1 },
  normalFiles: ["D:/videos/a.mp4"],
  novFiles: ["D:/videos/b.mkv.nov"],
  prefixedFiles: { hb: ["D:/videos/[#hb]c.mp4"] },
  successCount: 0,
  errorCount: 0,
  skippedCount: 0,
  duplicateCount: 0,
  duplicates: [],
  prefixedLarger: [],
  operations: [],
  reportPath: "",
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
        formatv: {
          title: "formatv",
          meta: "{{phase}} / {{count}} path(s) / {{mode}}",
          phaseIdle: "idle",
          phaseScan: "scan",
          phaseAddNov: "add .nov",
          phaseRemoveNov: "remove .nov",
          phaseCheckDuplicates: "check dup",
          phaseCompleted: "completed",
          phaseError: "error",
          dryRun: "dry-run",
          write: "write",
          scan: "Scan",
          dup: "Dup",
          copyResults: "Copy results",
          copyLogs: "Copy logs",
          reset: "Reset",
          pastePaths: "Paste paths",
          fieldPaths: "paths",
          fieldPrefix: "prefix",
          recursive: "recursive",
          statNormal: "normal",
          statSuccess: "success",
          statDups: "dups",
          statErrors: "errors",
          noScanYet: "No scan yet",
          noVideoFiles: "No video files",
        },
      },
    },
  },
})
