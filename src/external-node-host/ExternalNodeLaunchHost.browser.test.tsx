import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"

const runtime = vi.hoisted(() => ({
  callByName: vi.fn(),
  eventsOn: vi.fn(() => vi.fn()),
}))

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: runtime.callByName },
  Events: { On: runtime.eventsOn },
}))

vi.mock("@/node-app/StandaloneNodeApp", () => ({ StandaloneNodeApp: () => null }))

import { ExternalNodeLaunchHost } from "./ExternalNodeLaunchHost"

beforeEach(() => {
  Object.assign(window, { _wails: {} })
  runtime.callByName.mockReset()
  runtime.eventsOn.mockClear()
})

afterEach(() => {
  delete window._wails
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
