// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { EngineVData, EngineVInput, EngineVWallpaper } from "./core.js"

afterEach(() => cleanup())

describe("enginev Component", () => {
  test("pastes the workshop path from the clipboard", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste workshop path"))

    expect(host.state.workshopPath).toBe("D:/workshop")
  })

  test("runs scan through host.actions.run and renders local preview images", async () => {
    const host = createHost({
      workshopPath: "D:/workshop",
      titleFilter: "Ocean",
      ratingFilter: "Everyone",
      typeFilter: "Video",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Scan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "enginev",
      input: {
        action: "scan",
        path: "D:/workshop",
        filters: {
          title: "Ocean",
          contentRating: "Everyone",
          type: "Video",
        },
        ids: undefined,
        template: undefined,
        dryRun: true,
        copyMode: false,
        targetPath: undefined,
        exportPath: undefined,
        exportFormat: "json",
        wallpapers: undefined,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[100%] Scan complete.", "Scan complete: 1 wallpaper(s)."])
    expect(host.localFilePaths).toContain("D:/workshop/111/preview.png")

    const image = screen.getByAltText("Ocean Loop") as HTMLImageElement
    expect(image.dataset.enginevPreview).toBe("true")
    expect(image.getAttribute("src")).toBe("http://local.test/local-files?path=D%3A%2Fworkshop%2F111%2Fpreview.png")

    await user.click(screen.getByTitle("Copy results"))
    expect(host.copiedText).toBe("111\tOcean Loop\tD:/workshop/111")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-enginev" host={host} />
    </I18nextProvider>,
  )
}

interface EngineVCardState {
  workshopPath?: string
  titleFilter?: string
  ratingFilter?: string
  typeFilter?: string
  idsText?: string
  template?: string
  outputPath?: string
  dryRun?: boolean
  copyMode?: boolean
  targetPath?: string
  phase?: string
  progress?: number
  progressText?: string
  wallpapers?: EngineVWallpaper[]
  filteredWallpapers?: EngineVWallpaper[]
  result?: EngineVData | null
  logs?: string[]
}

type TestHost = NodeHostApi & {
  state: EngineVCardState
  runCalls: Array<{ nodeId: string; input: EngineVInput }>
  copiedText: string
  localFilePaths: string[]
}

function createHost(initial: EngineVCardState): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    localFilePaths: [],
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: { type: "progress" | "log"; progress?: number; message: string }) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as EngineVInput })
        onEvent?.({ type: "progress", progress: 100, message: "Scan complete." })
        return {
          success: true,
          message: "Scan complete: 1 wallpaper(s).",
          data: enginevData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/workshop",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    localFiles: {
      getUrl: (path) => {
        host.localFilePaths.push(path)
        return `http://local.test/local-files?path=${encodeURIComponent(path)}`
      },
    },
    env: {
      theme: "light",
      platform: "node",
    },
  }
  return host
}

const wallpaper: EngineVWallpaper = {
  path: "D:/workshop/111",
  folderName: "111",
  workshopId: "111",
  title: "Ocean Loop",
  description: "calm motion",
  contentRating: "Everyone",
  ratingSex: "",
  ratingViolence: "",
  tags: ["test"],
  fileName: "scene.mp4",
  preview: "preview.png",
  wallpaperType: "Video",
  createdTime: "2026-01-01T00:00:00.000Z",
  modifiedTime: "2026-01-01T00:00:00.000Z",
  size: 100,
  projectData: {},
}

const enginevData: EngineVData = {
  wallpapers: [wallpaper],
  filteredWallpapers: [wallpaper],
  totalCount: 1,
  filteredCount: 1,
  successCount: 0,
  failedCount: 0,
  typeStats: { Video: 1 },
  ratingStats: { Everyone: 1 },
  renameResults: [],
  deleteResults: [],
  exportPath: "",
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
        enginev: {
          title: "enginev",
          meta: "{{scanned}} scanned / {{visible}} visible / {{selected}} selected",
          starting: "starting",
          pasteWorkshopPath: "Paste workshop path",
          scan: "Scan",
          filter: "Filter",
          rename: "Rename",
          copyResults: "Copy results",
          copyLogs: "Copy logs",
          reset: "Reset",
          workshopPath: "workshop path",
          ids: "ids",
          titleFilter: "title filter",
          rating: "rating",
          type: "type",
          renameTemplate: "rename template",
          targetExportPath: "target/export path",
          dryRun: "dry run",
          copyMode: "copy mode",
          delete: "Delete",
          export: "Export",
          stats: {
            total: "total",
            filtered: "filtered",
            types: "types",
            ok: "ok",
            failed: "failed",
          },
          readyToScan: "Ready to scan Wallpaper Engine workshop folders.",
        },
      },
    },
  },
})
