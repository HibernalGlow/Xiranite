// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import { Component } from "./Component.js"
import type { LoratData, LoratInput, LoratRow } from "./core.js"
import { summarizeLoratRows } from "./core.js"

afterEach(() => cleanup())

describe("lorat Component", () => {
  test("runs scan and renders adaptive lorat rows", async () => {
    const host = createHost({})
    render(<Component compId="lorat-1" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByText("Scan"))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ nodeId: "lorat", input: { action: "scan" } })
    expect(host.state.rows?.[0]?.name).toBe("@alice.safetensors")
    expect(screen.getByText("@alice.safetensors")).toBeTruthy()
  })

  test("selects missing rows and writes triggers", async () => {
    const host = createHost({ rows: sampleRows })
    render(<Component compId="lorat-1" host={host} />)
    const user = userEvent.setup()

    await user.click(screen.getByText("Missing"))
    expect(host.state.rows?.find((row) => row.key === "@alice")?.selected).toBe(true)

    await user.click(screen.getByText("Write"))
    await waitFor(() => expect(host.runCalls.at(-1)?.input.action).toBe("write_triggers"))
    expect(host.runCalls.at(-1)?.input.selectedKeys).toEqual(["@alice"])
  })
})

interface LoratCardState {
  folderPath?: string
  triggerDbJson?: string
  rows?: LoratRow[]
  logs?: string[]
  phase?: string
  progress?: number
  progressText?: string
}

type TestHost = NodeHostApi & {
  state: LoratCardState
  runCalls: Array<{ nodeId: string; input: LoratInput }>
}

function createHost(initial: LoratCardState): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: { type: "progress" | "log"; progress?: number; message: string }) => void): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as LoratInput })
        onEvent?.({ type: "progress", progress: 100, message: "ok" })
        return {
          success: true,
          message: "ok",
          data: loratData,
        } as NodeRunResult<TData>
      },
    },
    clipboard: {
      readText: async () => "D:/loras",
      writeText: async () => undefined,
    },
    downloadText: () => undefined,
    env: {
      theme: "light",
      platform: "node",
    },
  }
  return host
}

const sampleRows: LoratRow[] = [
  {
    key: "@alice",
    name: "@alice.safetensors",
    stem: "@alice",
    filePath: "D:/loras/@alice.safetensors",
    relativeDir: "",
    relativePath: "@alice.safetensors",
    pathParts: [],
    status: "missing",
    originalStatus: "missing",
    trigger: "@alice",
    originalTrigger: "@alice",
    source: "filename @",
    dbKey: "",
    changed: false,
  },
]

const loratData: LoratData = {
  folderPath: "D:/loras",
  rows: sampleRows,
  stats: summarizeLoratRows(sampleRows),
  triggerDbJson: "",
  writtenCount: 0,
  skippedCount: 0,
  errors: [],
}
