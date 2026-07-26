import { page } from "vitest/browser"
import { expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { NodeAppClosePrompt, NodeAppDiagnosticScreen } from "./StandaloneNodeApp"

test("renders the standalone-node diagnostic and retries backend validation", async () => {
  const retry = vi.fn()
  const screen = await render(
    <NodeAppDiagnosticScreen diagnostic={{
      status: "failed",
      message: "The bundled Bun backend did not start.",
      manifest: {
        snapshotId: "a1b2c3d4",
        node: { id: "xlchemy", name: "Xlchemy" },
        source: { commit: "abc123" },
        toolchain: { bun: "1.4.0" },
        dataContract: { minimumSupportedVersion: 1, maximumSupportedVersion: 1 },
      },
      retry,
    }} />,
  )

  await expect.element(page.getByRole("heading", { name: "Xlchemy could not start" })).toBeVisible()
  await expect.element(page.getByText("a1b2c3d4")).toBeVisible()
  await expect.element(page.getByText("bun scripts/package-node-app.ts xlchemy")).toBeVisible()
  await expect.element(page.getByText("Supported data contract")).toBeVisible()

  await screen.getByRole("button", { name: "Retry" }).click()
  expect(retry).toHaveBeenCalledOnce()
})

test("keeps the window open when standalone task status cannot be verified", async () => {
  const onReturn = vi.fn()
  const screen = await render(<NodeAppClosePrompt prompt={{ queryError: "Unable to verify active task status: connection refused" }} onReturn={onReturn} />)

  await expect.element(page.getByRole("heading", { name: "Task status is unavailable" })).toBeVisible()
  await screen.getByRole("button", { name: "Return" }).click()
  expect(onReturn).toHaveBeenCalledOnce()
})

test("offers all close actions while a standalone-node task is active", async () => {
  const onReturn = vi.fn()
  const screen = await render(<NodeAppClosePrompt prompt={{ activeTasks: 2 }} onReturn={onReturn} />)

  await expect.element(page.getByRole("heading", { name: "Tasks are still running" })).toBeVisible()
  await expect.element(page.getByText("2 active tasks will remain attached to this node application.")).toBeVisible()
  await expect.element(page.getByRole("button", { name: "Continue in background" })).toBeVisible()
  await expect.element(page.getByRole("button", { name: "Cancel tasks and exit" })).toBeVisible()

  await screen.getByRole("button", { name: "Return" }).click()
  expect(onReturn).toHaveBeenCalledOnce()
})
