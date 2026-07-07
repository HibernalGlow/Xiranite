// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { LataData, LataInput } from "./core.js"

afterEach(() => cleanup())

describe("lata Component", () => {
  test("pastes Taskfile path into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste Taskfile path"))

    expect(host.state.taskfilePath).toBe("D:/repo/Taskfile.yml")
  })

  test("runs plan through host.actions.run and copies logs", async () => {
    const host = createHost({
      taskfilePath: "D:/repo/Taskfile.yml",
      taskName: "hello",
      taskArgs: "world",
      result: lataData,
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Plan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "lata",
      input: {
        action: "plan",
        taskfilePath: "D:/repo/Taskfile.yml",
        taskName: "hello",
        taskArgs: "world",
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[100%] echo hello world", "Planned 1 command(s) for hello."])
    expect(screen.getByText("hello: echo hello world")).toBeTruthy()

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[100%] echo hello world\nPlanned 1 command(s) for hello.")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-lata" host={host} />
    </I18nextProvider>,
  )
}

interface LataCardState {
  taskfilePath?: string
  taskName?: string
  taskArgs?: string
  result?: LataData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: LataCardState
  runCalls: Array<{ nodeId: string; input: LataInput }>
  copiedText: string
}

function createHost(initial: LataCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as LataInput })
        onEvent?.({ type: "progress", progress: 100, message: "echo hello world" })
        return {
          success: true,
          message: "Planned 1 command(s) for hello.",
          data: lataData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/repo/Taskfile.yml",
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

const lataData: LataData = {
  taskfilePath: "D:/repo/Taskfile.yml",
  tasks: [
    {
      name: "hello",
      desc: "Say hello",
      prompt: null,
      cmds: ["echo hello {{.CLI_ARGS}}"],
      cmdCount: 1,
      silent: false,
      vars: {},
      deps: [],
      sources: [],
      generates: [],
    },
  ],
  selectedTask: "hello",
  commandPlan: [
    {
      taskName: "hello",
      command: "echo hello world",
      index: 0,
    },
  ],
  commandResults: [],
  exitCode: 0,
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
        lata: {
          title: "lata",
          meta: "{{phase}} / {{task}}",
          phaseIdle: "idle",
          phaseLoading: "loading",
          phaseRunning: "running",
          phaseCompleted: "completed",
          phaseError: "error",
          noTask: "no task",
          load: "Load",
          plan: "Plan",
          run: "Run",
          copyLogs: "Copy logs",
          reset: "Reset",
          taskfileLabel: "Taskfile",
          pasteTaskfile: "Paste Taskfile path",
          argsLabel: "args",
          loadTasks: "load tasks",
          statTasks: "tasks",
          statCommands: "commands",
          statExit: "exit",
          noTasksLoaded: "No tasks loaded",
        },
      },
    },
  },
})
