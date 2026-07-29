import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"

const standalone = vi.hoisted(() => ({ onHostReady: undefined as ((value: any) => void) | undefined }))

const runtime = vi.hoisted(() => ({
  callByName: vi.fn(),
  eventsOn: vi.fn(() => vi.fn()),
}))

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: runtime.callByName },
  Events: { On: runtime.eventsOn },
}))

vi.mock("@/node-app/StandaloneNodeApp", () => ({
  StandaloneNodeApp: ({ onHostReady }: { onHostReady?: (value: any) => void }) => {
    standalone.onHostReady = onHostReady
    return null
  },
}))

import { ExternalNodeLaunchHost } from "./ExternalNodeLaunchHost"
import {
  completeExternalNodeLaunch,
  externalNodeLaunchSnapshot,
  resetExternalNodeLaunchDeliveryForTests,
} from "./externalNodeLaunchDelivery"

beforeEach(() => {
  Object.assign(window, { _wails: {} })
  runtime.callByName.mockReset()
  runtime.eventsOn.mockClear()
  standalone.onHostReady = undefined
  resetExternalNodeLaunchDeliveryForTests()
})

afterEach(() => {
  delete window._wails
  resetExternalNodeLaunchDeliveryForTests()
})

test("[external-node-host.gui] calls parameterless launch-host methods without an undefined argument", async () => {
  runtime.callByName.mockImplementation(async (method: string) => {
    if (method.endsWith("ExternalNodeLaunchHostInfo")) return { nodeId: "neoview", snapshotId: "external-launch-v1" }
    if (method.endsWith("ExternalNodeLaunchInitial")) return null
    throw new Error(`Unexpected Wails call: ${method}`)
  })

  await render(<ExternalNodeLaunchHost />)

  await expect.poll(() => runtime.callByName).toHaveBeenCalledWith("main.XiraniteService.ExternalNodeLaunchHostInfo")
  expect(runtime.callByName).toHaveBeenNthCalledWith(1, "main.XiraniteService.ExternalNodeLaunchHostInfo")
  await expect.poll(() => runtime.callByName).toHaveBeenNthCalledWith(2, "main.XiraniteService.ExternalNodeLaunchInitial")
})

test("[external-node-host.gui] polls for reused launches when the desktop event is unavailable", async () => {
  let launchChecks = 0
  runtime.callByName.mockImplementation(async (method: string) => {
    if (method.endsWith("ExternalNodeLaunchHostInfo")) return { nodeId: "neoview", snapshotId: "external-launch-v1" }
    if (method.endsWith("ExternalNodeLaunchInitial")) {
      launchChecks += 1
      return launchChecks > 1
        ? { version: 1, requestId: "reused-launch", nodeId: "neoview", intent: "open", targets: [] }
        : null
    }
    throw new Error(`Unexpected Wails call: ${method}`)
  })

  await render(<ExternalNodeLaunchHost />)

  await expect.poll(() => launchChecks).toBeGreaterThan(1)
  const launchCalls = runtime.callByName.mock.calls.filter(([method]: [string]) => method.endsWith("ExternalNodeLaunchInitial"))
  expect(launchCalls.every((call: unknown[]) => call.length === 1)).toBe(true)
})

test("[external-node-host.gui] does not replay a completed launch when node state recreates its host API", async () => {
  const launch = {
    version: 1,
    requestId: "initial-launch",
    nodeId: "neoview",
    intent: "open",
    targets: [{ kind: "file", uri: "file:///C:/books/initial.png" }],
  }
  runtime.callByName.mockImplementation(async (method: string) => {
    if (method.endsWith("ExternalNodeLaunchHostInfo")) return { nodeId: "neoview", snapshotId: "external-launch-v1" }
    if (method.endsWith("ExternalNodeLaunchInitial")) return launch
    throw new Error(`Unexpected Wails call: ${method}`)
  })

  await render(<ExternalNodeLaunchHost />)
  await expect.poll(() => standalone.onHostReady).toBeTypeOf("function")
  const nodeHost = () => ({
    entry: {} as any,
    host: { contract: { hasCapability: () => true } } as any,
  })
  standalone.onHostReady!(nodeHost())
  await expect.poll(() => externalNodeLaunchSnapshot()?.requestId).toBe(launch.requestId)

  completeExternalNodeLaunch(launch.requestId)
  await expect.poll(() => externalNodeLaunchSnapshot()).toBeUndefined()
  standalone.onHostReady!(nodeHost())
  await new Promise<void>((resolve) => window.setTimeout(resolve, 25))

  expect(externalNodeLaunchSnapshot()).toBeUndefined()
})
