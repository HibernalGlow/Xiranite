// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { TrenameData, TrenameInput } from "./core.js"

afterEach(() => cleanup())

describe("trename Component", () => {
  test("pastes scan paths from the clipboard", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste path"))

    expect(host.state.pathText).toBe("D:/gallery")
  })

  test("runs scan through host.actions.run, stores JSON, and copies logs", async () => {
    const host = createHost({
      pathText: "D:/gallery",
      includeRoot: true,
      compact: true,
      dryRun: true,
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Scan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "trename",
      input: {
        action: "scan",
        paths: "D:/gallery",
        includeHidden: false,
        includeRoot: true,
        excludeExts: undefined,
        excludePatterns: undefined,
        maxLines: 1000,
        compact: true,
        jsonContent: "",
        basePath: undefined,
        dryRun: true,
        batchId: undefined,
        undoPath: undefined,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[100%] Scan complete.", "Scan complete: 2 item(s), 1 segment(s)."])
    expect(host.state.jsonText).toContain("image-a.jpg")
    expect(host.state.basePath).toBe("D:/")
    expect(screen.getAllByText(/image-a\.jpg/).length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByTitle("Copy JSON"))
    expect(host.copiedText).toContain("image-a.jpg")
    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[100%] Scan complete.\nScan complete: 2 item(s), 1 segment(s).")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-trename" host={host} />
    </I18nextProvider>,
  )
}

interface TrenameCardState {
  pathText?: string
  basePath?: string
  jsonText?: string
  includeHidden?: boolean
  includeRoot?: boolean
  compact?: boolean
  dryRun?: boolean
  excludeExts?: string
  excludePatterns?: string
  maxLines?: number
  batchId?: string
  undoPath?: string
  phase?: string
  progress?: number
  progressText?: string
  result?: TrenameData | null
  logs?: string[]
}

type TestHost = NodeHostApi & {
  state: TrenameCardState
  runCalls: Array<{ nodeId: string; input: TrenameInput }>
  copiedText: string
}

function createHost(initial: TrenameCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as TrenameInput })
        onEvent?.({ type: "progress", progress: 100, message: "Scan complete." })
        return {
          success: true,
          message: "Scan complete: 2 item(s), 1 segment(s).",
          data: trenameData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/gallery",
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

const jsonContent = `{
  "root": [
    {"src_dir": "gallery", "tgt_dir": "", "children": [
      {"src": "image-a.jpg", "tgt": ""}
    ]}
  ]
}`

const trenameData: TrenameData = {
  jsonContent,
  segments: [jsonContent],
  totalItems: 2,
  pendingCount: 2,
  readyCount: 0,
  successCount: 0,
  failedCount: 0,
  skippedCount: 0,
  operationId: "",
  conflicts: [],
  operations: [],
  history: [],
  basePath: "D:/",
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
        trename: {
          title: "trename",
          meta: "{{total}} total / {{ready}} ready / {{conflicts}} conflicts",
          starting: "starting",
          pastePath: "Paste path",
          scan: "Scan",
          json: "JSON",
          validate: "Validate",
          rename: "Rename",
          copyJson: "Copy JSON",
          reset: "Reset",
          copyLogs: "Copy logs",
          scanPaths: "scan paths",
          basePath: "base path",
          batchId: "batch id",
          excludeExt: "exclude ext",
          excludePattern: "exclude pattern",
          splitLines: "split lines",
          root: "root",
          hidden: "hidden",
          compact: "compact",
          dryRun: "dry run",
          count: "Count",
          undo: "Undo",
          statTotal: "total",
          statPending: "pending",
          statReady: "ready",
          statOk: "ok",
          statConflicts: "conflicts",
          renameJson: "rename json",
          progressLine: "[{{progress}}%] {{text}}",
          readyToScan: "Ready to scan folders into rename JSON.",
        },
      },
    },
  },
})
