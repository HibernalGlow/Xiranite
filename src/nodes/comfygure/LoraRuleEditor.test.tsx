import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createComfygureLoraRule,
  type ComfygureLora,
  type ComfygureRulePolicy,
} from "@xiranite/node-comfygure/core"
import { LoraRuleEditor } from "./LoraRuleEditor"

afterEach(cleanup)

describe("LoraRuleEditor", () => {
  it("adds a structured LoRA definition", async () => {
    const onChange = vi.fn()
    renderEditor([], [], onChange)

    await userEvent.setup().click(screen.getByRole("button", { name: "Add LoRA" }))

    expect(onChange).toHaveBeenCalledWith({
      loras: [{ name: "new-lora-1.safetensors", modelStrength: 1, clipStrength: 1, injectionTerms: "", enabled: true }],
      rules: [],
    })
  })

  it("adds an activation rule for the first configured LoRA", async () => {
    const onChange = vi.fn()
    renderEditor([{ name: "style.safetensors", enabled: true }], [], onChange)

    await userEvent.setup().click(screen.getByRole("button", { name: "Add rule" }))

    const value = onChange.mock.lastCall?.[0]
    expect(value.rules).toHaveLength(1)
    expect(value.rules[0]).toMatchObject({
      enabled: true,
      effects: [{ payload: { loraName: "style.safetensors" } }],
    })
  })

  it("creates the first LoRA and opens its condition editor in one action", async () => {
    const onChange = vi.fn()
    render(<StatefulEditor initialLoras={[]} initialRules={[]} onChange={onChange} />)

    await userEvent.setup().click(screen.getByRole("button", { name: "Add rule" }))

    await waitFor(() => expect(screen.getByTestId("rule-tree-editor")).toBeTruthy())
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      loras: [{ name: "new-lora-1.safetensors" }],
      rules: [{ effects: [{ payload: { loraName: "new-lora-1.safetensors" } }] }],
    })
  })

  it("projects legacy trigger terms and clears them when the rule is edited", () => {
    const onChange = vi.fn()
    renderEditor([{ name: "legacy.safetensors", activationTerms: "cat, dog", enabled: true }], [], onChange)

    expect(screen.getByTestId("comfygure-lora-rule")).toBeTruthy()
    expect(screen.getByDisplayValue("cat")).toBeTruthy()
    expect(screen.getByDisplayValue("dog")).toBeTruthy()

    fireEvent.change(screen.getByRole("textbox", { name: "Rule name" }), { target: { value: "Animal style" } })

    const value = onChange.mock.lastCall?.[0]
    expect(value.loras[0].activationTerms).toBe("")
    expect(value.rules[0]).toMatchObject({
      name: "Animal style",
      effects: [{ payload: { loraName: "legacy.safetensors" } }],
    })
  })

  it("keeps rule effects aligned when a LoRA is renamed or removed", async () => {
    const onChange = vi.fn()
    render(<StatefulEditor
      initialLoras={[{ name: "old.safetensors", enabled: true }]}
      initialRules={[createComfygureLoraRule("old.safetensors", "cat")]}
      onChange={onChange}
    />)

    fireEvent.change(screen.getByRole("textbox", { name: "LoRA file" }), { target: { value: "new.safetensors" } })
    await waitFor(() => expect(onChange.mock.lastCall?.[0].rules[0].effects[0].payload.loraName).toBe("new.safetensors"))

    await userEvent.setup().click(screen.getByRole("button", { name: "Remove LoRA" }))
    await waitFor(() => expect(onChange.mock.lastCall?.[0]).toEqual({ loras: [], rules: [] }))
  })
})

function renderEditor(
  loras: readonly ComfygureLora[],
  rules: readonly ComfygureRulePolicy[],
  onChange: ReturnType<typeof vi.fn>,
) {
  return render(<LoraRuleEditor loras={loras} rules={rules} t={translate} onChange={onChange} />)
}

function StatefulEditor(props: {
  initialLoras: readonly ComfygureLora[]
  initialRules: readonly ComfygureRulePolicy[]
  onChange: ReturnType<typeof vi.fn>
}) {
  const [value, setValue] = useState({ loras: props.initialLoras, rules: props.initialRules })
  return <LoraRuleEditor
    loras={value.loras}
    rules={value.rules}
    t={translate}
    onChange={(next) => {
      props.onChange(next)
      setValue(next)
    }}
  />
}

function translate(_key: string, fallback: string): string {
  return fallback
}
