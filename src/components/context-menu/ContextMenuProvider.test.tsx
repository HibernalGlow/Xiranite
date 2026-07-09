// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  ContextMenuProvider,
  useContextMenuBuilder,
  type ContextMenuItemDef,
} from "./ContextMenuProvider"

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

  test("disabled item does not call its handler", async () => {
    const onDisabled = vi.fn()
    const onOk = vi.fn()
    const user = userEvent.setup()

    render(
      <ContextMenuProvider>
        <ContextTarget
          items={[
            { label: "Disabled", disabled: true, onSelect: onDisabled },
            { label: "OK", onSelect: onOk },
          ]}
        />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 10,
      clientY: 10,
    })

    // Disabled items render with disabled state. Clicking should not invoke handler.
    const disabledItem = await screen.findByText("Disabled")
    // Radix renders disabled items with data-disabled; click is a no-op.
    await user.click(disabledItem)
    expect(onDisabled).not.toHaveBeenCalled()

    // Menu stays open; click OK to close.
    await user.click(screen.getByText("OK"))
    expect(onOk).toHaveBeenCalledTimes(1)
  })

  test("hidden items are not rendered", async () => {
    render(
      <ContextMenuProvider>
        <ContextTarget
          items={[
            { label: "Visible", onSelect: vi.fn() },
            { label: "Hidden", hidden: true, onSelect: vi.fn() },
          ]}
        />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 10,
      clientY: 10,
    })

    await screen.findByText("Visible")
    expect(screen.queryByText("Hidden")).toBeNull()
  })

  test("consecutive separators are collapsed and leading/trailing separators trimmed", async () => {
    render(
      <ContextMenuProvider>
        <ContextTarget
          items={[
            { type: "separator" },
            { type: "separator" },
            { label: "First", onSelect: vi.fn() },
            { type: "separator" },
            { type: "separator" },
            { label: "Second", onSelect: vi.fn() },
            { type: "separator" },
          ]}
        />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 10,
      clientY: 10,
    })

    await screen.findByText("First")
    await screen.findByText("Second")
    // Exactly one separator between First and Second — represented by a single
    // separator element. We assert that the menu rendered both items and that
    // no leading/trailing separator was emitted.
    const separators = document.querySelectorAll("[data-slot='dropdown-menu-separator']")
    expect(separators.length).toBe(1)
  })

  test("checkbox item calls onCheckedChange with new value", async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ContextMenuProvider>
        <ContextTarget
          items={[
            {
              type: "checkbox",
              label: "Toggle me",
              checked: false,
              onCheckedChange,
            },
          ]}
        />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 10,
      clientY: 10,
    })

    await user.click(await screen.findByText("Toggle me"))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  test("radio group renders a single group and calls onRadioChange", async () => {
    const onRadioChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ContextMenuProvider>
        <ContextTarget
          items={[
            {
              type: "radio",
              radioGroup: "color",
              radioValue: "red",
              onRadioChange,
              value: "red",
              label: "Red",
            },
            {
              type: "radio",
              radioGroup: "color",
              value: "blue",
              label: "Blue",
            },
          ]}
        />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 10,
      clientY: 10,
    })

    // Both options present.
    await screen.findByText("Red")
    await screen.findByText("Blue")

    // Exactly one radio group element.
    const groups = document.querySelectorAll("[data-slot='dropdown-menu-radio-group']")
    expect(groups.length).toBe(1)

    // Selecting Blue should call onRadioChange with "blue".
    await user.click(screen.getByText("Blue"))
    expect(onRadioChange).toHaveBeenCalledTimes(1)
    expect(onRadioChange).toHaveBeenCalledWith("blue")
  })

  test("submenu renders its children", async () => {
    const user = userEvent.setup()

    render(
      <ContextMenuProvider>
        <ContextTarget
          items={[
            {
              label: "Parent",
              children: [{ label: "Sub item", onSelect: vi.fn() }],
            },
          ]}
        />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 10,
      clientY: 10,
    })

    // Submenu trigger is visible.
    await screen.findByText("Parent")

    // Hovering the trigger opens the sub content in Radix.
    await user.hover(screen.getByText("Parent"))
    // Sub content should now render (possibly after a small delay).
    await waitFor(() => {
      expect(screen.getByText("Sub item")).toBeTruthy()
    })
  })

  test("editable target keeps native context menu (no custom menu opens)", async () => {
    const onSelect = vi.fn()

    render(
      <ContextMenuProvider>
        <ContextTargetWithInput onSelect={onSelect} />
      </ContextMenuProvider>,
    )

    const input = screen.getByTestId("editable-input")
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 })

    // No custom menu content should appear.
    await waitFor(() => {
      expect(screen.queryByText("Open target")).toBeNull()
    })
    expect(onSelect).not.toHaveBeenCalled()
  })

  test("editable target via role=textbox also keeps native menu", async () => {
    const onSelect = vi.fn()

    render(
      <ContextMenuProvider>
        <ContextTargetWithRoleTextbox onSelect={onSelect} />
      </ContextMenuProvider>,
    )

    const div = screen.getByTestId("role-textbox")
    fireEvent.contextMenu(div, { clientX: 10, clientY: 10 })

    await waitFor(() => {
      expect(screen.queryByText("Open target")).toBeNull()
    })
    expect(onSelect).not.toHaveBeenCalled()
  })

  test("tldraw canvas keeps its own context menu instead of workspace menu", async () => {
    const onSelect = vi.fn()

    render(
      <ContextMenuProvider>
        <TldrawCanvasTarget onWorkspaceSelect={onSelect} />
      </ContextMenuProvider>,
    )

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    })
    screen.getByTestId("tldraw-canvas").dispatchEvent(event)

    await waitFor(() => {
      expect(screen.queryByText("Workspace action")).toBeNull()
    })
    expect(event.defaultPrevented).toBe(false)
    expect(onSelect).not.toHaveBeenCalled()
  })

  test("project menu scopes inside tldraw still open the project menu", async () => {
    render(
      <ContextMenuProvider>
        <TldrawFlowNodeTarget />
      </ContextMenuProvider>,
    )

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
    })
    screen.getByTestId("flow-node-target").dispatchEvent(event)

    expect(await screen.findByText("Flow node action")).toBeTruthy()
    expect(event.defaultPrevented).toBe(true)
  })

  test("confirm dialog requires confirmation before running onSelect", async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <ContextMenuProvider>
        <ContextTarget
          items={[
            {
              label: "Delete",
              destructive: true,
              confirm: {
                title: "Delete component?",
                description: "This removes the component.",
                confirmLabel: "Delete",
                cancelLabel: "Cancel",
              },
              onSelect,
            },
          ]}
        />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 10,
      clientY: 10,
    })

    // Click Delete in the menu.
    await user.click(await screen.findByText("Delete"))

    // Confirm dialog appears.
    await screen.findByText("Delete component?")
    expect(onSelect).not.toHaveBeenCalled()

    // Confirm.
    await user.click(screen.getByText("Delete"))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  test("keepOpen keeps menu open after selecting item", async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <ContextMenuProvider>
        <KeepOpenTarget onSelect={onSelect} onClose={onClose} />
      </ContextMenuProvider>,
    )

    fireEvent.contextMenu(screen.getByTestId("context-target"), {
      clientX: 10,
      clientY: 10,
    })

    await user.click(await screen.findByText("Persistent"))
    expect(onSelect).toHaveBeenCalledTimes(1)
    // Menu should still be open.
    expect(screen.getByText("Persistent")).toBeTruthy()
  })
})

