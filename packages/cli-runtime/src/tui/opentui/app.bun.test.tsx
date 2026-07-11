/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { describe, expect, test } from "bun:test"
import { act } from "react"

import type { TerminalInteractionDefinition } from "../../interaction.js"
import type { TerminalPreferenceValues } from "../index.js"
import { OpenTuiTerminalApp } from "./app.js"

interface DemoInput {
  action: string
  powerMode: string
  dryrun: boolean
  interval: number
}

function createDefinition(onRun?: (input: DemoInput) => void): TerminalInteractionDefinition<DemoInput, { success: boolean; message: string }> {
  return {
    schema: {
      id: "demo",
      title: "Demo",
      description: "Renderer-neutral schema",
      initialValues: { action: "run", powerMode: "sleep", dryrun: true, interval: 10 },
      fields: [
        {
          id: "action",
          label: "操作",
          kind: "select",
          options: [{ value: "run", label: "运行" }, { value: "status", label: "状态" }],
        },
        {
          id: "powerMode",
          label: "电源操作",
          kind: "select",
          options: [{ value: "sleep", label: "睡眠" }, { value: "shutdown", label: "关机" }],
        },
        { id: "dryrun", label: "演练模式", kind: "boolean" },
        { id: "interval", label: "间隔", kind: "number", min: 5, max: 60 },
      ],
      view: {
        sections: [
          { id: "trigger", title: "触发序列", fieldIds: ["action"] },
          { id: "execution", title: "执行动作", fieldIds: ["powerMode", "dryrun", "interval"] },
        ],
        dashboard: { title: "系统待命", display: (values) => ({ primary: String(values.action), secondary: "状态监控" }) },
      },
      toInput: (values) => ({
        action: String(values.action),
        powerMode: String(values.powerMode),
        dryrun: values.dryrun !== false,
        interval: Number(values.interval),
      }),
      preview: (input) => [`Action: ${input.action}`, `Power: ${input.powerMode}`],
      isDangerous: (input) => !input.dryrun,
      result: (result) => ({
        ...result,
        lines: ["Videos: 15"],
        table: {
          columns: [
            { id: "file", label: "文件", width: 28 },
            { id: "bitrate", label: "码率", width: 12 },
            { id: "resolution", label: "分辨率", width: 12 },
          ],
          rows: Array.from({ length: 15 }, (_, index) => ({
            file: `video-${String(index + 1).padStart(2, "0")}.mp4`,
            bitrate: `${index + 1} Mbps`,
            resolution: "1920x1080",
          })),
        },
      }),
    },
    run: async (input, onEvent) => {
      onRun?.(input)
      onEvent({ type: "log", message: "event log" })
      return { success: true, message: "ok" }
    },
  }
}

describe("OpenTUI terminal adapter", () => {
  test("renders the full shared workbench at the terminal dimensions", async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(
        <OpenTuiTerminalApp definition={createDefinition()} language="zh" theme="high-contrast" onExit={() => undefined} />,
        { width: 110, height: 24, useMouse: true },
      )
    })
    try {
      await act(async () => setup.renderOnce())
      const frame = setup.captureCharFrame()
      expect(frame.split("\n").slice(0, -1)).toHaveLength(24)
      expect(frame).toContain("DEMO // NATIVE CONTROL PLANE")
      expect(frame).toContain("OpenTUI · native widgets · buffered")
      expect(frame).toContain("触发序列")
      expect(frame).toContain("系统待命")
      expect(frame).toContain("执行动作")
      expect(frame).not.toContain("步骤")
    } finally {
      await act(async () => setup.renderer.destroy())
    }
  })

  test("handles mouse mode, power, safety, confirmation, execution, and log-tab actions", async () => {
    let capturedInput: DemoInput | undefined
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(
        <OpenTuiTerminalApp definition={createDefinition((input) => { capturedInput = input })} language="zh" onExit={() => undefined} />,
        { width: 110, height: 30, useMouse: true },
      )
    })
    const click = async (id: string) => {
      const target = setup.renderer.root.findDescendantById(id)
      expect(target).toBeDefined()
      await act(async () => {
        await setup.mockMouse.click(
          target!.x + Math.max(0, Math.floor(target!.width / 2)),
          target!.y + Math.max(0, Math.floor((target!.height - 1) / 2)),
        )
      })
      await act(async () => setup.flush())
    }
    try {
      await act(async () => setup.renderOnce())
      await click("field-action-status")
      expect(setup.captureCharFrame()).toContain("● 状态")
      await click("field-action-run")
      await click("section-tabs-execution")
      await click("field-powerMode-shutdown")
      await click("field-dryrun-false")
      await click("field-interval-plus")
      await click("field-interval")
      await act(async () => {
        await setup.mockInput.typeText("30")
      })
      await act(async () => setup.flush())

      await click("execute")
      expect(setup.captureCharFrame()).toContain("确认真实执行")
      await click("confirm-dismiss")
      expect(setup.captureCharFrame()).not.toContain("确认真实执行")

      await click("execute")
      await click("confirm-execute")
      await setup.waitFor(() => capturedInput !== undefined)
      expect(capturedInput).toEqual({ action: "run", powerMode: "shutdown", dryrun: false, interval: 30 })
      expect(setup.renderer.root.findDescendantById("dashboard-result-table")).toBeDefined()
      expect(setup.captureCharFrame()).toContain("video-01.mp4")

      await click("tab-logs")
      expect(setup.captureCharFrame()).toContain("event log")
    } finally {
      await act(async () => setup.renderer.destroy())
    }
  })

  test("previews and saves node CLI preferences from the shared mouse settings screen", async () => {
    let saved: TerminalPreferenceValues | undefined
    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(
        <OpenTuiTerminalApp
          definition={createDefinition()}
          language="zh"
          preferences={{
            nodeId: "demo",
            current: { theme: "inherit", defaultMode: "ui", language: "zh" },
            save: async (values) => { saved = values },
            restore: async () => ({ theme: "inherit", defaultMode: "ui", language: "zh" }),
          }}
          onExit={() => undefined}
        />,
        { width: 110, height: 30, useMouse: true },
      )
    })
    const click = async (id: string) => {
      const target = setup.renderer.root.findDescendantById(id)
      expect(target).toBeDefined()
      await act(async () => setup.mockMouse.click(target!.x + Math.max(1, Math.floor(target!.width / 2)), target!.y + Math.max(0, Math.floor((target!.height - 1) / 2))))
      await act(async () => setup.flush())
    }
    try {
      await act(async () => setup.renderOnce())
      await click("settings")
      expect(setup.captureCharFrame()).toContain("demo CLI 设置")
      await click("pref-theme-dracula")
      await click("pref-mode-pipe")
      await click("pref-language-en")
      await click("pref-save")
      await setup.waitFor(() => saved !== undefined)
      expect(saved).toEqual({ theme: "dracula", defaultMode: "pipe", language: "en" })
      expect(setup.captureCharFrame()).toContain("主题预览 / dracula")
    } finally {
      await act(async () => setup.renderer.destroy())
    }
  })
})
