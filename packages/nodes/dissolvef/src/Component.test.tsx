// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { DissolvefData, DissolvefInput } from "./core.js"

afterEach(() => cleanup())

describe("dissolvef Component", () => {
  test("pastes folder path into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste folder"))

    expect(host.state.pathText).toBe("D:/library/outer")
  })

  test("runs plan through host.actions.run and copies logs", async () => {
    const host = createHost({
      pathText: "D:/library/outer",
      historyPath: "D:/library/history.json",
      excludeText: "#skip",
      nested: true,
      media: false,
      archive: true,
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Plan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "dissolvef",
      input: {
        action: "plan",
        path: "D:/library/outer",
        historyPath: "D:/library/history.json",
        undoId: undefined,
        exclude: "#skip",
        nested: true,
        media: false,
        archive: true,
        direct: false,
        preview: true,
        protectFirstLevel: true,
        enableSimilarity: true,
        similarityThreshold: 0.6,
        fileConflict: undefined,
        dirConflict: undefined,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[50%] planning D:/library/outer", "Plan generated: 1 operation(s)."])
    expect(host.state.result?.totalCount).toBe(1)
    expect(screen.getByText(/pending nested move D:\/library\/outer\/inner\/leaf\/page\.txt/)).toBeTruthy()

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[50%] planning D:/library/outer\nPlan generated: 1 operation(s).")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-dissolvef" host={host} />
    </I18nextProvider>,
  )
}

interface DissolvefCardState {
  pathText?: string
  historyPath?: string
  excludeText?: string
  nested?: boolean
  media?: boolean
  archive?: boolean
  direct?: boolean
  preview?: boolean
  protectFirstLevel?: boolean
  enableSimilarity?: boolean
  similarityThreshold?: number
  fileConflict?: string
  dirConflict?: string
  undoId?: string
  result?: DissolvefData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: DissolvefCardState
  runCalls: Array<{ nodeId: string; input: DissolvefInput }>
  copiedText: string
}

function createHost(initial: DissolvefCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as DissolvefInput })
        onEvent?.({ type: "progress", progress: 50, message: "planning D:/library/outer" })
        return {
          success: true,
          message: "Plan generated: 1 operation(s).",
          data: dissolvefData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/library/outer",
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

const dissolvefData: DissolvefData = {
  plan: [
    {
      mode: "nested",
      operation: "move",
      sourcePath: "D:/library/outer/inner/leaf/page.txt",
      targetPath: "D:/library/outer/page.txt",
      itemKind: "file",
      status: "pending",
      similarity: 1,
    },
  ],
  history: [],
  archivePaths: [],
  nestedCount: 1,
  mediaCount: 0,
  archiveCount: 0,
  directFiles: 0,
  directDirs: 0,
  skippedCount: 0,
  totalCount: 1,
  successCount: 0,
  failedCount: 0,
  errorCount: 0,
  operationId: "",
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
        dissolvef: {
          title: "dissolvef",
          plan: "Plan",
          run: "Run",
          history: "History",
          undo: "Undo",
          copyLogs: "Copy logs",
          reset: "Reset",
          folder: "folder",
          pasteFolder: "Paste folder",
          historyPath: "history",
          bundle: "bundle",
          direct: "direct",
          nested: "nested",
          media: "media",
          archive: "archive",
          preview: "preview",
          protect: "protect",
          similarity: "similarity",
          exclude: "exclude",
          threshold: "threshold",
          fileConflict: "file conflict",
          dirConflict: "dir conflict",
          skipped: "skipped",
          errors: "errors",
          operations: "operation(s)",
          undone: "undone",
          none: "none",
          noResult: "No result",
          meta: "{{phase}} / {{mode}}",
          phases: {
            idle: "idle",
            running: "running",
            completed: "completed",
            error: "error",
          },
        },
      },
    },
  },
})
