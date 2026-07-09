// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { NodeComponentProps, NodeHostApi, NodeRunEvent } from "@xiranite/contract"
import { FileText } from "lucide-react"
import { createMigratedToolComponent } from "./MigratedToolNode"

describe("MigratedToolNode", () => {
  test("builds input from state and calls the host runner", async () => {
    const state = { pathText: "D:/a\nD:/b", recordRun: true }
    const run = vi.fn(async (_id: string, input: unknown, onEvent?: (event: NodeRunEvent) => void) => {
      onEvent?.({ type: "progress", progress: 50, message: "halfway" })
      return { success: true, message: "done", data: { count: 2 } }
    })
    const host = {
      state: {
        getData: () => state,
        patchData: (patch: Record<string, unknown>) => Object.assign(state, patch),
      },
      runner: { run },
    } as unknown as NodeHostApi

    const Component = createMigratedToolComponent({
      id: "sample",
      title: "Sample",
      description: "Sample migrated node",
      icon: FileText,
      actions: [{ value: "plan", label: "计划" }],
      defaultAction: "plan",
      fields: [{ key: "pathText", label: "路径", type: "textarea" }],
      advancedFields: [{ key: "recordRun", label: "记录", type: "switch" }],
      buildInput: (current) => ({ paths: String(current.pathText).split(/\r?\n/), recordRun: Boolean(current.recordRun) }),
      summarize: (result) => [{ label: "数量", value: result?.data?.count ?? 0 }],
      sections: () => [],
    })

    render(<Component compId="c1" host={host} /> as Parameters<typeof render>[0])
    fireEvent.click(screen.getByRole("button", { name: /运行/ }))

    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0]?.[0]).toBe("sample")
    expect(run.mock.calls[0]?.[1]).toEqual({ paths: ["D:/a", "D:/b"], recordRun: true })
  })
})
