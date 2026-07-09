// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { ComponentType } from "react"
import type {
  AppNodeEntry,
  NodeCapabilityId,
  NodeComponentProps,
  NodeHostRequirements,
} from "@xiranite/contract"
import { NODE_HOST_CONTRACT_VERSION } from "@xiranite/contract"

// Mutable per-test state. Held in vi.hoisted so the hoisted mock factories
// can close over the same reference.
const testState = vi.hoisted(() => ({
  hostRequirements: undefined as NodeHostRequirements | undefined,
  childThrow: false,
}))

const supportedCapabilities: readonly NodeCapabilityId[] = [
  "contract",
  "state",
  "workspace",
  "runner",
  "clipboard",
  "config",
  "env",
  // NOTE: "downloads" intentionally absent so capability-mismatch tests can
  // require it and observe the diagnostic fallback.
]

vi.mock("./hostApi", () => ({
  useNodeHostApi: () => ({
    contract: {
      name: "xiranite.node-host",
      version: NODE_HOST_CONTRACT_VERSION,
      supportedCapabilities,
      hasCapability: (cap: NodeCapabilityId) => supportedCapabilities.includes(cap),
    },
    state: { getData: () => ({}), patchData: () => undefined },
    env: { theme: "light", platform: "web" },
    // deprecated aliases kept so the mock satisfies NodeHostApi structurally
    getData: () => ({}),
    patchData: () => undefined,
    listComponents: () => [],
    updateComponent: () => undefined,
  }),
}))

function TestNodeComponent(_props: NodeComponentProps) {
  if (testState.childThrow) throw new Error("child exploded")
  return <div data-testid="test-node-content">test node rendered</div>
}

vi.mock("./packageModules.generated", () => ({
  packageModuleLoaders: {
    "test-node": () => Promise.resolve({
      default: {
        def: {
          id: "test-node",
          name: "Test",
          version: "0.1.0",
          category: "other",
          description: "test",
          icon: "Box",
        },
        core: {},
        Component: TestNodeComponent as ComponentType<NodeComponentProps>,
        get host() {
          return testState.hostRequirements
        },
      } as AppNodeEntry,
    }),
    "headless-node": () => Promise.resolve({
      default: {
        def: {
          id: "headless-node",
          name: "Headless",
          version: "0.1.0",
          category: "other",
          description: "headless",
          icon: "Box",
        },
        core: {},
      },
    }),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Import after mocks are registered.
import { ModuleRenderer } from "./ModuleRenderer"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  testState.hostRequirements = undefined
  testState.childThrow = false
})

describe("ModuleRenderer package node rendering", () => {
  test("renders the node component when host requirements are satisfied", async () => {
    testState.hostRequirements = {
      contractVersion: "^1.0.0",
      capabilities: ["state", "env"],
    }
    render(<ModuleRenderer moduleId="test-node" compId="c1" />)
    expect(await screen.findByTestId("test-node-content")).toBeTruthy()
  })

  test("renders diagnostic fallback when a required capability is missing", async () => {
    testState.hostRequirements = {
      capabilities: ["state", "downloads"],
    }
    render(<ModuleRenderer moduleId="test-node" compId="c1" />)
    expect(await screen.findByText(/Node "test-node" unavailable/)).toBeTruthy()
    expect(screen.getByText(/Missing host capabilities: downloads/)).toBeTruthy()
  })

  test("renders diagnostic fallback when contract version is incompatible", async () => {
    testState.hostRequirements = { contractVersion: "^2.0.0" }
    render(<ModuleRenderer moduleId="test-node" compId="c1" />)
    expect(await screen.findByText(/Node "test-node" unavailable/)).toBeTruthy()
    expect(screen.getByText(/Contract version mismatch/)).toBeTruthy()
    expect(screen.getByText(/\^2\.0\.0/)).toBeTruthy()
  })

  test("catches render throws via NodeRenderBoundary instead of crashing the workspace", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    testState.hostRequirements = { capabilities: ["state"] }
    testState.childThrow = true
    render(<ModuleRenderer moduleId="test-node" compId="c1" />)
    expect(await screen.findByText(/Node "test-node" failed to render/)).toBeTruthy()
    expect(screen.getByText("child exploded")).toBeTruthy()
    spy.mockRestore()
  })

  test("renders a diagnostic for headless package nodes instead of mounting an undefined component", async () => {
    render(<ModuleRenderer moduleId="headless-node" compId="c1" />)
    expect(await screen.findByText(/Node "headless-node" has no UI component/)).toBeTruthy()
  })
})
