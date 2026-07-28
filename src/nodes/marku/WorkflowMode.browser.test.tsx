import { afterEach, expect, test, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"
import { useEffect, useReducer } from "react"
import type { NodeHostApi, NodeRunResult } from "@xiranite/contract"
import type { MarkuData, MarkuInput, MarkuWorkflow, MarkuWorkflowLibrary } from "@xiranite/node-marku/core"
import { Component } from "./Component"
import type { MarkuCardState } from "./types"

const surface = vi.hoisted(() => ({ width: 1280, height: 800, mode: "regular" }))

vi.mock("@/nodes/shared/useNodeSurface", () => ({
  useNodeSurface: () => ({ ref: { current: null }, ...surface }),
}))

afterEach(() => {
  cleanup()
  Object.assign(surface, { width: 1280, height: 800, mode: "regular" })
  vi.restoreAllMocks()
})

test("switches Normal to Workflow with a seeded draft, collapses the sidebar, and returns", async () => {
  const host = createHost({ module: "content_replace", configText: '{"mode":"literal"}', pathText: "D:/docs" })

  await render(<Harness compId="marku-mode-browser" host={host} />)
  await page.getByRole("button", { name: "工作流模式" }).click()

  await expect.element(page.getByTestId("marku-workflow-panel")).toBeVisible()
  await expect.element(page.getByTestId("marku-workflow-editor")).toBeVisible()
  await expect.element(page.getByTestId("marku-workflow-sidebar")).toBeVisible()
  expect(host.state.mode).toBe("workflow")
  expect(host.state.activeWorkflowId).toBe("")
  expect(host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace"])
  expect(host.state.workflowDraft?.steps[0]?.config).toEqual({ mode: "literal" })

  // The canvas owns the whole card once the sidebar is collapsed.
  await page.getByRole("button", { name: "收起侧栏" }).click()
  await expect.element(page.getByTestId("marku-workflow-sidebar")).not.toBeInTheDocument()
  await expect.element(page.getByTestId("marku-workflow-editor")).toBeVisible()
  await page.getByRole("button", { name: "展开侧栏" }).click()
  await expect.element(page.getByTestId("marku-workflow-sidebar")).toBeVisible()

  await page.getByRole("button", { name: "返回普通模式" }).click()
  await expect.element(page.getByRole("button", { name: "工作流模式" })).toBeVisible()
  expect(host.state.mode).toBe("normal")
  expect(host.state.workflowDraft?.steps).toHaveLength(1)
})

test("edits steps through the sidebar list and directly on the canvas node, then dry-runs", async () => {
  const host = createHost({ module: "markt", inputText: "# Hello\n\nWorld" }, { runData: workflowRunFixture })

  await render(<Harness compId="marku-graph-browser" host={host} />)
  await page.getByRole("button", { name: "工作流模式" }).click()
  await expect.element(page.getByTestId("marku-workflow-editor")).toBeVisible()

  await page.getByRole("button", { name: "添加步骤" }).click()
  await expect.poll(() => host.state.workflowDraft?.steps.length).toBe(2)

  // The newly added step is selected; edit module and config on the node itself.
  const stepId = host.state.workflowDraft!.steps[1]!.id
  const node = page.getByTestId(`marku-flow-node-${stepId}`)
  await expect.element(node).toBeVisible()
  await node.getByRole("combobox").click()
  await page.getByRole("option", { name: "替换" }).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["markt", "content_replace"])

  await page.getByRole("button", { name: "编辑步骤配置" }).click()
  await page.getByRole("textbox", { name: "marku workflow node config" }).fill('{"mode":"regex"}')
  await expect.poll(() => host.state.workflowDraft?.steps[1]?.config).toEqual({ mode: "regex" })
  await userEvent.keyboard("{Escape}")

  // Sidebar list mirrors the canvas: reorder, duplicate, and delete steps.
  await page.getByRole("button", { name: "上移步骤" }).nth(1).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace", "markt"])
  await page.getByRole("button", { name: "复制步骤" }).nth(0).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace", "content_replace", "markt"])
  await page.getByRole("button", { name: "删除步骤" }).nth(1).click()
  await expect.poll(() => host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_replace", "markt"])

  await page.getByRole("button", { name: "预演工作流" }).click()
  await expect.poll(() => host.runCalls.length).toBe(1)
  const call = host.runCalls[0]!
  expect(call.nodeId).toBe("marku")
  expect(call.input.action).toBe("workflow")
  expect(call.input.inputText).toBe("# Hello\n\nWorld")
  expect(call.input.workflow?.steps.map((step) => step.module)).toEqual(["content_replace", "markt"])

  await expect.element(page.getByTestId("marku-workflow-results")).toBeVisible()
  await expect.element(page.getByText("input.md")).toBeVisible()
  await expect.element(page.getByText("有变更")).toBeVisible()
  expect(host.state.workflowRun?.workflowId).toBe("wf-run")
})

test("loads, renames, saves, and deletes workflows in the library", async () => {
  const saved: MarkuWorkflow = { id: "wf-saved", name: "清理流程", steps: [{ id: "step-a", module: "content_dedup", config: {} }] }
  const host = createHost(
    {
      mode: "workflow",
      workflowDraft: { id: "wf-local", name: "", steps: [{ id: "step-local", module: "markt", config: {} }] },
      activeWorkflowId: "",
    },
    { workflowLibrary: { schemaVersion: 1, workflows: [saved] } },
  )

  await render(<Harness compId="marku-library-browser" host={host} />)
  const librarySelect = page.getByRole("combobox", { name: "marku workflow library" })
  await expect.element(librarySelect).toBeEnabled()
  await librarySelect.click()
  await page.getByRole("option", { name: "清理流程" }).click()
  await expect.poll(() => host.state.activeWorkflowId).toBe("wf-saved")
  expect(host.state.workflowDraft?.steps.map((step) => step.module)).toEqual(["content_dedup"])

  // Draft renames flow back into the saved entry after the debounce window.
  await page.getByRole("textbox", { name: "marku workflow name" }).fill("清理流程 v2")
  await expect.poll(() => host.saveCalls.length, { timeout: 3_000 }).toBeGreaterThan(0)
  expect(lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2"])

  await page.getByRole("button", { name: "新建工作流" }).click()
  await expect.poll(() => host.state.activeWorkflowId).toBe("")
  await page.getByRole("button", { name: "保存到库" }).click()
  await expect.poll(() => host.saveCalls.length).toBeGreaterThan(1)
  expect(lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2", "未命名工作流"])
  await expect.poll(() => host.state.activeWorkflowId).not.toBe("")

  await page.getByRole("button", { name: "删除工作流" }).click()
  await expect.poll(() => lastLibrary(host).workflows.map((workflow) => workflow.name)).toEqual(["清理流程 v2"])
  expect(host.state.activeWorkflowId).toBe("")
  expect(host.state.workflowDraft?.steps).toHaveLength(1)
})

type TestHost = NodeHostApi & {
  state: MarkuCardState
  runCalls: Array<{ nodeId: string; input: MarkuInput }>
  saveCalls: unknown[]
  notify: () => void
}

/**
 * Marku reads host.getData on every render without subscribing, so the test
 * host bumps a version in the harness after each patch to drive re-renders
 * the way the production workspace store does.
 */
function Harness({ compId, host }: { compId: string; host: TestHost }) {
  const [, force] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    host.notify = force
    return () => {
      host.notify = () => undefined
    }
  }, [host])
  return (
    // The workspace gives cards a concrete size; without it the flex-1 canvas
    // row would collapse to zero height once the sidebar is hidden.
    <div style={{ width: 1240, height: 780 }}>
      <Component compId={compId} host={host} />
    </div>
  )
}

function createHost(initial: MarkuCardState, options: { runData?: MarkuData; workflowLibrary?: MarkuWorkflowLibrary } = {}): TestHost {
  const host: TestHost = {
    state: { ...initial },
    runCalls: [],
    saveCalls: [],
    notify: () => undefined,
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
      host.notify()
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    clipboard: {
      readText: async () => "",
      writeText: async () => undefined,
    },
    actions: {
      run: async <TInput, TData>(nodeId: string, input: TInput): Promise<NodeRunResult<TData>> => {
        host.runCalls.push({ nodeId, input: input as MarkuInput })
        return { success: true, message: "工作流已完成。", data: options.runData as TData }
      },
    },
    env: { theme: "light", platform: "web" },
    getNodeConfig: async <T,>() => ({
      config: (options.workflowLibrary ? { workflowLibrary: options.workflowLibrary } : undefined) as T | undefined,
      path: "D:/config/xiranite.config.toml",
    }),
    saveNodeConfig: async <T,>(config: T) => {
      host.saveCalls.push(config)
    },
  }
  return host
}

function lastLibrary(host: TestHost): MarkuWorkflowLibrary {
  const last = host.saveCalls.at(-1) as { workflowLibrary: MarkuWorkflowLibrary }
  return last.workflowLibrary
}

const workflowRunFixture: MarkuData = {
  filesProcessed: 1,
  filesChanged: 1,
  inputText: "# Hello\n\nWorld",
  outputText: "- Hello\n\nWorld",
  diffText: "",
  diffs: [],
  history: [],
  undoId: "",
  errors: [],
  workflow: {
    workflowId: "wf-run",
    workflowName: "",
    stepCount: 2,
    sources: [
      {
        sourceId: "input.md",
        sourceLabel: "input.md",
        originalText: "# Hello\n\nWorld",
        outputText: "- Hello\n\nWorld",
        steps: [
          { stepId: "s1", module: "content_replace", inputText: "# Hello\n\nWorld", outputText: "- Hello\n\nWorld", changed: true },
          { stepId: "s2", module: "markt", inputText: "- Hello\n\nWorld", outputText: "- Hello\n\nWorld", changed: false },
        ],
      },
    ],
  },
}
