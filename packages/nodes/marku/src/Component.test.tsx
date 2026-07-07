// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { MarkuData, MarkuInput } from "./core.js"

afterEach(() => cleanup())

describe("marku Component", () => {
  test("pastes clipboard text into text input state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste text"))

    expect(host.state.inputText).toBe("# Title")
  })

  test("runs text mode through host.actions.run and copies output", async () => {
    const host = createHost({ inputText: "# Title", module: "markt", configText: "{\"indent\":2}" })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Run"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "marku",
      input: {
        action: "text",
        module: "markt",
        inputText: "# Title",
        paths: [],
        stepConfig: { indent: 2 },
        recursive: false,
        dryRun: true,
        enableUndo: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.outputText).toBe("- Title")
    expect(host.state.logs).toEqual(["[50%] Processing text.", "Text processed: changed."])
    expect(screen.getByText("- Title")).toBeTruthy()

    await user.click(screen.getByTitle("Copy output"))
    expect(host.copiedText).toBe("- Title")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-marku" host={host} />
    </I18nextProvider>,
  )
}

interface MarkuCardState {
  inputText?: string
  pathText?: string
  module?: string
  configText?: string
  recursive?: boolean
  dryRun?: boolean
  enableUndo?: boolean
  result?: MarkuData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: MarkuCardState
  runCalls: Array<{ nodeId: string; input: MarkuInput }>
  copiedText: string
}

function createHost(initial: MarkuCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as MarkuInput })
        onEvent?.({ type: "progress", progress: 50, message: "Processing text." })
        return {
          success: true,
          message: "Text processed: changed.",
          data: markuData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "# Title",
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

const markuData: MarkuData = {
  filesProcessed: 1,
  filesChanged: 1,
  inputText: "# Title",
  outputText: "- Title",
  diffText: "",
  diffs: [],
  history: [],
  undoId: "",
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
        marku: {
          title: "marku",
          meta: "{{phase}} / {{module}} / {{mode}}",
          run: "Run",
          history: "History",
          undo: "Undo",
          copyOutput: "Copy output",
          copyLogs: "Copy logs",
          reset: "Reset",
          textInputLabel: "text input",
          textInputPlaceholder: "paste markdown text, or leave empty to use paths",
          pathsConfigLabel: "paths / config",
          pathsConfigPlaceholder: "one file or folder per line",
          configJsonLabel: "config json",
          pasteText: "Paste text",
          pastePath: "Paste path",
          recursive: "recursive",
          dryRun: "dry-run",
          writeMode: "write",
          undoToggle: "undo",
          processedLabel: "processed",
          changed: "changed",
          same: "same",
          diffsLabel: "diffs",
          errorsLabel: "errors",
          historyItem: "{{id}} {{module}} {{count}} file(s)",
          undoneLabel: "/ undone",
          noResult: "No result",
        },
      },
    },
  },
})
