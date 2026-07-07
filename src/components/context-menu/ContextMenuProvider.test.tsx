// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ContextMenuProvider, useContextMenuBuilder } from "./ContextMenuProvider"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ContextMenuProvider", () => {
  test("opens a registered context menu and runs the selected item", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ContextMenuProvider>
        <ContextTarget onSelect={onSelect} />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 48,
      clientY: 64,
    })

    expect(await screen.findByText("Open target")).toBeTruthy()
    await user.click(screen.getByText("Open target"))

    expect(onSelect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText("Open target")).toBeNull())
  })
})

function ContextTarget({ onSelect }: { onSelect: () => void }) {
  useContextMenuBuilder("target", () => [
    { type: "label", label: "Target actions" },
    { label: "Open target", shortcut: "Enter", onSelect },
    { type: "separator" },
    { label: "Disabled item", disabled: true, onSelect: vi.fn() },
  ])

  return (
    <div data-context-menu="target" data-testid="context-target">
      Target
    </div>
  )
}
