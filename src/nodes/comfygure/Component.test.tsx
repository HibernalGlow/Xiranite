import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { compileAnimaInt8Program, type ComfygureData, type ComfygureInput } from "@xiranite/node-comfygure/core"
import { Component } from "./Component"
import type { ComfygureCardState, ComfygureTargetConfig } from "./types"

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: createRef<HTMLDivElement>(), width: 920, height: 640, mode: "expanded", density: "roomy" }),
}))

afterEach(cleanup)

describe("Comfygure node projection", () => {
  it("sends preflight through the host runner without submitting a prompt", async () => {
    const host = createHost()
    render(<Component compId="comfygure-1" host={host as never} />)

    await userEvent.setup().click(await screen.findByRole("button", { name: "Preflight" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({
      nodeId: "comfygure",
      input: { action: "preflight", target: { endpoint: "http://127.0.0.1:8000", libraryPath: "D:/1Repo/Github/ComfyUI/Library" } },
    })
    expect(screen.getByText("Ready to run")).toBeTruthy()
  })

  it("persists only local target settings through the node config capability", async () => {
    const host = createHost()
    render(<Component compId="comfygure-1" host={host as never} />)

    const user = userEvent.setup()
    const library = await screen.findByDisplayValue("D:/1Repo/Github/ComfyUI/Library")
    await user.clear(library)
    await user.type(library, "D:/1Repo/Github/ComfyUI/Library-next")
    await user.click(await screen.findByRole("button", { name: "Save target" }))

    await waitFor(() => expect(host.savedConfig).toEqual({ libraryPath: "D:/1Repo/Github/ComfyUI/Library-next" }))
  })

  it("allows an explicit target edit to be saved while config hydration is still pending", async () => {
    const host = createHost({ pendingConfig: true })
    render(<Component compId="comfygure-1" host={host as never} />)

    const user = userEvent.setup()
    const endpoint = screen.getByDisplayValue("http://127.0.0.1:8000")
    const save = screen.getByRole("button", { name: "Save target" })
    expect(save).toHaveProperty("disabled", true)

    await user.clear(endpoint)
    await user.type(endpoint, "http://localhost:8000")
    await user.click(save)

    await waitFor(() => expect(host.savedConfig).toEqual({ endpoint: "http://localhost:8000" }))
  })

  it("uses the explicit Run control for prompt submission", async () => {
    const host = createHost()
    render(<Component compId="comfygure-1" host={host as never} />)

    await userEvent.setup().click(await screen.findByRole("button", { name: "Run" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ nodeId: "comfygure", input: { action: "submit" } })
  })
})

function createHost(options: { pendingConfig?: boolean } = {}) {
  const compiled = compileAnimaInt8Program()
  const result: NodeRunResult<ComfygureData> = {
    success: true,
    message: "Compatibility preflight passed. No generation was submitted.",
    data: {
      compiled,
      preflight: {
        endpoint: "http://127.0.0.1:8000",
        online: true,
        availableClassCount: 42,
        missingClasses: [],
        missingResources: [],
        uncheckedResources: [],
        warnings: [],
      },
    },
  }
  const host = {
    state: {} as ComfygureCardState,
    runCalls: [] as Array<{ nodeId: string; input: ComfygureInput }>,
    savedConfig: undefined as ComfygureTargetConfig | undefined,
    getData<T>() { return this.state as T },
    patchData(_compId: string, patch: Partial<ComfygureCardState>) { this.state = { ...this.state, ...patch } },
    getNodeConfig: async <T,>() => {
      if (options.pendingConfig) return await new Promise<{ config: T | undefined; path: string }>(() => undefined)
      return { config: { endpoint: "http://127.0.0.1:8000", libraryPath: "D:/1Repo/Github/ComfyUI/Library" } as T, path: "D:/config/xiranite.config.toml" }
    },
    saveNodeConfig: async (config: ComfygureTargetConfig) => { host.savedConfig = config },
    runner: {
      run: async <TInput, TData>(nodeId: string, input: TInput, _onEvent?: (event: NodeRunEvent) => void) => {
        host.runCalls.push({ nodeId, input: input as ComfygureInput })
        return result as NodeRunResult<TData>
      },
    },
  }
  return host
}
