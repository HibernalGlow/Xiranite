// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import type { CzkawkaData, CzkawkaInput } from "@xiranite/node-czkawka/core"
import { Component, scanInput } from "./Component"
import type { CzkawkaCardState } from "./types"

const surface = vi.hoisted(() => ({ width: 1200, height: 760, mode: "regular" }))
vi.mock("@/nodes/shared/useNodeSurface", () => ({ useNodeSurface: () => ({ ref: { current: null }, ...surface }) }))
afterEach(cleanup)

describe("Czkawka node", () => {
  test("renders all scanners and sends scan input", async () => {
    const host = createHost({ tool: "duplicate-files", includedDirectoriesText: "D:/media", hashType: "blake3" })
    render(<Component compId="czkawka" host={host} />)
    expect(screen.getByText("Czkawka · 重复文件")).toBeTruthy()
    expect(screen.getByRole("button", { name: "相似图片" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "不正确扩展名" })).toBeTruthy()
    await screen.getByRole("button", { name: "开始扫描" }).click()
    await waitFor(() => expect(host.calls[0]).toEqual(expect.objectContaining({ nodeId: "czkawka", input: expect.objectContaining({ action: "scan", tool: "duplicate-files", includedDirectories: ["D:/media"], hashType: "blake3" }) })))
  })

  test("maps fork-specific media settings into the shared scan contract", () => {
    expect(scanInput("similar-videos", {
      similarity: "7",
      similarVideosIgnoreSameSize: true,
      similarVideosSkipForward: "42",
      similarVideosHashDuration: "18",
      similarVideosCropDetect: "motion",
    })).toMatchObject({
      tool: "similar-videos",
      similarity: 7,
      similarVideosIgnoreSameSize: true,
      similarVideosSkipForward: 42,
      similarVideosHashDuration: 18,
      similarVideosCropDetect: "motion",
    })
  })
})

type TestHost = NodeHostApi<CzkawkaCardState, Partial<CzkawkaCardState>> & { stateValue: CzkawkaCardState; calls: Array<{ nodeId: string; input: CzkawkaInput }> }
function createHost(initial: CzkawkaCardState): TestHost {
  const host: TestHost = {
    stateValue: initial,
    calls: [],
    contract: { name: "xiranite.node-host", version: "1.0.0", supportedCapabilities: ["contract", "state", "runner"], hasCapability: () => true },
    env: { theme: "light", platform: "web" },
    state: { getData: () => host.stateValue, patchData: (patch) => { host.stateValue = { ...host.stateValue, ...patch } } },
    runner: { run: async <TInput, TData>(nodeId: string, input: TInput, onEvent?: (event: NodeRunEvent) => void): Promise<NodeRunResult<TData>> => { host.calls.push({ nodeId, input: input as CzkawkaInput }); onEvent?.({ type: "progress", progress: 50, message: "Scanning" }); return { success: true, message: "Found 2 item(s).", data: sample as TData } } },
    getData: <T,>() => host.stateValue as T,
    patchData: (_id, patch) => { host.stateValue = { ...host.stateValue, ...patch } },
    listComponents: () => [],
    updateComponent: () => undefined,
  }
  return host
}

const sample: CzkawkaData = { action: "scan", tool: "duplicate-files", groups: [], entries: [], messages: "", stopped: false, groupCount: 0, fileCount: 0, totalBytes: 0, reclaimableBytes: 0, affectedCount: 0, errorCount: 0 }