function ContextTarget({
  onSelect,
  items,
}: {
  onSelect?: () => void
  items?: ContextMenuItemDef[]
}) {
  useContextMenuBuilder("target", () => items ?? [{ label: "Open target", shortcut: "Enter", onSelect }])
  return (
    <div data-context-menu="target" data-testid="context-target">
      Target
    </div>
  )
}

function ContextTargetWithInput({ onSelect }: { onSelect: () => void }) {
  useContextMenuBuilder("target", () => [{ label: "Open target", onSelect }])
  return (
    <div data-context-menu="target" data-testid="context-target">
      <input data-testid="editable-input" defaultValue="text" />
    </div>
  )
}

function ContextTargetWithRoleTextbox({ onSelect }: { onSelect: () => void }) {
  useContextMenuBuilder("target", () => [{ label: "Open target", onSelect }])
  return (
    <div data-context-menu="target" data-testid="context-target">
      <div data-testid="role-textbox" role="textbox" contentEditable suppressContentEditableWarning>
        editable
      </div>
    </div>
  )
}

function TldrawCanvasTarget({ onWorkspaceSelect }: { onWorkspaceSelect: () => void }) {
  useContextMenuBuilder("workspace-canvas", () => [{ label: "Workspace action", onSelect: onWorkspaceSelect }])
  return (
    <div data-context-menu="workspace-canvas">
      <div className="tl-container" data-testid="tldraw-canvas">
        tldraw
      </div>
    </div>
  )
}

function TldrawFlowNodeTarget() {
  useContextMenuBuilder("flow-node", () => [{ label: "Flow node action", onSelect: vi.fn() }])
  return (
    <div data-context-menu="workspace-canvas">
      <div className="tl-container">
        <div data-context-menu="flow-node" data-testid="flow-node-target">
          flow node
        </div>
      </div>
    </div>
  )
}

function KeepOpenTarget({ onSelect, onClose }: { onSelect: () => void; onClose: () => void }) {
  useContextMenuBuilder("target", () => [
    { label: "Persistent", keepOpen: true, onSelect },
    { label: "Close", onSelect: onClose },
  ])
  return (
    <div data-context-menu="target" data-testid="context-target">
      Target
    </div>
  )
}
