import type { PropsWithChildren } from "react"
import { page } from "vitest/browser"
import { afterEach, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { ApplicationErrorBoundary } from "./ApplicationErrorBoundary"

const logger = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock("@/lib/logger", () => ({
  createLogger: () => logger,
}))

afterEach(() => {
  logger.error.mockReset()
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
  await expect.element(page.getByRole("button", { name: "Retry" })).toBeVisible()
  await expect.element(page.getByRole("button", { name: "Reload Xiranite" })).toBeVisible()

  const fallback = document.querySelector<HTMLElement>("[data-testid='application-error-fallback']")
  expect(fallback).not.toBeNull()
  expect(fallback!.getBoundingClientRect().height).toBeGreaterThanOrEqual(window.innerHeight)
  expect(logger.error).toHaveBeenCalled()

  shouldThrow = false
  await page.getByRole("button", { name: "Retry" }).click()

  await expect.element(page.getByTestId("recovered-application")).toBeVisible()
  expect(page.getByTestId("application-error-fallback").query()).toBeNull()
})
