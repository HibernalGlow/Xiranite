// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { RawfilterData, RawfilterInput } from "./core.js"

afterEach(() => cleanup())

describe("rawfilter Component", () => {
  test("pastes clipboard text into folder state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste folder"))

    expect(host.state.pathText).toBe("D:/archives")
  })

  test("runs through host.actions.run and persists result/log output", async () => {
    const host = createHost({ pathText: "D:/archives", minSimilarity: 0.9 })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Plan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "rawfilter",
      input: {
        action: "plan",
        path: "D:/archives",
        nameOnlyMode: false,
        createShortcuts: false,
        trashOnly: false,
        minSimilarity: 0.9,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.duplicateGroups).toBe(1)
    expect(host.state.logs).toEqual(["[25%] Grouped archives.", "Plan generated: 1 operation(s)."])
    expect(screen.getByText(/pending trash Game RAW\.rar/)).toBeTruthy()

    await user.click(screen.getByTitle("Copy plan"))
    expect(host.copiedText).toContain("trash D:/archives/Game RAW.rar -> D:/archives/trash/Game RAW.rar")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-rawfilter" host={host} />
    </I18nextProvider>,
  )
}

interface RawfilterCardState {
  pathText?: string
  nameOnlyMode?: boolean
  createShortcuts?: boolean
  trashOnly?: boolean
  minSimilarity?: number
  result?: RawfilterData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: RawfilterCardState
  runCalls: Array<{ nodeId: string; input: RawfilterInput }>
  copiedText: string
}

function createHost(initial: RawfilterCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as RawfilterInput })
        onEvent?.({ type: "progress", progress: 25, message: "Grouped archives." })
        return {
          success: true,
          message: "Plan generated: 1 operation(s).",
          data: rawfilterData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/archives",
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

const rawfilterData: RawfilterData = {
  archiveCount: 2,
  totalGroups: 1,
  duplicateGroups: 1,
  skippedFiles: 0,
  movedToTrash: 0,
  movedToMulti: 0,
  createdShortcuts: 0,
  keptCount: 1,
  errorCount: 0,
  groups: [],
  errors: [],
  plan: [
    {
      groupKey: "game",
      groupLabel: "game",
      fileName: "Game [Chinese].zip",
      sourcePath: "D:/archives/Game [Chinese].zip",
      targetPath: "",
      destination: "keep",
      status: "kept",
      variant: "translated",
      reason: "preferred_version",
    },
    {
      groupKey: "game",
      groupLabel: "game",
      fileName: "Game RAW.rar",
      sourcePath: "D:/archives/Game RAW.rar",
      targetPath: "D:/archives/trash/Game RAW.rar",
      destination: "trash",
      status: "pending",
      variant: "raw",
      reason: "raw_version_replaced",
    },
  ],
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
        rawfilter: {
          title: "rawfilter",
          meta: "{{phase}} / {{count}} archive(s)",
          plan: "Plan",
          run: "Run",
          copyPlan: "Copy plan",
          copyLogs: "Copy logs",
          reset: "Reset",
          folder: "folder",
          pasteFolder: "Paste folder",
          similarity: "similarity",
          nameOnly: "name only",
          shortcuts: "shortcuts",
          trashOnly: "trash only",
          groups: "groups",
          trash: "trash",
          multi: "multi",
          links: "links",
          errors: "errors",
          noPlanYet: "No plan yet",
        },
      },
    },
  },
})
