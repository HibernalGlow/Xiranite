// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { ScoolpAction, ScoolpData, ScoolpInput } from "./core.js"

afterEach(() => cleanup())

describe("scoolp Component", () => {
  test("pastes sync TOML from the clipboard", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste config"))

    expect(host.state.configText).toContain("[scoop]")
  })

  test("runs cache_list through host.actions.run and copies progress logs", async () => {
    const host = createHost({
      action: "cache_list",
      path: "D:/scoop/cache",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Run"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "scoolp",
      input: {
        action: "cache_list",
        path: "D:/scoop/cache",
        configText: undefined,
        packageName: undefined,
        packages: [],
        dryRun: true,
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[30%] Scanning D:/scoop/cache", "Found 1 obsolete cache file(s), 3 bytes."])
    expect(host.state.result?.cache?.obsoleteCount).toBe(1)
    expect(screen.getAllByText(/1 obsolete/).length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[30%] Scanning D:/scoop/cache\nFound 1 obsolete cache file(s), 3 bytes.")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-scoolp" host={host} />
    </I18nextProvider>,
  )
}

interface ScoolpCardState {
  action?: ScoolpAction
  path?: string
  configText?: string
  packageName?: string
  packages?: string
  result?: ScoolpData | null
  logs?: string[]
  phase?: string
  dryRun?: boolean
}

type TestHost = NodeHostApi & {
  state: ScoolpCardState
  runCalls: Array<{ nodeId: string; input: ScoolpInput }>
  copiedText: string
}

function createHost(initial: ScoolpCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as ScoolpInput })
        onEvent?.({ type: "progress", progress: 30, message: "Scanning D:/scoop/cache" })
        return {
          success: true,
          message: "Found 1 obsolete cache file(s), 3 bytes.",
          data: scoolpData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "[scoop]\nroot = \"D:/scoop\"\n",
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

const scoolpData: ScoolpData = {
  scoopInstalled: false,
  installedPackages: [],
  buckets: [],
  availablePackages: [],
  syncPlan: [],
  commandResults: [],
  cache: {
    path: "D:/scoop/cache",
    fileCount: 3,
    softwareCount: 2,
    obsoleteCount: 1,
    obsoleteSize: 3,
    obsoletePackages: [{
      name: "demo",
      version: "1.0",
      size: 3,
      filename: "demo#1.0#old",
      path: "D:/scoop/cache/demo#1.0#old",
    }],
  },
  installedCount: 0,
  failedCount: 0,
  cleanedCount: 0,
  cleanedSizeBytes: 0,
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
        scoolp: {
          title: "scoolp",
          meta: "{{phase}} / {{action}} / {{mode}}",
          idle: "idle",
          dryRun: "dry-run",
          execute: "execute",
          pasteConfig: "Paste config",
          run: "Run",
          copyLogs: "Copy logs",
          reset: "Reset",
          actionStatus: "status",
          actionList: "list",
          actionSync: "sync",
          actionCache: "cache",
          path: "path",
          package: "package",
          syncToml: "sync toml / package list",
          syncTomlPlaceholder: "paste scoop.toml for local sync preview",
          noResult: "No result",
          obsolete: "obsolete",
          statPackages: "packages",
          statBuckets: "buckets",
          statCache: "cache",
          statFailed: "failed",
          scoopInstalled: "Scoop installed: {{installed}}",
        },
      },
    },
  },
})
