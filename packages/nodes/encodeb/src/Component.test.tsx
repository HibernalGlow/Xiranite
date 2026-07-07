// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { EncodebData, EncodebInput, EncodebMapping, EncodebStrategy } from "./core.js"
import { ENCODEB_PRESETS } from "./core.js"

afterEach(() => cleanup())

describe("encodeb Component", () => {
  test("pastes clipboard paths into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste paths"))

    expect(host.state.pathText).toBe("D:/encoded")
  })

  test("runs find through host.actions.run and copies logs", async () => {
    const host = createHost({
      pathText: "D:/encoded",
      preset: "cn",
      strategy: "replace",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Find"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "encodeb",
      input: {
        action: "find",
        paths: ["D:/encoded"],
        srcEncoding: "cp437",
        dstEncoding: "cp936",
        strategy: "replace",
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.matches).toEqual(["D:/encoded/鈺榎.txt"])
    expect(host.state.logs).toEqual(["Find completed, 1 item(s)."])
    expect(screen.getByText("D:/encoded/鈺榎.txt")).toBeTruthy()

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("Find completed, 1 item(s).")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-encodeb" host={host} />
    </I18nextProvider>,
  )
}

interface EncodebCardState {
  pathText?: string
  preset?: keyof typeof ENCODEB_PRESETS | "custom"
  srcEncoding?: string
  dstEncoding?: string
  strategy?: EncodebStrategy
  phase?: string
  logs?: string[]
  mappings?: EncodebMapping[]
  matches?: string[]
}

type TestHost = NodeHostApi & {
  state: EncodebCardState
  runCalls: Array<{ nodeId: string; input: EncodebInput }>
  copiedText: string
}

function createHost(initial: EncodebCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as EncodebInput })
        onEvent?.({ type: "progress", progress: 100, message: "Scan completed." })
        return {
          success: true,
          message: "Find completed, 1 item(s).",
          data: encodebData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/encoded",
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

const encodebData: EncodebData = {
  mappings: [],
  matches: ["D:/encoded/鈺榎.txt"],
  processed: 0,
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
        encodeb: {
          title: "encodeb",
          meta: "{{paths}} path(s) / {{src}} -> {{dst}} / {{strategy}}",
          pastePaths: "Paste paths",
          find: "Find",
          preview: "Preview",
          recover: "Recover",
          copyLogs: "Copy logs",
          reset: "Reset",
          paths: "paths",
          placeholderPaths: "one path per line",
          presets: {
            cn: "CN",
            jp: "JP",
            kr: "KR",
            custom: "Custom",
          },
          src: "src",
          dst: "dst",
          strategies: {
            replace: "replace",
            copy: "copy",
          },
          matches: "matches",
          noPreviewRows: "No preview rows",
          running: "Running...",
        },
      },
    },
  },
})
