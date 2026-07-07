// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { CrashuData, CrashuInput } from "./core.js"

afterEach(() => cleanup())

describe("crashu Component", () => {
  test("runs plan through host.actions.run and copies matched results", async () => {
    const host = createHost({
      sourcePathsText: "D:/source",
      targetNamesText: "Alt Name",
      destinationPath: "D:/destination",
      similarityThreshold: 0.7,
      moveDirection: "to_target",
      conflictPolicy: "rename",
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Plan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "crashu",
      input: {
        action: "plan",
        sourcePaths: ["D:/source"],
        targetPath: undefined,
        targetNames: ["Alt Name"],
        destinationPath: "D:/destination",
        similarityThreshold: 0.7,
        autoMove: false,
        moveDirection: "to_target",
        conflictPolicy: "rename",
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.result?.similarFound).toBe(1)
    expect(host.state.logs).toEqual([
      "[40%] Scanning source folders.",
      "Plan generated: 1 move(s).",
    ])

    await user.click(screen.getByTitle("Copy results"))
    expect(host.copiedText).toBe("D:/source/蜂蜜作品 [Alt Name] -> Alt Name (100%)")
  })

  test("surfaces host execution failures in component state", async () => {
    const host = createHost({
      sourcePathsText: "D:/source",
      targetNamesText: "Alt Name",
    })
    host.failNextRun = true
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Scan"))

    await waitFor(() => expect(host.state.phase).toBe("error"))
    expect(host.state.logs).toEqual(["backend unavailable"])
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-crashu" host={host} />
    </I18nextProvider>,
  )
}

interface CrashuCardState {
  sourcePathsText?: string
  targetPath?: string
  targetNamesText?: string
  destinationPath?: string
  similarityThreshold?: number
  autoMove?: boolean
  moveDirection?: "to_target" | "to_source"
  conflictPolicy?: "skip" | "overwrite" | "rename"
  result?: CrashuData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: CrashuCardState
  runCalls: Array<{ nodeId: string; input: CrashuInput }>
  copiedText: string
  failNextRun: boolean
}

function createHost(initial: CrashuCardState): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    copiedText: "",
    failNextRun: false,
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: { type: "progress" | "log"; progress?: number; message: string }) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as CrashuInput })
        if (host.failNextRun) throw new Error("backend unavailable")
        onEvent?.({ type: "progress", progress: 40, message: "Scanning source folders." })
        return {
          success: true,
          message: "Plan generated: 1 move(s).",
          data: crashuData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/source",
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

const crashuData: CrashuData = {
  sourceCount: 1,
  targetCount: 1,
  totalScanned: 1,
  similarFound: 1,
  movedCount: 0,
  skippedCount: 0,
  errorCount: 0,
  pairsFile: "",
  similarFolders: [{
    name: "蜂蜜作品 [Alt Name]",
    path: "D:/source/蜂蜜作品 [Alt Name]",
    target: "Alt Name",
    similarity: 1,
    matchDim: "exact",
    matchSrc: "alt name",
    matchTgt: "alt name",
  }],
  plan: [{
    sourcePath: "D:/source/蜂蜜作品 [Alt Name]",
    targetName: "Alt Name",
    destinationPath: "D:/destination/Alt Name/蜂蜜作品 [Alt Name]",
    direction: "to_target",
    similarity: 1,
    status: "pending",
    reason: "matched",
  }],
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
        crashu: {
          title: "crashu",
          meta: "{{phase}} / {{matches}} match(es)",
          phases: {
            idle: "Idle",
            scan: "Scan",
            plan: "Plan",
            moving: "Moving",
            completed: "Completed",
            error: "Error",
          },
          scan: "Scan",
          plan: "Plan",
          move: "Move",
          copyResults: "Copy results",
          copyLogs: "Copy logs",
          reset: "Reset",
          sources: "sources",
          targets: "targets",
          placeholderSources: "source folders",
          placeholderTargets: "target names",
          targetFolder: "target folder",
          pasteTargetFolder: "Paste target folder",
          destination: "destination",
          pasteDestination: "Paste destination",
          threshold: "threshold",
          autoMove: "auto move",
          toTarget: "to target",
          toSource: "to source",
          skip: "skip",
          rename: "rename",
          overwrite: "overwrite",
          matches: "matches",
          moved: "moved",
          skipped: "skipped",
          errors: "errors",
          noMatches: "No matches",
        },
      },
    },
  },
})
