import { expect, test, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "vitest-browser-react"

import { InputBindingsEditor } from "./InputBindingsSettingsCard"

test("[neoview.bindings.repeat-policy-editor] exposes a default-off repeat switch for every binding device", async () => {
  await render(
    <div style={{ width: 960 }}>
      <InputBindingsEditor
        value={{ bindings: [{
          id: "mouse-binding",
          action: "reader.next-page",
          context: "reader",
          enabled: true,
          input: { device: "mouse", button: 3, action: "click" },
        }] }}
        onSave={vi.fn(async ({ bindings }) => ({ bindings: bindings ?? [] }))}
      />
    </div>,
  )

  const repeatSwitch = page.getByRole("switch", { name: "忽略重复输入" })
  await expect.element(repeatSwitch).toHaveAttribute("data-state", "unchecked")
  await repeatSwitch.click()
  await expect.element(repeatSwitch).toHaveAttribute("data-state", "checked")
})

test("[neoview.bindings.action-sequence-editor] edits, reorders and persists follow-up actions inside one binding", async () => {
  const save = vi.fn(async ({ bindings }) => ({ bindings: bindings ?? [] }))
  await render(
    <div style={{ width: 960 }}>
      <InputBindingsEditor
        value={{ bindings: [{
          id: "delete-binding",
          action: "file.delete-current",
          context: "reader",
          enabled: true,
          input: { device: "keyboard", code: "Delete" },
        }] }}
        onSave={save}
      />
    </div>,
  )

  await page.getByRole("button", { name: "添加", exact: true }).click()
  const followUp = page.getByRole("combobox", { name: "后续动作 1" })
  await followUp.selectOptions("reader.next-book")
  await expect.element(followUp).toHaveValue("reader.next-book")
  await page.getByRole("button", { name: "添加", exact: true }).click()
  const secondFollowUp = page.getByRole("combobox", { name: "后续动作 2" })
  await secondFollowUp.selectOptions("reader.first-page")
  await page.getByRole("button", { name: "上移后续动作 2" }).click()
  await expect.element(page.getByRole("combobox", { name: "后续动作 1" })).toHaveValue("reader.first-page")
  await expect.poll(() => save).toHaveBeenCalledWith({ bindings: [expect.objectContaining({
    id: "delete-binding",
    followUpActions: ["reader.first-page", "reader.next-book"],
  })] })
})

test("[neoview.bindings.radial-action-editor] shows a radial binding with its action sequence", async () => {
  await render(
    <div style={{ width: 960 }}>
      <InputBindingsEditor
        value={{ bindings: [{
          id: "radial-delete-next",
          action: "file.delete-current",
          followUpActions: ["reader.next-book"],
          context: "reader",
          enabled: true,
          input: { device: "radial", menuId: "default", itemId: "delete" },
        }] }}
        onSave={vi.fn(async ({ bindings }) => ({ bindings: bindings ?? [] }))}
      />
    </div>,
  )

  await expect.element(page.getByText("轮盘 default / delete").first()).toBeVisible()
  await expect.element(page.getByRole("combobox", { name: "后续动作 1" })).toHaveValue("reader.next-book")
})

test("[neoview.bindings.file-card-command-editor] exposes fixed File Card commands with independently editable follow-up actions", async () => {
  const save = vi.fn(async ({ bindings }) => ({ bindings: bindings ?? [] }))
  await render(
    <div style={{ width: 960 }}>
      <InputBindingsEditor
        value={{ bindings: [
          {
            id: "system-file-card-trash-current",
            action: "file.delete-current",
            context: "reader",
            enabled: true,
            input: { device: "command", command: "file-card.trash-current" },
          },
          {
            id: "system-file-card-delete-current",
            action: "file.delete-current",
            context: "reader",
            enabled: true,
            input: { device: "command", command: "file-card.delete-current" },
          },
        ] }}
        onSave={save}
      />
    </div>,
  )

  await expect.element(page.getByText("文件卡 · 移到回收站").first()).toBeVisible()
  await expect.element(page.getByText("文件卡 · 永久删除").first()).toBeVisible()
  const enabledSwitches = page.getByRole("switch", { name: "删除文件启用" })
  await expect.element(enabledSwitches.nth(0)).toBeDisabled()
  await expect.element(enabledSwitches.nth(1)).toBeDisabled()

  const followUps = page.getByRole("button", { name: "添加", exact: true })
  await followUps.nth(0).click()
  await page.getByRole("combobox", { name: "后续动作 1" }).first().selectOptions("reader.next-book")
  await expect.poll(() => save).toHaveBeenCalledWith({ bindings: expect.arrayContaining([
    expect.objectContaining({ id: "system-file-card-trash-current", followUpActions: ["reader.next-book"] }),
    expect.objectContaining({ id: "system-file-card-delete-current" }),
  ]) })
})

test("[neoview.bindings.area-hold-editor] exposes configurable timing for a nine-area hold", async () => {
  const save = vi.fn(async ({ bindings }) => ({ bindings: bindings ?? [] }))
  await render(
    <div style={{ width: 960 }}>
      <InputBindingsEditor
        value={{ bindings: [{
          id: "area-binding",
          action: "reader.next-page",
          context: "reader",
          enabled: true,
          input: { device: "area", area: "middle-center", button: 0, action: "click" },
        }] }}
        onSave={save}
      />
    </div>,
  )

  await page.getByRole("combobox", { name: "区域点击方式" }).selectOptions("hold")
  const duration = page.getByRole("spinbutton", { name: "持续毫秒" })
  await expect.element(duration).toHaveValue(500)
  await duration.fill("750")
  await expect.poll(() => save).toHaveBeenLastCalledWith({ bindings: [expect.objectContaining({
    id: "area-binding",
    input: { device: "area", area: "middle-center", button: 0, action: "hold", durationMs: 750, moveTolerancePx: 12 },
  })] })
})
