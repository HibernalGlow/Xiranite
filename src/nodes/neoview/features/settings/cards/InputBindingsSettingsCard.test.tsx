import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { InputBindingsEditor } from "./InputBindingsSettingsCard"

afterEach(cleanup)

describe("InputBindingsSettingsCard", () => {
  it("[neoview.bindings.editor] filters contexts and exposes all device editors", () => {
    render(<InputBindingsEditor value={{ bindings: [
      binding("key", "keyboard"), binding("mouse", "mouse"), binding("wheel", "wheel"), binding("touch", "touch"), binding("pad", "gamepad"),
    ] }} onSave={vi.fn()} />)
    expect(screen.getAllByRole("listitem")).toHaveLength(5)
    expect(screen.getAllByRole("combobox", { name: "输入设备" }).map((element) => (element as HTMLSelectElement).value)).toEqual(["keyboard", "mouse", "wheel", "touch", "gamepad"])
    fireEvent.change(screen.getByRole("combobox", { name: "筛选上下文" }), { target: { value: "panel" } })
    expect(screen.queryAllByRole("listitem")).toHaveLength(0)
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

  it("[neoview.bindings.recording] records one keyboard chord and supports cancellation", () => {
    render(<InputBindingsEditor value={{ bindings: [binding("key", "keyboard")] }} onSave={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "录制键盘输入" }))
    fireEvent.keyDown(window, { code: "KeyK", key: "k", ctrlKey: true, shiftKey: true })
    expect((screen.getByRole("textbox", { name: "键盘代码" }) as HTMLInputElement).value).toBe("KeyK")
    expect((screen.getByLabelText("Ctrl") as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Shift") as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "录制键盘输入" }))
    fireEvent.keyDown(window, { code: "Escape", key: "Escape" })
    expect(screen.queryByText("请按下组合键；按 Escape 取消录制。")).toBeNull()
  })

  it("[neoview.bindings.reset-ui] restores canonical defaults through one command", async () => {
    const save = vi.fn(async () => ({ bindings: [] }))
    render(<InputBindingsEditor value={{ bindings: [] }} onSave={save} />)
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ reset: "defaults" }))
  })
})

function binding(id: string, device: "keyboard" | "mouse" | "wheel" | "touch" | "gamepad") {
  const input = device === "keyboard" ? { device, code: "KeyN" } as const
    : device === "mouse" ? { device, button: 3, click: "single" } as const
    : device === "wheel" ? { device, direction: "down" } as const
    : device === "touch" ? { device, gesture: "swipe-left", fingers: 1 } as const
    : { device, button: 5 } as const
  return { id, action: "reader.next-page" as const, context: "reader" as const, enabled: true, input }
}
