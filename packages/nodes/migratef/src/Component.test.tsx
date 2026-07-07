// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { MigratefData, MigratefInput, MigratefMode } from "./core.js"

afterEach(() => cleanup())

describe("migratef Component", () => {
  test("pastes clipboard values and switches migration mode", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste target"))
    await user.click(screen.getByText("Direct"))

    expect(host.state.targetPath).toBe("D:/target")
    expect(host.state.mode).toBe("direct")
  })

  test("runs plan through host.actions.run and copies logs", async () => {
    const host = createHost({
      sourceText: "D:/source/a.txt\nD:/source/b.txt",
      targetPath: "D:/target",
      historyPath: "D:/history.json",
      mode: "flat",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Plan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "migratef",
      input: {
        action: "plan",
        mode: "flat",
        sourcePaths: ["D:/source/a.txt", "D:/source/b.txt"],
        targetPath: "D:/target",
        historyPath: "D:/history.json",
        dryRun: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.plan).toHaveLength(2)
    expect(host.state.logs).toEqual(["[42%] Planning migration.", "Plan generated: 2 item(s)."])
    expect(screen.getAllByText(/D:\/source\/a\.txt/).length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[42%] Planning migration.\nPlan generated: 2 item(s).")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-migratef" host={host} />
    </I18nextProvider>,
  )
}

interface MigratefCardState {
  sourceText?: string
  targetPath?: string
  historyPath?: string
  mode?: MigratefMode
  result?: MigratefData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: MigratefCardState
  runCalls: Array<{ nodeId: string; input: MigratefInput }>
  copiedText: string
}

function createHost(initial: MigratefCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as MigratefInput })
        onEvent?.({ type: "progress", progress: 42, message: "Planning migration." })
        return {
          success: true,
          message: "Plan generated: 2 item(s).",
          data: migratefData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/target",
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

const migratefData: MigratefData = {
  plan: [
    {
      sourcePath: "D:/source/a.txt",
      targetPath: "D:/target/a.txt",
      action: "move",
      kind: "file",
      status: "pending",
    },
    {
      sourcePath: "D:/source/b.txt",
      targetPath: "D:/target/b.txt",
      action: "move",
      kind: "file",
      status: "pending",
    },
  ],
  history: [],
  migratedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  totalCount: 2,
  operationId: "batch-1",
  successCount: 0,
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
        migratef: {
          title: "migratef",
          meta: "{{phase}} / {{mode}}",
          plan: "Plan",
          move: "Move",
          copy: "Copy",
          history: "History",
          copyLogs: "Copy logs",
          reset: "Reset",
          targetLabel: "target",
          pasteTarget: "Paste target",
          historyLabel: "history",
          pasteHistory: "Paste history",
          preserveMode: "Preserve",
          flatMode: "Flat",
          directMode: "Direct",
          sourcesLabel: "sources",
          migratedLabel: "migrated",
          skippedLabel: "skipped",
          errorsLabel: "errors",
          batchLabel: "batch",
          historyItem: "{{id}} {{action}} {{count}} file(s)",
          undoneLabel: "undone",
          noResult: "No result",
        },
      },
    },
  },
})
