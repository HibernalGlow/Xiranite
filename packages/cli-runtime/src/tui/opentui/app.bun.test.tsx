/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { describe, expect, test } from "bun:test"

import type { TerminalInteractionDefinition } from "../../interaction.js"
import { OpenTuiTerminalApp } from "./app.js"

describe("OpenTUI terminal adapter", () => {
  test("renders the shared schema, i18next language, and theme", async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    const definition: TerminalInteractionDefinition<{ action: string }, { success: boolean; message: string }> = {
      schema: {
        id: "demo",
        title: "Demo",
        description: "Renderer-neutral schema",
        initialValues: { action: "run" },
        fields: [{
          id: "action",
          label: "操作",
          kind: "select",
          options: [{ value: "run", label: "运行" }, { value: "status", label: "状态" }],
        }],
        toInput: (values) => ({ action: String(values.action) }),
        preview: (input) => [`Action: ${input.action}`],
        isDangerous: () => false,
        result: (result) => ({ ...result, lines: [] }),
      },
      run: async () => ({ success: true, message: "ok" }),
    }

    const setup = await testRender(
      <OpenTuiTerminalApp definition={definition} language="zh" theme="high-contrast" onExit={() => undefined} />,
      { width: 80, height: 18 },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Demo")
      expect(frame).toContain("OpenTUI · Esc 返回 · q 退出")
      expect(frame).toContain("操作")
      expect(frame).toContain("运行")
    } finally {
      setup.renderer.destroy()
    }
  })
})
