// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { SoundwData, SoundwInput } from "@xiranite/node-soundw/core"
import { NODE_SURFACE_TEST_MODES, NODE_SURFACE_TEST_SPECS } from "@/nodes/shared/nodeSurfaceTestUtils"
import type { NodeSurfaceMode } from "@/nodes/shared/useNodeSurface"
import { Component } from "./Component"

type State = { profileName?: string; soundSwitchPath?: string; result?: SoundwData | null; logs?: string[]; phase?: "idle" | "running" | "completed" | "error"; progressText?: string }
const surface = vi.hoisted(() => ({ height: 420, width: 720 }))
vi.mock("@/nodes/shared/useNodeSurface", async (original) => { const actual = await original<typeof import("@/nodes/shared/useNodeSurface")>(); return { ...actual, useNodeSurface: () => ({ ref: { current: null }, width: surface.width, height: surface.height, mode: actual.resolveNodeSurfaceMode(surface), density: actual.resolveNodeSurfaceDensity(actual.resolveNodeSurfaceMode(surface)) }) } })
afterEach(() => { cleanup(); vi.clearAllMocks(); Object.assign(surface, NODE_SURFACE_TEST_SPECS.regular) })

describe("SoundW responsive workbench", () => {
  test.each(NODE_SURFACE_TEST_MODES)("renders %s surface", (mode) => { Object.assign(surface, NODE_SURFACE_TEST_SPECS[mode]); render(<Component compId="soundw-1" host={createHost({})} />); expect(screen.getByText("SoundSwitch")).toBeTruthy(); const view = ["regular", "expanded", "workspace"].includes(mode) ? "full" : mode; expect(screen.getByTestId(`soundw-${view}-view`)).toBeTruthy() })
  test("runs a user-triggered status check through the native runner", async () => { const host = createHost({}); render(<Component compId="soundw-1" host={host} />); await userEvent.setup().click(screen.getByRole("button", { name: "检查状态" })); await waitFor(() => expect(host.calls).toHaveLength(1)); expect(host.calls[0]).toEqual({ nodeId: "soundw", input: expect.objectContaining({ action: "status" }) }); expect(host.stateData.result?.muteState).toBe("unmuted") })
})

type TestHost = NodeHostApi<State, Partial<State>> & { calls: Array<{ nodeId: string; input: SoundwInput }>; stateData: State }
function createHost(initial: State): TestHost { const host = { calls: [], stateData: { ...initial }, contract: { name: "xiranite.node-host", version: "1", supportedCapabilities: ["contract", "state", "runner", "clipboard", "config"], hasCapability: () => true }, env: { theme: "light", platform: "web" }, state: { getData: () => host.stateData, patchData: (patch: Partial<State>) => { host.stateData = { ...host.stateData, ...patch } } }, runner: { run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => { host.calls.push({ nodeId, input: input as SoundwInput }); onEvent?.({ type: "progress", progress: 50, message: "Checking SoundSwitch." }); return { success: true, message: "SoundSwitch is ready.", data: result as TData } } }, clipboard: { readText: async () => "", writeText: async () => undefined }, config: { get: async () => ({ config: undefined, path: "" }), save: async () => undefined, openFile: () => undefined }, getData: <T,>() => host.stateData as T, patchData: (_id: string, patch: Partial<State>) => host.state.patchData(patch), listComponents: () => [], updateComponent: () => undefined } satisfies TestHost; return host }
const result: SoundwData = { installed: true, command: ["mute"], output: "Microphone unmuted", profiles: ["Recording"], muteState: "unmuted", errors: [] }
