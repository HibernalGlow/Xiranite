// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { MvzAction, MvzData, MvzInput } from "./core.js"

afterEach(() => cleanup())

describe("mvz Component", () => {
  test("pastes findz entries into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste findz entries"))

    expect(host.state.entryText).toBe("D:/packs/book.zip//page/001.jpg")
  })

  test("runs extract through host.actions.run with dry-run default enabled", async () => {
    const host = createHost({
      action: "extract",
      entryText: "D:/packs/book.zip//page/001.jpg",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Run"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "mvz",
      input: {
        action: "extract",
        fileText: "D:/packs/book.zip//page/001.jpg",
        output: undefined,
        near: true,
        autoDir: true,
        flatten: false,
        pattern: undefined,
        replacement: "",
        separator: "//",
        dryRun: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["extract complete: 1 succeeded, 0 failed."])
    expect(screen.getByText(/plan extract 1 \/ 7z x/)).toBeTruthy()

    await user.click(screen.getByTitle("Copy results"))
    expect(host.copiedText).toBe("7z x D:/packs/book.zip -oD:/packs/book -y page/001.jpg")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-mvz" host={host} />
    </I18nextProvider>,
  )
}

interface MvzCardState {
  action?: MvzAction
  entryText?: string
  output?: string
  pattern?: string
  replacement?: string
  separator?: string
  near?: boolean
  autoDir?: boolean
  flatten?: boolean
  dryRun?: boolean
  result?: MvzData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

type TestHost = NodeHostApi & {
  state: MvzCardState
  runCalls: Array<{ nodeId: string; input: MvzInput }>
  copiedText: string
}

function createHost(initial: MvzCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as MvzInput })
        onEvent?.({ type: "progress", progress: 100, message: "mvz complete." })
        return {
          success: true,
          message: "extract complete: 1 succeeded, 0 failed.",
          data: mvzData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/packs/book.zip//page/001.jpg",
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

const mvzData: MvzData = {
  action: "extract",
  totalFiles: 1,
  totalArchives: 1,
  successCount: 1,
  failedCount: 0,
  results: [],
  preview: [
    {
      archive: "D:/packs/book.zip",
      action: "extract",
      files: ["page/001.jpg"],
      count: 1,
      output: "D:/packs/book",
      command: "7z x D:/packs/book.zip -oD:/packs/book -y page/001.jpg",
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
        mvz: {
          title: "mvz",
          meta: "{{action}} / {{mode}} / {{files}} file(s) / {{archives}} archive(s)",
          run: "Run",
          extract: "Extract",
          move: "Move",
          delete: "Delete",
          rename: "Rename",
          dryRun: "dry-run",
          live: "live",
          near: "near",
          autoDir: "auto dir",
          flatten: "flatten",
          pasteFindzEntries: "Paste findz entries",
          copyResults: "Copy results",
          copyLogs: "Copy logs",
          reset: "Reset",
          outputLabel: "output",
          separatorLabel: "separator",
          patternLabel: "pattern",
          replacementLabel: "replacement",
          archiveEntriesLabel: "archive entries",
          archiveEntriesPlaceholder: "C:/packs/book.zip//chapter/page.jpg",
          successLabel: "success",
          failedLabel: "failed",
          archivesLabel: "archives",
          filesLabel: "files",
          progressLabel: "progress",
          planLabel: "plan",
          okLabel: "ok",
          failLabel: "fail",
          noOperation: "No operation yet",
        },
      },
    },
  },
})
