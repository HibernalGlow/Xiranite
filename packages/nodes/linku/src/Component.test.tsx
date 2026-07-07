// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { LinkuData, LinkuInput } from "./core.js"

afterEach(() => cleanup())

describe("linku Component", () => {
  test("pastes source path into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste source"))

    expect(host.state.path).toBe("D:/source")
  })

  test("runs move_link through host.actions.run and copies progress logs", async () => {
    const host = createHost({
      path: "D:/source",
      target: "E:/target",
      configPath: "D:/linku.toml",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Move"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "linku",
      input: {
        action: "move_link",
        path: "D:/source",
        target: "E:/target",
        configPath: "D:/linku.toml",
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[40%] Moving D:/source", "Moved and linked: D:/source -> E:/target"])
    expect(host.state.result?.created).toBe(true)

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[40%] Moving D:/source\nMoved and linked: D:/source -> E:/target")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-linku" host={host} />
    </I18nextProvider>,
  )
}

interface LinkuCardState {
  path?: string
  target?: string
  configPath?: string
  action?: LinkuInput["action"]
  result?: LinkuData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: LinkuCardState
  runCalls: Array<{ nodeId: string; input: LinkuInput }>
  copiedText: string
}

function createHost(initial: LinkuCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as LinkuInput })
        onEvent?.({ type: "progress", progress: 40, message: "Moving D:/source" })
        return {
          success: true,
          message: "Moved and linked: D:/source -> E:/target",
          data: linkuData,
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

const linkuData: LinkuData = {
  links: [],
  created: true,
  recoveredCount: 0,
  failedCount: 0,
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
        linku: {
          title: "linku",
          meta: "{{phase}} / {{count}} record(s)",
          info: "Info",
          create: "Create",
          move: "Move",
          list: "List",
          recover: "Recover",
          copyLogs: "Copy logs",
          reset: "Reset",
          pasteField: "Paste {{field}}",
          sourceLabel: "source",
          targetLinkLabel: "target/link",
          configLabel: "config",
          createdLabel: "created",
          recoveredLabel: "recovered",
          failedLabel: "failed",
          noResult: "No result",
          existsLabel: "exists",
          symlinkLabel: "symlink",
        },
      },
    },
  },
})
