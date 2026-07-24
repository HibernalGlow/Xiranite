import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { NodeLocalFilesCapability, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { compileAnimaInt8Program, compileAnimaInt8RunPlan, createComfygureProfile, decompressComfygureText, importComfyuiWorkflow, type ComfygureData, type ComfygureInput } from "@xiranite/node-comfygure/core"
import { changeLanguage } from "@/i18n"
import { Component } from "./Component"
import type { ComfygureCardState, ComfygureTargetConfig } from "./types"

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: createRef<HTMLDivElement>(), width: 920, height: 640, mode: "expanded", density: "roomy" }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  await changeLanguage("en")
})

describe("Comfygure node projection", () => {
  it("updates visible controls when the application language changes", async () => {
    const host = createHost()
    render(<Component compId="comfygure-1" host={host as never} />)

    expect(screen.getByRole("button", { name: "Preflight" })).toBeTruthy()
    await changeLanguage("zh")

    await waitFor(() => expect(screen.getByRole("button", { name: "预检" })).toBeTruthy())
    expect(screen.getByRole("button", { name: "运行" })).toBeTruthy()
  })

  it("uses the shared resizable-panel system for the project, inspection, and execution swimlanes", () => {
    const host = createHost()
    render(<Component compId="comfygure-1" host={host as never} />)

    const workbench = screen.getByTestId("comfygure-swimlane-workbench")
    expect(workbench.querySelector('[data-slot="resizable-panel-group"]')).toBeTruthy()
    expect(screen.getByTestId("comfygure-project-lane").getAttribute("aria-labelledby")).toBe("comfygure-project-heading")
    expect(screen.getByTestId("comfygure-inspection-lane").getAttribute("aria-labelledby")).toBe("comfygure-inspection-heading")
    expect(screen.getByTestId("comfygure-execution-lane").getAttribute("aria-labelledby")).toBe("comfygure-execution-heading")
    expect(workbench.querySelectorAll('[data-slot="resizable-panel"]')).toHaveLength(3)
    expect(workbench.querySelectorAll('[data-slot="resizable-handle"]')).toHaveLength(2)
  })

  it("builds Liquid templates from react-tag-input parts", async () => {
    const host = createHost()
    render(<Component compId="comfygure-1" host={host as never} />)

    const composer = screen.getByTestId("positive-template-composer")
    expect(composer.querySelector(".react-tags-wrapper")).toBeTruthy()
    expect(composer.querySelectorAll('[data-testid="tag"]')).toHaveLength(3)

    const user = userEvent.setup()
    const input = within(composer).getByRole("textbox", { name: "Add text or choose a variable" })
    await user.click(input)
    await user.type(input, "Batch")
    await user.click(within(composer).getByText("Batch text"))

    expect(composer.querySelectorAll('[data-testid="tag"]')).toHaveLength(5)
    expect(within(composer).getByText("Batch text")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Compile" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.program?.templates?.positive).toBe("{{ prompt.prefix }}, {{ prompt.positive }}, {{ batch.text }}")
  })

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

  it("renders sampler and scheduler choices returned by the ComfyUI target", async () => {
    const host = createHost()
    host.runner.run = async <TInput, TData>(nodeId: string, input: TInput) => {
      host.runCalls.push({ nodeId, input: input as ComfygureInput })
      return {
        success: true,
        message: "Loaded sampler options.",
        data: {
          compiled: compileAnimaInt8Program(),
          runPlan: compileAnimaInt8RunPlan(),
          controlOptions: { samplerNames: ["euler", "euler_ancestral"], schedulers: ["normal", "beta57"], sourceNodeTypes: ["FLS_SamplerV4"] },
        },
      } as NodeRunResult<TData>
    }
    render(<Component compId="comfygure-1" host={host as never} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Load options" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ input: { action: "options" } })
    const sampler = screen.getByRole("combobox", { name: "Sampler" })
    expect(sampler).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Scheduler" })).toBeTruthy()
    await user.click(sampler)
    expect(screen.getByRole("option", { name: "euler_ancestral" })).toBeTruthy()
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

  it("uses the explicit Export canvas control without submitting a prompt", async () => {
    const host = createHost()
    render(<Component compId="comfygure-1" host={host as never} />)

    await userEvent.setup().click(await screen.findByRole("button", { name: "Export canvas" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ nodeId: "comfygure", input: { action: "canvas" } })
  })

  it("serializes direct batch prompts into the Comfygure program before compile", async () => {
    const host = createHost()
    render(<Component compId="comfygure-1" host={host as never} />)

    const user = userEvent.setup()
    fireEvent.change(screen.getByLabelText("Batch positive prompts"), { target: { value: "cat\ndog" } })
    await user.click(screen.getByRole("button", { name: "Compile" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.program?.batch?.prompts).toEqual(["cat", "dog"])
  })

  it("imports local prompt text and persists it in compressed node state", async () => {
    const host = createHost()
    host.localFiles = {
      getUrl: (path) => `local://${path}`,
      pickFiles: async () => ["D:/prompt-a.txt", "D:/prompt-b.txt"],
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => url.endsWith("prompt-a.txt") ? "cat\ndog" : "fox",
    })))
    render(<Component compId="comfygure-1" host={host as never} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Import text" }))
    await waitFor(() => expect(host.state.batchText?.lineCount).toBe(3))
    expect(host.state.batchText?.data).not.toContain("cat")
    expect(host.state.program?.batch.prompts).toEqual([])
    expect(host.state.program?.batch.entries).toEqual([])
    expect(JSON.parse(decompressComfygureText(host.state.batchEntryMetadata))).toEqual([
      { sourceName: "prompt-a.txt", sourcePath: "D:/prompt-a.txt" },
      { sourceName: "prompt-a.txt", sourcePath: "D:/prompt-a.txt" },
      { sourceName: "prompt-b.txt", sourcePath: "D:/prompt-b.txt" },
    ])

    await user.click(screen.getByRole("button", { name: "Compile" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]?.input.program?.batch?.prompts).toEqual(["cat", "dog", "fox"])
    expect(host.runCalls[0]?.input.program?.batch?.entries).toEqual([
      { text: "cat", sourceName: "prompt-a.txt", sourcePath: "D:/prompt-a.txt" },
      { text: "dog", sourceName: "prompt-a.txt", sourcePath: "D:/prompt-a.txt" },
      { text: "fox", sourceName: "prompt-b.txt", sourcePath: "D:/prompt-b.txt" },
    ])
  })

  it("imports a workflow through the backend runner and requires an explicit binding confirmation", async () => {
    const host = createHost()
    const workflow = JSON.stringify({
      "1": { class_type: "CLIPTextEncode", inputs: { text: "cat" }, _meta: { title: "Positive" } },
    })
    const imported = importComfyuiWorkflow(workflow)
    host.localFiles = {
      getUrl: (path) => `local://${path}`,
      pickFiles: async () => ["D:/template.json"],
    }
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => workflow })))
    host.runner.run = async <TInput, TData>(nodeId: string, input: TInput) => {
      host.runCalls.push({ nodeId, input: input as ComfygureInput })
      return {
        success: true,
        message: "Imported a ComfyUI template. Confirm the inferred bindings before compiling it.",
        data: { compiled: compileAnimaInt8Program(), runPlan: compileAnimaInt8RunPlan(), workflowImport: imported },
      } as NodeRunResult<TData>
    }
    render(<Component compId="comfygure-1" host={host as never} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Import workflow" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ nodeId: "comfygure", input: { action: "import", workflowSource: workflow, template: undefined } })
    expect(screen.getByRole("button", { name: "Confirm bindings" })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Confirm bindings" }))
    expect(host.state.template?.bindingManifest.confirmed).toBe(true)
  })

  it("loads and saves versioned generation profiles only through the backend runner", async () => {
    const host = createHost()
    const profile = createComfygureProfile({ parameters: { width: 1536, height: 896 } }, "Portrait", { now: new Date("2026-07-24T00:00:00.000Z") })
    host.runner.run = async <TInput, TData>(nodeId: string, input: TInput) => {
      host.runCalls.push({ nodeId, input: input as ComfygureInput })
      const action = (input as ComfygureInput).action
      const data: ComfygureData = {
        compiled: compileAnimaInt8Program(),
        runPlan: compileAnimaInt8RunPlan(),
        ...(action === "profiles" ? { profiles: [{ id: profile.id, name: profile.name, revision: profile.revision, updatedAt: profile.updatedAt }] } : {}),
        ...(action === "saveProfile" ? { profile } : {}),
      }
      return { success: true, message: "Profile action complete.", data } as NodeRunResult<TData>
    }
    render(<Component compId="comfygure-1" host={host as never} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Profiles" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ input: { action: "profiles" } })
    expect(host.state.profiles).toEqual([{ id: "portrait", name: "Portrait", revision: 1, updatedAt: "2026-07-24T00:00:00.000Z" }])

    await user.click(screen.getByRole("button", { name: "Save profile" }))
    await waitFor(() => expect(host.runCalls).toHaveLength(2))
    expect(host.runCalls[1]).toMatchObject({ input: { action: "saveProfile", profileName: "ANIMA INT8" } })
    expect(host.state.profile?.id).toBe("portrait")
  })

  it("refreshes only previously submitted prompt IDs", async () => {
    const host = createHost()
    host.state = {
      submission: { endpoint: "http://127.0.0.1:8000", promptId: "prompt-1", clientId: "xiranite-comfygure" },
      submissions: [
        { endpoint: "http://127.0.0.1:8000", promptId: "prompt-1", clientId: "xiranite-comfygure" },
        { endpoint: "http://127.0.0.1:8000", promptId: "prompt-2", clientId: "xiranite-comfygure" },
      ],
    }
    render(<Component compId="comfygure-1" host={host as never} />)

    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh results" }))

    await waitFor(() => expect(host.runCalls).toHaveLength(1))
    expect(host.runCalls[0]).toMatchObject({ nodeId: "comfygure", input: { action: "refresh", promptIds: ["prompt-1", "prompt-2"] } })
  })
})

function createHost(options: { pendingConfig?: boolean } = {}) {
  const compiled = compileAnimaInt8Program()
  const result: NodeRunResult<ComfygureData> = {
    success: true,
    message: "Compatibility preflight passed. No generation was submitted.",
    data: {
      compiled,
      runPlan: compileAnimaInt8RunPlan(),
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
    localFiles: undefined as NodeLocalFilesCapability | undefined,
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
