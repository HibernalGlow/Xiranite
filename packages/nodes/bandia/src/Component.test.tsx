// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { BandiaAction, BandiaArchiveFormat, BandiaData, BandiaExtractMode, BandiaInput, BandiaOverwriteMode } from "./core.js"

afterEach(() => cleanup())

describe("bandia Component", () => {
  test("pastes clipboard input into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste input"))

    expect(host.state.pathText).toBe("D:/archives/book.zip")
  })

  test("runs compress mode with real source paths instead of archive-only parsing", async () => {
    const host = createHost({
      mode: "compress",
      pathText: "D:/books/source folder",
      outputDir: "D:/archives",
      dryRun: true,
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Run"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "bandia",
      input: {
        action: "compress",
        paths: ["D:/books/source folder"],
        mappings: [],
        mappingText: undefined,
        deleteAfter: true,
        useTrash: true,
        parallel: false,
        workers: 2,
        extractMode: "auto",
        outputPrefix: "[extract] ",
        overwriteMode: "overwrite",
        outputDir: "D:/archives",
        compressFormat: "zip",
        deleteSource: true,
        dryRun: true,
        openInEverything: false,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.compressedCount).toBe(1)
    expect(host.state.logs).toEqual(["Compress complete: 1 succeeded, 0 failed."])
    expect(screen.getByText(/ok D:\/books\/source folder -> D:\/archives\/source folder\.zip/)).toBeTruthy()

    await user.click(screen.getByTitle("Copy results"))
    expect(host.copiedText).toBe("ok D:/books/source folder -> D:/archives/source folder.zip")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-bandia" host={host} />
    </I18nextProvider>,
  )
}

interface BandiaCardState {
  mode?: "extract" | "compress"
  pathText?: string
  mappingText?: string
  outputDir?: string
  deleteAfter?: boolean
  useTrash?: boolean
  parallel?: boolean
  workers?: number
  extractMode?: BandiaExtractMode
  overwriteMode?: BandiaOverwriteMode
  outputPrefix?: string
  compressFormat?: BandiaArchiveFormat
  deleteSource?: boolean
  dryRun?: boolean
  result?: BandiaData | null
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

type TestHost = NodeHostApi & {
  state: BandiaCardState
  runCalls: Array<{ nodeId: string; input: BandiaInput }>
  copiedText: string
}

function createHost(initial: BandiaCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as BandiaInput })
        onEvent?.({ type: "progress", progress: 100, message: "compress complete." })
        return {
          success: true,
          message: "Compress complete: 1 succeeded, 0 failed.",
          data: bandiaData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/archives/book.zip",
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

const bandiaData: BandiaData = {
  action: "compress" as BandiaAction,
  extractedCount: 0,
  compressedCount: 1,
  failedCount: 0,
  totalCount: 1,
  exportedCount: 0,
  pathMappings: [],
  results: [
    {
      kind: "compress",
      sourcePath: "D:/books/source folder",
      archivePath: "D:/archives/source folder.zip",
      success: true,
      durationMs: 0,
      command: 'bz a -y "D:/archives/source folder.zip" "source folder"',
      skipped: true,
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
        bandia: {
          title: "bandia",
          run: "Run",
          pasteInput: "Paste input",
          exportEfu: "Export EFU",
          copyResults: "Copy results",
          copyLogs: "Copy logs",
          reset: "Reset",
          extract: "Extract",
          compress: "Compress",
          dryRun: "dry-run",
          live: "live",
          delete: "delete",
          trash: "trash",
          parallel: "parallel",
          deleteSource: "delete source",
          workers: "workers",
          prefix: "prefix",
          overwrite: "overwrite",
          outputDir: "output dir",
          archivePaths: "archive paths",
          sourcePaths: "source paths",
          placeholderArchivePaths: "one .zip/.7z/.rar path per line",
          placeholderSourcePaths: "folders/files to compress, one per line",
          mappings: "mappings",
          done: "done",
          failed: "failed",
          efu: "efu",
          progress: "progress",
          noResult: "No result",
          starting: "starting",
          ok: "ok",
          fail: "fail",
          meta: "{{mode}} / {{state}} / {{archives}} archive(s) / {{mappings}} mapping(s)",
          modes: {
            extract: "extract",
            compress: "compress",
          },
          extractModes: {
            auto: "auto",
            normal: "normal",
          },
        },
      },
    },
  },
})
