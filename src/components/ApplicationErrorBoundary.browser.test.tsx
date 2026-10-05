import type { PropsWithChildren, ReactNode } from "react"
import { page } from "vitest/browser"
import { afterEach, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { ApplicationErrorBoundary } from "./ApplicationErrorBoundary"

const logger = vi.hoisted(() => ({ error: vi.fn() }))
const recovery = vi.hoisted(() => ({
  reloadAtDefaultView: vi.fn(),
  reloadWithWorkspaceReset: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  createLogger: () => logger,
}))

vi.mock("@/lib/renderRecovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/renderRecovery")>()
  return { ...actual, ...recovery }
})

function button(name: string) {
  return page.getByRole("button", { name })
}

afterEach(() => {
  logger.error.mockReset()
  recovery.reloadAtDefaultView.mockReset()
  recovery.reloadWithWorkspaceReset.mockReset()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

test("replaces a failed root provider with a full-screen recovery surface and remounts the application", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  let shouldThrow = true

  function RootProvider({ children }: PropsWithChildren) {
    if (shouldThrow) throw new Error("theme provider failed")
    return children
  }

  await render(
    <ApplicationErrorBoundary>
      <RootProvider>
        <div data-testid="recovered-application">Workspace restored</div>
      </RootProvider>
    </ApplicationErrorBoundary>,
  )

  await expect.element(page.getByRole("heading", { name: "Xiranite ran into a problem" })).toBeVisible()
  await expect.element(page.getByText("theme provider failed", { exact: true })).toBeVisible()
  await expect.element(button("Retry")).toBeVisible()
  await expect.element(button("Reload Xiranite")).toBeVisible()

  const fallback = document.querySelector<HTMLElement>("[data-testid='application-error-fallback']")
  expect(fallback).not.toBeNull()
  expect(fallback!.getBoundingClientRect().height).toBeGreaterThanOrEqual(window.innerHeight)
  expect(logger.error).toHaveBeenCalled()

  shouldThrow = false
  await button("Retry").click()

  await expect.element(page.getByTestId("recovered-application")).toBeVisible()
  expect(page.getByTestId("application-error-fallback").query()).toBeNull()
})

test("offers a default-view reload as the primary action, because reloading the same view crashes again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})

  function BrokenView(): ReactNode {
    throw new Error("view chunk failed to link")
  }

  await render(
    <ApplicationErrorBoundary>
      <BrokenView />
    </ApplicationErrorBoundary>,
  )

  await expect.element(button("Reload at default view")).toBeVisible()
  await button("Reload at default view").click()

  expect(recovery.reloadAtDefaultView).toHaveBeenCalledTimes(1)
  expect(recovery.reloadWithWorkspaceReset).not.toHaveBeenCalled()
})

test("escalates to a workspace reset once the default view has crashed too", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  window.sessionStorage.setItem("xiranite.render-recovery", `1:${Date.now()}`)

  function BrokenView(): ReactNode {
    throw new Error("default view failed to link")
  }

  await render(
    <ApplicationErrorBoundary>
      <BrokenView />
    </ApplicationErrorBoundary>,
  )

  await expect.element(page.getByRole("heading", { name: "Xiranite ran into a problem" })).toBeVisible()
  expect(button("Reload at default view").query()).toBeNull()
  await button("Reset workspace state & reload").click()

  expect(recovery.reloadWithWorkspaceReset).toHaveBeenCalledTimes(1)
})

test("shows the first stack frame, because a linker message alone never names the failing file", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})

  function BrokenFlowView(): ReactNode {
    throw new SyntaxError("Importing binding name 'default' cannot be resolved by star export entries.")
  }

  await render(
    <ApplicationErrorBoundary>
      <BrokenFlowView />
    </ApplicationErrorBoundary>,
  )

  const origin = page.getByTestId("error-origin-frame")
  await expect.element(origin).toBeVisible()
  const frameText = document.querySelector<HTMLElement>("[data-testid='error-origin-frame']")?.textContent ?? ""
  expect(frameText).toMatch(/ApplicationErrorBoundary\.browser\.test\.tsx.*:\d+/)
})

test("reads a JavaScriptCore frame, because the desktop host's WKWebView does not write 'at'", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})

  function JscStackView(): ReactNode {
    const error = new SyntaxError("link failed under JavaScriptCore")
    error.stack = "BrokenFlowView@http://localhost:1420/src/components/workspace/FlowCanvasView.tsx:117:20\n"
      + "@http://localhost:1420/src/main.tsx:9:1"
    throw error
  }

  await render(
    <ApplicationErrorBoundary>
      <JscStackView />
    </ApplicationErrorBoundary>,
  )

  await expect.element(page.getByTestId("error-origin-frame")).toBeVisible()
  const frameText = document.querySelector<HTMLElement>("[data-testid='error-origin-frame']")?.textContent ?? ""
  expect(frameText).toContain("/src/components/workspace/FlowCanvasView.tsx")
})

test("omits the origin line when the error carries no usable stack instead of inventing one", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})

  function StacklessView(): ReactNode {
    const error = new SyntaxError("link failed without a stack")
    error.stack = "SyntaxError: link failed without a stack"
    throw error
  }

  await render(
    <ApplicationErrorBoundary>
      <StacklessView />
    </ApplicationErrorBoundary>,
  )

  await expect.element(page.getByText("link failed without a stack", { exact: true })).toBeVisible()
  expect(page.getByTestId("error-origin-frame").query()).toBeNull()
})

test("stops offering recovery once both levels have crashed, and says the failure is not interface state", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  window.sessionStorage.setItem("xiranite.render-recovery", `2:${Date.now()}`)

  function BrokenView(): ReactNode {
    throw new Error("host build is broken")
  }

  await render(
    <ApplicationErrorBoundary>
      <BrokenView />
    </ApplicationErrorBoundary>,
  )

  await expect.element(page.getByText(/not something the interface can recover from/)).toBeVisible()
  expect(button("Reload at default view").query()).toBeNull()
  expect(button("Reset workspace state & reload").query()).toBeNull()
})
