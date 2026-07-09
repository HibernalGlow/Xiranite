import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test } from "vitest"
import type { NodeCapabilityId, NodeComponentProps, NodeHostApi, NodeRunEvent, NodeRunResult } from "@xiranite/contract"
import { NODE_HOST_CONTRACT_VERSION } from "@xiranite/contract"
import type { NodeSurfaceMode } from "./useNodeSurface"

export type MigratedToolTestHost<TState extends Record<string, unknown>, TInput> =
  NodeHostApi<TState> & {
    cardState: TState
    runCalls: Array<{ nodeId: string; input: TInput }>
  }

export function createMigratedToolTestHost<
  TState extends Record<string, unknown>,
  TInput,
  TData = Record<string, unknown>,
>(
  initialState: TState,
  runResult: NodeRunResult<TData>,
): MigratedToolTestHost<TState, TInput> {
  const supportedCapabilities: readonly NodeCapabilityId[] = [
    "contract",
    "state",
    "runner",
    "clipboard",
    "downloads",
    "config",
    "env",
  ]

  const run = async <TRunInput, TRunData>(
    nodeId: string,
    input: TRunInput,
    onEvent?: (event: NodeRunEvent) => void,
  ): Promise<NodeRunResult<TRunData>> => {
    host.runCalls.push({ nodeId, input: input as unknown as TInput })
    onEvent?.({ type: "progress", progress: 40, message: "Planning operation." })
    return runResult as unknown as NodeRunResult<TRunData>
  }

  const stateCapability = {
    getData: () => host.cardState,
    patchData: (patch: Partial<TState>) => {
      host.cardState = { ...host.cardState, ...patch }
    },
  }

  const host: MigratedToolTestHost<TState, TInput> = {
    contract: {
      name: "xiranite.node-host",
      version: NODE_HOST_CONTRACT_VERSION,
      supportedCapabilities,
      hasCapability: (capability) => supportedCapabilities.includes(capability),
    },
    state: stateCapability,
    runner: { run },
    clipboard: {
      readText: async () => "",
      writeText: async () => undefined,
    },
    downloads: {
      text: () => undefined,
    },
    config: {
      get: async () => ({ config: undefined, path: "D:/config/node.toml" }),
      save: async () => undefined,
      getUi: async () => ({ config: undefined, path: "D:/config/node-ui.toml" }),
      saveUi: async () => undefined,
      openFile: () => undefined,
    },
    env: {
      theme: "light",
      platform: "web",
    },
    cardState: { ...initialState },
    runCalls: [],

    getData: <T,>() => stateCapability.getData() as T | undefined,
    patchData: (_compId, patch) => stateCapability.patchData(patch as Partial<TState>),
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: { run },
    downloadText: () => undefined,
    getNodeConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/node.toml" }),
    saveNodeConfig: async () => undefined,
    getNodeUiConfig: async <T,>() => ({ config: undefined as T | undefined, path: "D:/config/node-ui.toml" }),
    saveNodeUiConfig: async () => undefined,
    openConfigFile: () => undefined,
  }

  return host
}

export async function expectMigratedToolRun<
  TState extends Record<string, unknown>,
  TInput,
  TData,
>({
  Component,
  nodeId,
  initialState,
  runResult,
  buttonName,
  expectedInput,
}: {
  Component: ComponentType<NodeComponentProps>
  nodeId: string
  initialState: TState
  runResult: NodeRunResult<TData>
  buttonName: string
  expectedInput: Partial<TInput>
}) {
  const host = createMigratedToolTestHost<TState, TInput, TData>(initialState, runResult)
  render(<Component compId={`comp-${nodeId}`} host={host} />)

  fireEvent.click(screen.getByRole("button", { name: buttonName }))

  await waitFor(() => expect(host.runCalls).toHaveLength(1))
  expect(host.runCalls[0]?.nodeId).toBe(nodeId)
  expect(host.runCalls[0]?.input).toMatchObject(expectedInput)
  await waitFor(() => expect(host.cardState.phase).toBe("success"))
  return host
}

export function describeMigratedToolComponentContract<
  TState extends Record<string, unknown>,
  TInput,
  TData,
>({
  name,
  Component,
  nodeId,
  title,
  initialState,
  runResult,
  buttonName,
  expectedInput,
  surfaceModes,
}: {
  name: string
  Component: ComponentType<NodeComponentProps>
  nodeId: string
  title: string
  initialState: TState
  runResult: NodeRunResult<TData>
  buttonName: string
  expectedInput: Partial<TInput>
  surfaceModes: readonly NodeSurfaceMode[]
}) {
  describe(name, () => {
    afterEach(() => {
      cleanup()
    })

    test.each(surfaceModes)("renders the %s surface content", () => {
      const host = createMigratedToolTestHost<TState, TInput, TData>(initialState, runResult)
      render(<Component compId={`comp-${nodeId}`} host={host} />)

      expect(screen.getByText(title)).toBeTruthy()
      expect(screen.getByRole("button", { name: buttonName })).toBeTruthy()
      expect(screen.queryByText(/has no UI component/i)).toBeNull()
    })

    test(`runs ${nodeId} through the host runner`, async () => {
      await expectMigratedToolRun({
        Component,
        nodeId,
        initialState,
        runResult,
        buttonName,
        expectedInput,
      })
    })
  })
}
