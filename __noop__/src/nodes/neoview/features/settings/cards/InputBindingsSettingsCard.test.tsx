import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { InputBindingsEditor } from "./InputBindingsSettingsCard"

afterEach(cleanup)

describe("InputBindingsSettingsCard", () => {
  it("[neoview.bindings.editor] filters contexts and exposes all device editors", () => {
    render(<InputBindingsEditor value={{ bindings: [
      binding("key", "keyboard"), binding("mouse", "mouse"), binding("gesture", "mouse-gesture"), binding("wheel", "wheel"), binding("touch", "touch"), binding("pad", "gamepad"),
    ] }} onSave={vi.fn()} />)
    expect(screen.getAllByRole("listitem")).toHaveLength(6)
    expect(screen.getAllByRole("combobox", { name: "输入设备" }).map((element) => (element as HTMLSelectElement).value)).toEqual(["keyboard", "mouse", "mouse-gesture", "wheel", "touch", "gamepad"])
    fireEvent.change(screen.getByRole("combobox", { name: "筛选上下文" }), { target: { value: "panel" } })
    expect(screen.queryAllByRole("listitem")).toHaveLength(0)
  })

  it("[neoview.bindings.action-capability] hides actions without a GUI provider", () => {
    render(<InputBindingsEditor value={{ bindings: [binding("key", "keyboard")] }} onSave={vi.fn()} />)
    const actionSelect = screen.getByRole("combobox", { name: "动作" })
    expect(actionSelect.querySelector('option[value="reader.next-page"]')).not.toBeNull()
    expect(actionSelect.querySelector('option[value="file.delete-current"]')).toBeNull()
    expect(actionSelect.querySelector('option[value="upscale.toggle-auto"]')).toBeNull()
    expect(actionSelect.querySelector('option[value="viewer.toggle-dynamic-background"]')).toBeNull()
  })

  it("[neoview.bindings.conflict-ui] blocks ambiguous saves and permits disabled collisions", async () => {
    const save = vi.fn(async ({ bindings }: { bindings?: ReturnType<typeof binding>[] }) => ({ bindings: bindings ?? [] }))
    render(<InputBindingsEditor value={{ bindings: [binding("one", "keyboard"), binding("two", "keyboard")] }} onSave={save as never} />)
    expect(screen.getByRole("alert").textContent).toContain("输入冲突")
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole("switch")[1]!)
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
  })

  it("[neoview.bindings.editor] edits modifiers, extended mouse buttons and touch fingers", () => {
    render(<InputBindingsEditor value={{ bindings: [
      binding("key", "keyboard"), binding("mouse", "mouse"), binding("wheel", "wheel"), binding("touch", "touch"),
    ] }} onSave={vi.fn()} />)
    fireEvent.click(screen.getAllByLabelText("Ctrl")[0]!)
    fireEvent.change(screen.getByRole("combobox", { name: "鼠标按钮" }), { target: { value: "7" } })
    fireEvent.click(screen.getAllByLabelText("Shift")[1]!)
    fireEvent.change(screen.getByRole("combobox", { name: "触控手指数" }), { target: { value: "3" } })
    expect((screen.getByRole("combobox", { name: "鼠标按钮" }) as HTMLSelectElement).value).toBe("7")
    expect((screen.getByRole("combobox", { name: "触控手指数" }) as HTMLSelectElement).value).toBe("3")
  })

  it("[neoview.bindings.recording-focus] records one keyboard chord, restores focus and supports cancellation", () => {
    render(<InputBindingsEditor value={{ bindings: [binding("key", "keyboard")] }} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "录制键盘输入" }))
    fireEvent.keyDown(document, { code: "KeyK", key: "k", ctrlKey: true, shiftKey: true })
    expect((screen.getByRole("textbox", { name: "键盘代码" }) as HTMLInputElement).value).toBe("KeyK")
    expect((screen.getByLabelText("Ctrl") as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Shift") as HTMLInputElement).checked).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "录制键盘输入" }))
    fireEvent.click(screen.getByRole("button", { name: "录制键盘输入" }))
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" })
    expect(screen.queryByText("请按下组合键；按 Escape 取消录制。")).toBeNull()
  })

  it("[neoview.bindings.keyboard-hold-editor] edits a long-press without replacing other bindings for the action", () => {
    render(<InputBindingsEditor value={{ bindings: [binding("key", "keyboard"), binding("mouse", "mouse")] }} onSave={vi.fn()} />)
    fireEvent.change(screen.getByRole("combobox", { name: "键盘触发方式" }), { target: { value: "hold" } })
    expect(screen.getByDisplayValue("450")).toBeTruthy()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })

  it("[neoview.bindings.mouse-gesture-editor] edits press, hold timing and a bounded direction sequence", () => {
    render(<InputBindingsEditor value={{ bindings: [binding("mouse", "mouse"), binding("gesture", "mouse-gesture")] }} onSave={vi.fn()} />)
    fireEvent.change(screen.getByRole("combobox", { name: "鼠标动作" }), { target: { value: "hold" } })
    expect(screen.getByDisplayValue("500")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "添加向下" }))
    expect(screen.getByText("L D")).toBeTruthy()
  })

  it("[neoview.bindings.area-editor] edits the legacy nine-area click descriptor", () => {
    render(<InputBindingsEditor value={{ bindings: [{ id: "area", action: "reader.next-page", context: "reader", enabled: true, input: { device: "area", area: "middle-center", button: 0, action: "click" } }] }} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "右下" }))
    fireEvent.change(screen.getByRole("combobox", { name: "区域点击方式" }), { target: { value: "press" } })
    expect(screen.getByRole("button", { name: "右下" }).getAttribute("aria-pressed")).toBe("true")
    expect((screen.getByRole("combobox", { name: "区域点击方式" }) as HTMLSelectElement).value).toBe("press")
  })

  it("[neoview.bindings.recording-ime] ignores IME composition without ending the recording", () => {
    render(<InputBindingsEditor value={{ bindings: [binding("key", "keyboard")] }} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "录制键盘输入" }))
    fireEvent.keyDown(document, { code: "KeyJ", key: "Process", isComposing: true })
    expect((screen.getByRole("textbox", { name: "键盘代码" }) as HTMLInputElement).value).toBe("KeyN")
    expect(screen.getByText("请按下组合键；按 Escape 取消录制。")).toBeTruthy()
    fireEvent.keyDown(document, { code: "KeyK", key: "k" })
    expect((screen.getByRole("textbox", { name: "键盘代码" }) as HTMLInputElement).value).toBe("KeyK")
  })

  it("[neoview.bindings.device-recording] opens and cancels the maintained device recorder", async () => {
    render(<InputBindingsEditor value={{ bindings: [binding("mouse", "mouse")] }} onSave={vi.fn()} />)
    const recordButton = screen.getByRole("button", { name: "录制鼠标输入" })
    fireEvent.click(recordButton)
    expect(await screen.findByRole("dialog", { name: "鼠标录制" })).toBeTruthy()
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "鼠标录制" })).toBeNull())
    expect(document.activeElement).toBe(recordButton)
  })

  it("[neoview.bindings.device-recording] records wheel direction and modifiers through use-gesture", async () => {
    render(<InputBindingsEditor value={{ bindings: [binding("wheel", "wheel")] }} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "录制滚轮输入" }))
    const recorder = await screen.findByRole("dialog", { name: "滚轮录制" })
    fireEvent(recorder, new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, shiftKey: true }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "滚轮录制" })).toBeNull())
    expect((screen.getByRole("combobox", { name: "滚轮方向" }) as HTMLSelectElement).value).toBe("up")
  })

  it("[neoview.bindings.reset-ui] restores canonical defaults through one command", async () => {
    const save = vi.fn(async () => ({ bindings: [] }))
    render(<InputBindingsEditor value={{ bindings: [] }} onSave={save} />)
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ reset: "defaults" }))
  })

  it("[neoview.bindings.legacy-import-ui] inspects before importing and refreshes the canonical runtime", async () => {
    const inspect = vi.fn(async () => ({
      report: {
        codecVersion: 1,
        sourceKind: "app-settings",
        entries: [{ sourcePath: "keybindings[0]", disposition: "converted" }],
        summary: { converted: 1 },
        fullyRecognized: true,
      },
      configPatch: { bindings: { items: [] } },
    }))
    const importLegacy = vi.fn(async () => ({
      report: { codecVersion: 1, sourceKind: "app-settings", entries: [], summary: {}, fullyRecognized: true },
      configPatch: {}, strategy: "merge" as const, changed: true, backupCreated: true,
    }))
    render(<InputBindingsEditor value={{ bindings: [binding("key", "keyboard")] }} onSave={vi.fn()} onLegacySettingsInspect={inspect} onLegacySettingsImport={importLegacy} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Legacy settings JSON" }), { target: { value: '{"keybindings":[]}' } })
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }))
    await waitFor(() => expect(inspect).toHaveBeenCalledWith('{"keybindings":[]}'))
    expect(screen.getByText("Recognized legacy settings")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Import" }))
    await waitFor(() => expect(importLegacy).toHaveBeenCalledWith('{"keybindings":[]}', "merge"))
    expect(screen.getByText(/Imported successfully/)).toBeTruthy()
  })
})

function binding(id: string, device: "keyboard" | "mouse" | "mouse-gesture" | "wheel" | "touch" | "gamepad") {
  const input = device === "keyboard" ? { device, code: "KeyN" } as const
    : device === "mouse" ? { device, button: 3, action: "click" } as const
    : device === "mouse-gesture" ? { device, button: 2, directions: ["left"] as const, trigger: "instant" } as const
    : device === "wheel" ? { device, direction: "down" } as const
    : device === "touch" ? { device, gesture: "swipe-left", fingers: 1 } as const
    : { device, button: 5 } as const
  return { id, action: "reader.next-page" as const, context: "reader" as const, enabled: true, input }
}
