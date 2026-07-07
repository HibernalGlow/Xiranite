// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { OwithuAction, OwithuData, OwithuInput, RegistryHive } from "./core.js"

afterEach(() => cleanup())

describe("owithu Component", () => {
  test("pastes TOML into component state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste TOML"))

    expect(host.state.configText).toBe(sampleToml)
  })

  test("runs register through host.actions.run and copies progress logs", async () => {
    const host = createHost({
      path: "D:/owithu.toml",
      configText: sampleToml,
      hive: "HKCU",
      onlyKey: "Code",
      logs: [],
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Register"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toEqual({
      nodeId: "owithu",
      input: {
        action: "register",
        path: "D:/owithu.toml",
        configText: sampleToml,
        hive: "HKCU",
        onlyKey: "Code",
      },
    })

    await waitFor(() => expect(host.state.phase).toBe("completed"))
    expect(host.state.logs).toEqual(["[40%] register 2 registry key(s).", "register completed: 2 success, 0 failed."])
    expect(host.state.result?.registeredCount).toBe(2)

    await user.click(screen.getByTitle("Copy logs"))
    expect(host.copiedText).toBe("[40%] register 2 registry key(s).\nregister completed: 2 success, 0 failed.")
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-owithu" host={host} />
    </I18nextProvider>,
  )
}

interface OwithuCardState {
  path?: string
  configText?: string
  hive?: RegistryHive | ""
  onlyKey?: string
  action?: OwithuAction
  result?: OwithuData | null
  logs?: string[]
  phase?: string
}

type TestHost = NodeHostApi & {
  state: OwithuCardState
  runCalls: Array<{ nodeId: string; input: OwithuInput }>
  copiedText: string
}

function createHost(initial: OwithuCardState): TestHost {
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
        host.runCalls.push({ nodeId, input: input as OwithuInput })
        onEvent?.({ type: "progress", progress: 40, message: "register 2 registry key(s)." })
        return {
          success: true,
          message: "register completed: 2 success, 0 failed.",
          data: owithuData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => sampleToml,
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

const sampleToml = `[defaults]
enabled = true
hives = ["HKCU"]

[vars]
root = "D:/Tools"

[[entries]]
key = "Code"
label = "Open with Code"
exe = "{root}/Code.exe"
scope = ["file", "directory"]
args = ["%1"]
`

const owithuData: OwithuData = {
  vars: { root: "D:/Tools" },
  defaults: { enabled: true, hives: ["HKCU"] },
  entries: [
    {
      key: "Code",
      label: "Open with Code",
      exe: "D:\\Tools\\Code.exe",
      args: ["%1"],
      icon: "D:\\Tools\\Code.exe",
      scope: ["file", "directory"],
      enabled: true,
    },
  ],
  plan: [
    {
      entryKey: "Code",
      hive: "HKCU",
      scope: "file",
      registryPath: "HKCU\\Software\\Classes\\*\\shell\\Code",
      label: "Open with Code",
      icon: "D:\\Tools\\Code.exe",
      command: '"D:\\Tools\\Code.exe" "%1"',
      enabled: true,
    },
    {
      entryKey: "Code",
      hive: "HKCU",
      scope: "directory",
      registryPath: "HKCU\\Software\\Classes\\Directory\\shell\\Code",
      label: "Open with Code",
      icon: "D:\\Tools\\Code.exe",
      command: '"D:\\Tools\\Code.exe" "%V"',
      enabled: true,
    },
  ],
  registeredCount: 2,
  unregisteredCount: 0,
  failedCount: 0,
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
        owithu: {
          title: "owithu",
          meta: "{{phase}} / {{entries}} entries / {{ops}} ops",
          pasteToml: "Paste TOML",
          preview: "Preview",
          register: "Register",
          remove: "Remove",
          copyLogs: "Copy logs",
          reset: "Reset",
          configPath: "config path",
          onlyKey: "only key",
          config: "config",
          toml: "toml",
          placeholderToml: "paste owithu.toml for local preview",
          noRegistryPlan: "No registry plan",
          entries: "entries",
          ops: "ops",
          registered: "registered",
          failed: "failed",
        },
      },
    },
  },
})
