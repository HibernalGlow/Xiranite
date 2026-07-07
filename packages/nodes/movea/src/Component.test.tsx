// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { MoveaData, MoveaInput } from "./core.js"

afterEach(() => cleanup())

describe("movea Component", () => {
  test("pastes root path into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste root"))

    expect(host.state.rootPath).toBe("D:/library")
  })

  test("runs scan through host.actions.run and copies logs", async () => {
    const host = createHost({
      rootPath: "D:/library",
      regexText: "book",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Scan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "movea",
      input: {
        action: "scan",
        rootPath: "D:/library",
        regexPatterns: ["book"],
        level1Name: undefined,
        movePlan: {},
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[100%] Scan completed.", "Scan completed: 1 folder(s), 1 archive(s)."])
    expect(screen.getByText("artist")).toBeTruthy()
    expect(screen.getByText("1 archive(s), 1 loose folder(s), 1 target(s)")).toBeTruthy()

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[100%] Scan completed.\nScan completed: 1 folder(s), 1 archive(s).")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-movea" host={host} />
    </I18nextProvider>,
  )
}

interface MoveaCardState {
  rootPath?: string
  regexText?: string
  archiveName?: string
  subfoldersText?: string
  level1Name?: string
  movePlanText?: string
  result?: MoveaData | null
  matchedFolders?: string[]
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: MoveaCardState
  runCalls: Array<{ nodeId: string; input: MoveaInput }>
  copiedText: string
}

function createHost(initial: MoveaCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as MoveaInput })
        onEvent?.({ type: "progress", progress: 100, message: "Scan completed." })
        return {
          success: true,
          message: "Scan completed: 1 folder(s), 1 archive(s).",
          data: moveaData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/library",
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

const moveaData: MoveaData = {
  scanResults: {
    artist: {
      name: "artist",
      path: "D:/library/artist",
      subfolders: ["1. doujinshi"],
      archives: ["book.zip"],
      movableFolders: ["loose"],
    },
  },
  matchedFolders: [],
  moveItems: [],
  totalFolders: 1,
  totalArchives: 1,
  totalMovableFolders: 1,
  moveSuccess: 0,
  moveFailed: 0,
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
        movea: {
          title: "movea",
          meta: "{{phase}} / {{count}} folder(s)",
          scan: "Scan",
          match: "Match",
          move: "Move",
          copyLogs: "Copy logs",
          reset: "Reset",
          rootLabel: "root",
          level1Label: "level1",
          archiveLabel: "archive",
          pasteField: "Paste {{field}}",
          foldersLabel: "folders",
          archivesLabel: "archives",
          movableLabel: "movable",
          scanSummary: "{{archives}} archive(s), {{movable}} loose folder(s), {{targets}} target(s)",
          noResult: "No result",
          regexPatternsLabel: "regex patterns",
          targetFoldersLabel: "target folders",
          movePlanLabel: "move plan JSON",
          pasteMovePlan: "Paste move plan",
        },
      },
    },
  },
})
