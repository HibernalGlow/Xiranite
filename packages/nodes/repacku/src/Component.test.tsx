import { afterEach, describe, expect, test } from "vitest"
import { Window } from "happy-dom"
import React from "react"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { RepackuData, RepackuInput } from "./core.js"

installDom()
const { cleanup, render, screen, waitFor } = await import("@testing-library/react")
const { userEvent } = await import("@testing-library/user-event")

afterEach(() => cleanup())

describe("repacku Component", () => {
  test("pastes clipboard text into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste path"))

    expect(host.state.path).toBe("D:/library/book")
  })

  test("runs the host node action and persists the result", async () => {
    const host = createHost({ path: "D:/library", typesText: "image", dryRun: true })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Full"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.nodeId).toBe("repacku")
    expect(host.runCalls[0]?.input).toMatchObject({
      action: "full",
      path: "D:/library",
      types: "image",
      dryRun: true,
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.progress).toBe(100)
    expect(host.state.result?.plannedCount).toBe(1)
    expect(host.state.logs).toContain("Compression plan complete: 1 operation(s).")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-repacku" host={host} />
    </I18nextProvider>,
  )
}

interface RepackuCardState {
  path?: string
  configPath?: string
  typesText?: string
  minCount?: number
  deleteAfter?: boolean
  dryRun?: boolean
  phase?: string
  progress?: number
  progressText?: string
  result?: RepackuData | null
  logs?: string[]
}

type TestHost = NodeHostApi & {
  state: RepackuCardState
  runCalls: Array<{ nodeId: string; input: RepackuInput }>
}

function createHost(initial: RepackuCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as RepackuInput })
        onEvent?.({ type: "progress", progress: 42, message: "Planning compression." })
        return {
          success: true,
          message: "Compression plan complete: 1 operation(s).",
          data: {
            configPath: "D:/library/library_config.json",
            totalFolders: 2,
            entireCount: 1,
            selectiveCount: 0,
            skipCount: 1,
            plannedCount: 1,
            compressedCount: 0,
            failedCount: 0,
            skippedCount: 0,
            totalOperations: 1,
            galleryCount: 0,
            folderTree: null,
            operations: [{
              mode: "entire",
              sourcePath: "D:/library/book",
              targetPath: "D:/library/book.zip",
              extensions: [],
              fileCount: 2,
              status: "planned",
              originalSize: 0,
              compressedSize: 0,
            }],
            errors: [],
          },
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/library/book",
      writeText: async () => undefined,
    },
    env: {
      theme: "light",
      platform: "node",
    },
  }
  return host
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
        repacku: {
          title: "Repacku",
          meta: "{{types}} / min {{minCount}} / {{mode}}",
          allFiles: "all files",
          dryRunMode: "dry-run",
          write: "write",
          pastePath: "Paste path",
          analyze: "Analyze",
          full: "Full",
          compress: "Compress",
          copyResults: "Copy results",
          copyLogs: "Copy logs",
          reset: "Reset",
          folderPath: "Folder path",
          configJson: "Config JSON",
          types: "Types",
          minFiles: "Min files",
          dryRun: "Dry run",
          deleteAfter: "Delete after",
          single: "Single",
          gallery: "Gallery",
          folders: "Folders",
          entire: "Entire",
          selective: "Selective",
          ops: "Ops",
          failed: "Failed",
          readyToAnalyze: "Ready to analyze",
          starting: "Starting",
          pathRequired: "Path is required",
          configOrPathRequired: "Config or path is required",
          nativeUnavailable: "Native runner unavailable",
        },
      },
    },
  },
})

function installDom() {
  const window = new Window()
  Object.defineProperty(globalThis, "window", { value: window, configurable: true })
  Object.defineProperty(globalThis, "document", { value: window.document, configurable: true })
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true })
  Object.defineProperty(globalThis, "HTMLElement", { value: window.HTMLElement, configurable: true })
  Object.defineProperty(globalThis, "Event", { value: window.Event, configurable: true })
  Object.defineProperty(globalThis, "MouseEvent", { value: window.MouseEvent, configurable: true })
}
