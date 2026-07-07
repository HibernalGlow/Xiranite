// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { FindzAction, FindzData, FindzInput } from "./core.js"

afterEach(() => cleanup())

describe("findz Component", () => {
  test("pastes clipboard paths into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste paths"))

    expect(host.state.pathText).toBe("D:/media")
  })

  test("runs search through host.actions.run and copies result paths", async () => {
    const host = createHost({
      pathText: "D:/media",
      where: 'ext IN ("jpg", "png")',
      noArchive: true,
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Run"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "findz",
      input: {
        action: "search",
        pathText: "D:/media",
        where: 'ext IN ("jpg", "png")',
        noArchive: true,
        followSymlinks: false,
        withImageMeta: false,
        longFormat: true,
        maxResults: 0,
        maxReturnFiles: 5000,
        groupBy: undefined,
        refine: undefined,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.totalCount).toBe(2)
    expect(host.state.logs).toEqual(["Found 2 item(s)."])
    expect(screen.getByText(/D:\/media\/a\.jpg/)).toBeTruthy()

    await user.click(screen.getByTitle("Copy results"))
    expect(host.copiedText).toBe("D:/media/a.jpg\nD:/media/c.png")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-findz" host={host} />
    </I18nextProvider>,
  )
}

interface FindzCardState {
  action?: FindzAction
  pathText?: string
  where?: string
  noArchive?: boolean
  followSymlinks?: boolean
  withImageMeta?: boolean
  longFormat?: boolean
  maxResults?: number
  maxReturnFiles?: number
  groupBy?: string
  refine?: string
  result?: FindzData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

type TestHost = NodeHostApi & {
  state: FindzCardState
  runCalls: Array<{ nodeId: string; input: FindzInput }>
  copiedText: string
}

function createHost(initial: FindzCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as FindzInput })
        onEvent?.({ type: "progress", progress: 100, message: "findz complete." })
        return {
          success: true,
          message: "Found 2 item(s).",
          data: findzData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/media",
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

const findzData: FindzData = {
  action: "search",
  totalCount: 2,
  fileCount: 2,
  dirCount: 0,
  archiveCount: 0,
  nestedCount: 0,
  files: [
    file("a.jpg", "D:/media/a.jpg", "jpg"),
    file("c.png", "D:/media/c.png", "png"),
  ],
  groups: [],
  byExtension: { jpg: 1, png: 1 },
  byArchive: {},
  errors: [],
  paths: ["D:/media"],
  where: 'ext IN ("jpg", "png")',
  scannedFiles: 3,
  elapsedMs: 2,
  truncated: false,
  returnedCount: 2,
  outputText: "D:/media/a.jpg\nD:/media/c.png",
}

function file(name: string, path: string, ext: string) {
  return {
    name,
    path,
    size: 3,
    sizeFormatted: "3",
    modTime: "2026-01-01T00:00:00.000Z",
    date: "2026-01-01",
    time: "00:00:00",
    type: "file" as const,
    container: "",
    archive: "",
    ext,
    ext2: ext,
  }
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
        findz: {
          title: "findz",
          meta: "{{action}} / {{count}} path(s) / {{where}}",
          actionSearch: "Search",
          actionArchives: "Archives",
          actionNested: "Nested",
          noArchive: "no archive",
          links: "links",
          imageMeta: "image meta",
          pastePaths: "Paste paths",
          run: "Run",
          filterHelp: "Filter help",
          copyResults: "Copy results",
          copyLogs: "Copy logs",
          reset: "Reset",
          fieldMax: "max",
          fieldReturn: "return",
          fieldGroup: "group",
          fieldRefine: "refine",
          pathsLabel: "paths",
          pathsPlaceholder: "one path per line",
          whereLabel: "where",
          statTotal: "total",
          statFiles: "files",
          statDirs: "dirs",
          statArchive: "archive",
          statErrors: "errors",
          statProgress: "progress",
          starting: "starting",
          noResult: "No result",
        },
      },
    },
  },
})
