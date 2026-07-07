// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { CleanfData, CleanfInput, CleanfPresetId } from "./core.js"

afterEach(() => cleanup())

describe("cleanf Component", () => {
  test("pastes clipboard paths into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste paths"))

    expect(host.state.pathText).toBe("D:/workspace")
  })

  test("runs preview through host.actions.run and copies logs", async () => {
    const host = createHost({
      pathText: "D:/workspace",
      selectedPresets: ["backup_files", "temp_folders"],
      previewMode: true,
      excludeKeywords: "keep",
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Run"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "cleanf",
      input: {
        paths: ["D:/workspace"],
        presets: ["backup_files", "temp_folders"],
        exclude: "keep",
        preview: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.totalRemoved).toBe(2)
    expect(host.state.logs).toEqual(["Preview completed, found 2 item(s)."])
    expect(screen.getByText("D:/workspace/old.bak")).toBeTruthy()

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("Preview completed, found 2 item(s).")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-cleanf" host={host} />
    </I18nextProvider>,
  )
}

interface CleanfCardState {
  pathText?: string
  selectedPresets?: CleanfPresetId[]
  excludeKeywords?: string
  previewMode?: boolean
  result?: CleanfData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

type TestHost = NodeHostApi & {
  state: CleanfCardState
  runCalls: Array<{ nodeId: string; input: CleanfInput }>
  copiedText: string
}

function createHost(initial: CleanfCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as CleanfInput })
        onEvent?.({ type: "progress", progress: 100, message: "Preview found 2 item(s)." })
        return {
          success: true,
          message: "Preview completed, found 2 item(s).",
          data: cleanfData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/workspace",
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

const cleanfData: CleanfData = {
  totalRemoved: 2,
  removedDetails: { backup_files: 1, temp_folders: 1 },
  previewFiles: ["D:/workspace/old.bak", "D:/workspace/temp_cache"],
  skipped: 0,
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
        cleanf: {
          title: "cleanf",
          run: "Run",
          pastePaths: "Paste paths",
          copyLogs: "Copy logs",
          reset: "Reset",
          preview: "Preview",
          delete: "Delete",
          paths: "paths",
          placeholderPaths: "one folder path per line",
          found: "found",
          skipped: "skipped",
          excludeKeywords: "exclude keywords",
          noResult: "No result",
          previewing: "Previewing...",
          cleaning: "Cleaning...",
          meta: "{{paths}} path(s) / {{presets}} preset(s) / {{state}}",
        },
      },
    },
  },
})
