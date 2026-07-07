// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { KavvkaData, KavvkaInput } from "./core.js"

afterEach(() => cleanup())

describe("kavvka Component", () => {
  test("pastes source folder into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste sources"))

    expect(host.state.sourceText).toBe("D:/library/[artist] bundle/gallery")
  })

  test("runs process through host.actions.run with dry-run default enabled", async () => {
    const host = createHost({
      sourceText: "D:/library/[artist] bundle/gallery",
      strictArtist: true,
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Process"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "kavvka",
      input: {
        action: "process",
        pathText: "D:/library/[artist] bundle/gallery",
        scanRootText: undefined,
        keywordText: undefined,
        scanDepth: 3,
        force: true,
        dryRun: true,
        strictArtist: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.allCombinedPaths).toEqual(["D:/library/[artist] bundle/gallery;D:/library/[artist] bundle/#compare"])
    expect(host.state.logs).toEqual(["Process completed: 1/1 path(s), 0 folder(s) moved."])
    expect(screen.getByText("D:/library/[artist] bundle/gallery;D:/library/[artist] bundle/#compare")).toBeTruthy()

    await user.click(screen.getByTitle("Copy results"))
    expect(host.copiedText).toBe("D:/library/[artist] bundle/gallery;D:/library/[artist] bundle/#compare")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-kavvka" host={host} />
    </I18nextProvider>,
  )
}

interface KavvkaCardState {
  sourceText?: string
  scanRootText?: string
  keywordText?: string
  scanDepth?: number
  force?: boolean
  dryRun?: boolean
  strictArtist?: boolean
  result?: KavvkaData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

type TestHost = NodeHostApi & {
  state: KavvkaCardState
  runCalls: Array<{ nodeId: string; input: KavvkaInput }>
  copiedText: string
}

function createHost(initial: KavvkaCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as KavvkaInput })
        onEvent?.({ type: "progress", progress: 100, message: "Process completed." })
        return {
          success: true,
          message: "Process completed: 1/1 path(s), 0 folder(s) moved.",
          data: kavvkaData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/library/[artist] bundle/gallery",
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

const kavvkaData: KavvkaData = {
  allCombinedPaths: ["D:/library/[artist] bundle/gallery;D:/library/[artist] bundle/#compare"],
  matchedPaths: [],
  processResults: [
    {
      path: "D:/library/[artist] bundle/gallery",
      artistFolder: "D:/library/[artist] bundle",
      compareFolder: "D:/library/[artist] bundle/#compare",
      siblingFolders: ["D:/library/[artist] bundle/old scan"],
      movedFolders: [
        {
          source: "D:/library/[artist] bundle/old scan",
          target: "D:/library/[artist] bundle/#compare/old scan",
          success: true,
        },
      ],
      combinedPath: "D:/library/[artist] bundle/gallery;D:/library/[artist] bundle/#compare",
      warnings: [],
      success: true,
    },
  ],
  scanResults: [],
  processedCount: 1,
  movedCount: 0,
  skippedCount: 0,
  errorCount: 0,
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
        kavvka: {
          title: "kavvka",
          meta: "{{sourceCount}} source / {{scanCount}} scan root / depth {{depth}}",
          pasteSources: "Paste sources",
          scan: "Scan",
          plan: "Plan",
          process: "Process",
          copyResults: "Copy results",
          copyLogs: "Copy logs",
          reset: "Reset",
          sourceFoldersLabel: "source folders",
          sourceFoldersPlaceholder: "one folder per line",
          scanRootsLabel: "scan roots",
          scanRootsPlaceholder: "one root folder per line",
          keywordsLabel: "keywords",
          depthLabel: "depth",
          forceMove: "force move",
          dryRun: "dry run",
          strictArtist: "strict []",
          statMatched: "matched",
          statPaths: "paths",
          statMoved: "moved",
          statErrors: "errors",
          starting: "starting",
        },
      },
    },
  },
})
